import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {StdioClient} from '../stdio-client.mjs';
const executable=resolve(process.argv[2]),legacy=process.argv[3]==='legacy';
const home=await mkdtemp(join(tmpdir(),'completed-agent-switch-'));
const rootBodies=[];
let rpc,server,releaseChild,rootCache,childStarted=false,requestCount=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
  server=createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);
    const body=JSON.parse(Buffer.concat(chunks).toString());requestCount++;
    if(requestCount===1)rootCache=req.headers['x-client-request-id'];
    const child=rootCache&&req.headers['x-client-request-id']?req.headers['x-client-request-id']!==rootCache:JSON.stringify(body.input?.filter(x=>!['function_call','function_call_output'].includes(x.type))).includes('LOCAL_CHILD_FIXTURE');
    if(!child)rootBodies.push(JSON.stringify(body));
    if(child){childStarted=true;await new Promise(resolve=>{releaseChild=resolve})}
    let item;
    if(requestCount===1&&!child){
      let namespace;let found;
      for(const tool of body.tools??[]){if(tool.name==='spawn_agent')found=tool;if(tool.tools?.some(t=>t.name==='spawn_agent')){found=tool.tools.find(t=>t.name==='spawn_agent');namespace=tool.name}}
      assert.ok(found,'Spawn tool must be exposed in isolated fixture');
      item={type:'function_call',id:'fc_child',call_id:'spawn_child_fixture',name:'spawn_agent',...(namespace?{namespace}:{}),arguments:JSON.stringify({task_name:'completed_audit',message:'LOCAL_CHILD_FIXTURE: return a completed audit result.',fork_turns:'none'})};
    }else item={type:'message',id:'msg_'+requestCount,role:'assistant',status:'completed',content:[{type:'output_text',text:child?'Synthetic audit result preserved.':'Parent fixture completed.'}]};
    const id='resp_'+requestCount;
    const events=[{type:'response.created',response:{id,status:'in_progress'}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}];
    res.writeHead(200,{'content-type':'text/event-stream'});res.end(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
  });server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}/v1`;
  await writeFile(join(home,'config.toml'),`model="gpt-5.1-codex"\nmodel_provider="fixture"\n[features]\nmulti_agent_v2=true\ncode_mode=false\ncode_mode_host=false\n[model_providers.fixture]\nname="fixture"\nbase_url="${base}"\nwire_api="responses"\nrequires_openai_auth=false\nsupports_websockets=false\n`);
  for(const id of ['a','b']){const dir=join(home,'session-identities','profiles',id);await mkdir(dir,{recursive:true});await writeFile(join(dir,'profile.json'),JSON.stringify({kind:'api',providerId:'pinned_'+id,provider:{name:id,base_url:base,wire_api:'responses',requires_openai_auth:false,supports_websockets:false}}))}
  const env={...process.env,CODEX_HOME:home,NO_PROXY:'127.0.0.1,localhost',RUST_MIN_STACK:'33554432'};
  for(const key of Object.keys(env))if(/TOKEN|API_KEY|PASSWORD|SECRET/.test(key))delete env[key];
  rpc=new StdioClient(executable,['--listen','stdio://'],{env,cwd:home});await rpc.initialize('completed_subagent_fixture');
  const root=(await rpc.call('thread/start',{cwd:home,approvalPolicy:'never',sandbox:'read-only',historyMode:'paginated'})).thread.id;
  await rpc.call('thread/identity/set',{threadId:root,identityId:'a',expectedRevision:0});
  const {turn}=await rpc.call('turn/start',{threadId:root,input:[{type:'text',text:'LOCAL_ROOT_FIXTURE: explicitly use one synthetic subagent for the local test.'}]});
  const deadline=Date.now()+30000;
  while(!rpc.events.some(e=>e.method==='turn/completed'&&e.params?.turn?.id===turn.id)){if(Date.now()>deadline)throw Error('Parent did not finish: '+JSON.stringify(rpc.events.slice(-6)));await sleep(50)}
  while(!childStarted){if(Date.now()>deadline)throw Error('Child model did not start: '+JSON.stringify(rpc.events.slice(-12)));await sleep(50)}
  const before=await rpc.call('thread/identity/set',{threadId:root,identityId:'b',expectedRevision:1});
  assert.equal(before.status,'busy');assert.equal(before.blocker.reason,'loaded_subagent');
  const childId=before.blocker.threadId;releaseChild();
  while((await rpc.call('thread/read',{threadId:childId,includeTurns:true})).thread.status.type!=='idle'){if(Date.now()>deadline)throw Error('Child did not complete');await sleep(50)}
  let switched;
  for(let i=0;i<40;i++){switched=await rpc.call('thread/identity/set',{threadId:root,identityId:'b',expectedRevision:1});if(switched.status==='applied'||legacy)break;await sleep(50)}
  if(legacy){assert.equal(switched.status,'busy');assert.equal(switched.blocker.reason,'loaded_subagent')}
  else {
    assert.equal(switched.status,'applied');assert.equal(switched.identityId,'b');const history=await rpc.call('thread/read',{threadId:root,includeTurns:true});assert.ok(history.thread.turns.length>0,'Parent history must survive cleanup and switch');
    const check=(await rpc.call('turn/start',{threadId:root,input:[{type:'text',text:'Continue using the completed audit result.'}]})).turn;
    while(!rpc.events.some(e=>e.method==='turn/completed'&&e.params?.turn?.id===check.id)){if(Date.now()>deadline)throw Error('Post-switch turn failed');await sleep(50)}
    assert.ok(rootBodies.at(-1).includes('Synthetic audit result preserved.'),'Completed child result must remain in the next model context');
  }
  console.log(JSON.stringify({passed:true,legacyReproduced:legacy,activeChildPreserved:true,completedChildReleased:!legacy,identitySwitched:!legacy,parentHistoryPreserved:!legacy,externalModelRequests:0}));
}finally{releaseChild?.();await rpc?.close();server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));await rm(home,{recursive:true,force:true,maxRetries:20,retryDelay:250})}

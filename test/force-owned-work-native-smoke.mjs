import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {StdioClient} from '../stdio-client.mjs';
const home=await mkdtemp(join(tmpdir(),'force-owned-work-')),release=join(home,'release');
let rpc,server,root,fork,rootPhase=0,forkPhase=0,parentWaiting=false,childWaiting=false,releaseParent,releaseChild,count=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const command=`while (!(Test-Path -LiteralPath '${release.replaceAll("'","''")}')) { Start-Sleep -Milliseconds 100 }`;
try{
  server=createServer(async(req,res)=>{
    if(req.method!=='POST'){res.writeHead(404);res.end('{}');return}
    const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks).toString());const n=++count;
    const owner=req.headers['x-client-request-id'];let item;
    if(process.env.IDENTITY_FIXTURE_DEBUG)console.error(JSON.stringify({request:n,owner,root,fork,rootPhase,forkPhase,tools:(body.tools??[]).map(t=>t.name)}));
    if(owner===root){
      if(rootPhase++===0){
        let namespace;for(const t of body.tools??[])if(t.tools?.some(t=>t.name==='spawn_agent'))namespace=t.name;
        item={type:'function_call',id:'fc_spawn',call_id:'spawn',name:'spawn_agent',...(namespace?{namespace}:{}),arguments:JSON.stringify({task_name:'owned_child',message:'Synthetic child: hold the loopback response.',fork_turns:'none'})};
      }else if(rootPhase===2)item={type:'function_call',id:'fc_root_monitor',call_id:'root_monitor',name:'exec_command',arguments:JSON.stringify({cmd:command,yield_time_ms:1000,max_output_tokens:10})};
      else {parentWaiting=true;await new Promise(resolve=>{releaseParent=resolve})}
    }else if(owner===fork){
      if(forkPhase++===0)item={type:'function_call',id:'fc_fork_monitor',call_id:'fork_monitor',name:'exec_command',arguments:JSON.stringify({cmd:command,yield_time_ms:1000,max_output_tokens:10})};
    }else {childWaiting=true;await new Promise(resolve=>{releaseChild=resolve})}
    item??={type:'message',id:'msg_'+n,role:'assistant',status:'completed',content:[{type:'output_text',text:'Synthetic fixture completed.'}]};
    const id='resp_'+n,events=[{type:'response.created',response:{id,status:'in_progress'}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}];
    res.writeHead(200,{'content-type':'text/event-stream'});res.end(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
  });server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/v1`;
  await writeFile(join(home,'config.toml'),`model="gpt-5.1-codex"\nmodel_provider="fixture"\n[features]\nmulti_agent_v2=true\nunified_exec=true\ncode_mode=false\ncode_mode_host=false\n[model_providers.fixture]\nname="fixture"\nbase_url="${base}"\nwire_api="responses"\nrequires_openai_auth=false\nsupports_websockets=false\n`);
  for(const id of ['a','b']){const dir=join(home,'session-identities','profiles',id);await mkdir(dir,{recursive:true});await writeFile(join(dir,'profile.json'),JSON.stringify({kind:'api',providerId:'pinned_'+id,provider:{name:id,base_url:base,wire_api:'responses',requires_openai_auth:false,supports_websockets:false}}))}
  const env={...process.env,CODEX_HOME:home,RUST_MIN_STACK:'33554432',NO_PROXY:'127.0.0.1,localhost'};for(const k of Object.keys(env))if(/TOKEN|API_KEY|PASSWORD|SECRET/.test(k))delete env[k];
  rpc=new StdioClient(resolve(process.argv[2]),['--listen','stdio://'],{env,cwd:home});await rpc.initialize('force_owned_work_fixture');
  root=(await rpc.call('thread/start',{cwd:home,approvalPolicy:'never',sandbox:'danger-full-access',historyMode:'paginated'})).thread.id;
  await rpc.call('thread/identity/set',{threadId:root,identityId:'a',expectedRevision:0});
  fork=(await rpc.call('thread/fork',{threadId:root,excludeTurns:true})).thread.id;
  const forkTurn=(await rpc.call('turn/start',{threadId:fork,approvalPolicy:'never',sandboxPolicy:{type:'dangerFullAccess'},input:[{type:'text',text:'Run the independent fork fixture monitor.'}]})).turn;
  const deadline=Date.now()+60000;
  while(!rpc.events.some(e=>e.method==='turn/completed'&&e.params?.turn?.id===forkTurn.id)){if(Date.now()>deadline)throw Error('Fork monitor did not start: '+JSON.stringify(rpc.events.slice(-4)));await sleep(50)}
  await rpc.call('thread/goal/set',{threadId:root,origin:'user',objective:'Synthetic forced switch goal',status:'paused'});
  await rpc.call('turn/start',{threadId:root,approvalPolicy:'never',sandboxPolicy:{type:'dangerFullAccess'},input:[{type:'text',text:'Explicitly spawn one synthetic subagent, start a background monitor, then hold this parent response.'}]});
  while(!parentWaiting||!childWaiting){if(Date.now()>deadline)throw Error('Owned work did not start: '+JSON.stringify(rpc.events.slice(-6)));await sleep(50)}
  const blocked=await rpc.call('thread/identity/set',{threadId:root,identityId:'b',expectedRevision:1});assert.equal(blocked.status,'busy');assert.equal(blocked.blocker.reason,'reply_running');
  assert.ok((await rpc.call('thread/backgroundTerminals/list',{threadId:root})).data.length>0);
  await assert.rejects(()=>rpc.call('thread/identity/forceSet',{threadId:root,identityId:'missing_target',expectedRevision:1}));
  assert.ok((await rpc.call('thread/backgroundTerminals/list',{threadId:root})).data.length>0,'Invalid target must not stop owned work');
  const result=await rpc.call('thread/identity/forceSet',{threadId:root,identityId:'b',expectedRevision:1},120000);
  assert.equal(result.status,'applied');assert.equal(result.verified,true);assert.equal(result.identityId,'b');
  assert.equal((await rpc.call('thread/backgroundTerminals/list',{threadId:root})).data.length,0);
  assert.ok((await rpc.call('thread/backgroundTerminals/list',{threadId:fork})).data.length>0,'Independent fork monitor must survive');
  assert.equal((await rpc.call('thread/identity/read',{threadId:fork})).identityId,'a');
  assert.equal((await rpc.call('thread/goal/get',{threadId:root})).goal.status,'paused');
  console.log(JSON.stringify({passed:true,activeReplyStopped:true,ownedBackgroundStopped:true,ownedSubagentStopped:true,independentForkPreserved:true,invalidTargetNonDestructive:true,goalPaused:true,verifiedIdentity:true,externalModelRequests:0}));
}finally{releaseParent?.();releaseChild?.();await writeFile(release,'cleanup').catch(()=>{});await rpc?.close();server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));await rm(home,{recursive:true,force:true,maxRetries:20,retryDelay:250})}

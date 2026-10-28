import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {StdioClient} from '../stdio-client.mjs';
const executable=resolve(process.argv[2]);const legacy=process.argv[3]==='legacy';
const home=await mkdtemp(join(tmpdir(),'fork-independent-'));const requests=[];
let release=null,client;
const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw);const text=JSON.stringify(body.input);
  requests.push({authorization:req.headers.authorization,text});
  if(text.includes('hold-fork-response')&&!text.includes('follow-up'))await new Promise(r=>{release=r;});
  const id='resp_'+requests.length;const item={id:'msg_'+requests.length,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'OK'}]};
  const events=[{type:'response.created',response:{id,status:'in_progress'}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}];
  res.writeHead(200,{'content-type':'text/event-stream'});res.end(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){for(let i=0;i<300;i++){if(await check())return;await sleep(50);}throw Error('Fixture deadline exceeded');}
try{
  server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/v1`;
  await writeFile(join(home,'config.toml'),`model="gpt-5.1-codex"\nmodel_provider="fixture"\n[model_providers.fixture]\nname="fixture"\nbase_url="${base}"\nwire_api="responses"\nrequires_openai_auth=false\nsupports_websockets=false\n`);
  for(const id of ['a','b']){const directory=join(home,'session-identities','profiles',id);await mkdir(directory,{recursive:true});await writeFile(join(directory,'profile.json'),JSON.stringify({kind:'api',providerId:'identity_'+id,provider:{name:id,base_url:base,wire_api:'responses',requires_openai_auth:false,supports_websockets:false,experimental_bearer_token:'synthetic-'+id}}));}
  const env={...process.env,CODEX_HOME:home,CODEX_SQLITE_HOME:home,NO_PROXY:'127.0.0.1,localhost'};for(const key of Object.keys(env))if(/TOKEN|API_KEY|PASSWORD|SECRET/.test(key))delete env[key];
  client=new StdioClient(executable,['--listen','stdio://'],{cwd:home,env});await client.initialize('fork_independence_validation');
  const root=(await client.call('thread/start',{cwd:home,sandbox:'read-only',approvalPolicy:'never',historyMode:'paginated'})).thread.id;
  await client.call('thread/identity/set',{threadId:root,identityId:'a',expectedRevision:0});
  const fork=(await client.call('thread/fork',{threadId:root,excludeTurns:true})).thread.id;
  // Reproduce an existing pre-fix binding, not just a newly-created independent fork.
  await client.call('thread/unsubscribe',{threadId:fork});
  const bindingPath=join(home,'session-identities','bindings',fork+'.json');
  const binding=JSON.parse(await readFile(bindingPath,'utf8'));binding.parentThreadId=root;await writeFile(bindingPath,JSON.stringify(binding));
  await client.call('thread/resume',{threadId:fork,excludeTurns:true});
  const running=(await client.call('turn/start',{threadId:fork,input:[{type:'text',text:'hold-fork-response'}]})).turn;
  await until(()=>release!==null);assert.equal(requests.at(-1).authorization,'Bearer synthetic-a');
  const result=await client.call('thread/identity/set',{threadId:root,identityId:'b',expectedRevision:1});
  if(legacy){assert.equal(result.status,'busy');assert.equal(result.blocker?.reason,'side_chat_running');console.log(JSON.stringify({passed:true,legacyCouplingReproduced:true}));}
  else{
    assert.equal(result.status,'applied');assert.equal(result.identityId,'b');
    assert.equal((await client.call('thread/identity/read',{threadId:fork})).identityId,'a');
    assert.ok(!client.events.some(e=>e.method==='turn/completed'&&e.params?.turn?.id===running.id),'Parent switch must not interrupt fork');
    release();release=null;await until(()=>client.events.some(e=>e.method==='turn/completed'&&e.params?.turn?.id===running.id));
    for(const [id,text,credential] of [[root,'root-follow-up','synthetic-b'],[fork,'fork-follow-up','synthetic-a']]){
      const turn=(await client.call('turn/start',{threadId:id,input:[{type:'text',text}]})).turn;
      await until(()=>client.events.some(e=>e.method==='turn/completed'&&e.params?.turn?.id===turn.id));assert.equal(requests.at(-1).authorization,'Bearer '+credential);
    }
    await client.call('thread/unsubscribe',{threadId:fork});
    const switched=await client.call('thread/identity/set',{threadId:fork,identityId:'b',expectedRevision:1});assert.equal(switched.identityId,'b');
    assert.equal((await client.call('thread/identity/read',{threadId:root})).revision,2);
    console.log(JSON.stringify({passed:true,activeForkDoesNotBlockRoot:true,forkNotInterrupted:true,legacyBindingIndependent:true,actualRequestAccountsVerified:true,unloadedForkIndependentlySwitchable:true,externalModelRequests:0}));
  }
}finally{release?.();await client?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(home,{recursive:true,force:true,maxRetries:20,retryDelay:250}).catch(error=>{if(error.code!=='EBUSY')throw error;});}

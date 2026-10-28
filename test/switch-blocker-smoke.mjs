import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {StdioClient} from '../stdio-client.mjs';
import {TerminalSwitch} from '../terminal-switch.mjs';

if(!process.argv[2])throw new Error('Pass the compiled diagnostic backend');
const executable=resolve(process.argv[2]);
const home=await mkdtemp(join(tmpdir(),'switch-blocker-'));let client,server;let requests=0;
const release=join(home,'release-monitor');
try{
  server=createServer(async(req,res)=>{
    if(req.method!=='POST'||!req.url?.endsWith('/responses')){res.writeHead(404);res.end('{}');return;}
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());
    requests++;
    const command=`while (!(Test-Path -LiteralPath '${release.replaceAll("'","''")}')) { Start-Sleep -Milliseconds 100 }`;
    const item=requests===1
      ?{type:'function_call',id:'fc_monitor',call_id:'call_monitor',name:'exec_command',arguments:JSON.stringify({cmd:command,yield_time_ms:1000,max_output_tokens:20})}
      :{id:`msg_${requests}`,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'OK'}]};
    if(requests===1)assert.ok(JSON.stringify(body.tools).includes('exec_command'),'Fixture requires the native exec_command tool');
    const id=`resp_${requests}`;const events=[{type:'response.created',response:{id,status:'in_progress'}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}];
    res.writeHead(200,{'content-type':'text/event-stream'});res.end(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
  });server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}/v1`;
  await writeFile(join(home,'config.toml'),`model = "gpt-5.1-codex"\nmodel_provider = "fixture"\n[features]\nunified_exec = true\ncode_mode = false\ncode_mode_host = false\n[model_providers.fixture]\nname = "fixture"\nbase_url = "${base}"\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false\n`);
  for(const id of ['a','b']){
    const profile=join(home,'session-identities','profiles',id);await mkdir(profile,{recursive:true});
    await writeFile(join(profile,'profile.json'),JSON.stringify({kind:'api',providerId:`pinned_${id}`,provider:{name:id,base_url:base,wire_api:'responses',requires_openai_auth:false,supports_websockets:false}}));
  }
  const env={...process.env,CODEX_HOME:home,RUST_MIN_STACK:'33554432',NO_PROXY:'127.0.0.1,localhost',no_proxy:'127.0.0.1,localhost'};
  for(const name of ['OPENAI_API_KEY','CODEX_ACCESS_TOKEN','CODEX_API_KEY'])delete env[name];
  client=new StdioClient(executable,['--listen','stdio://'],{cwd:home,env});await client.initialize('switch_blocker_smoke');
  const root=(await client.call('thread/start',{cwd:home,sandbox:'danger-full-access',approvalPolicy:'never',historyMode:'paginated'})).thread.id;
  await client.call('thread/identity/set',{threadId:root,identityId:'a',expectedRevision:0});
  const side=(await client.call('thread/fork',{threadId:root,excludeTurns:true})).thread.id;
  const turn=await client.call('turn/start',{threadId:side,approvalPolicy:'never',sandboxPolicy:{type:'dangerFullAccess'},input:[{type:'text',text:'Start the synthetic background monitor.'}]});
  const deadline=Date.now()+30000;
  while(true){const done=client.events.find(e=>e.method==='turn/completed'&&e.params?.turn?.id===turn.turn.id);if(done){assert.equal(done.params.turn.status,'completed',done.params.turn.error?.message);break;}if(Date.now()>deadline)throw new Error('Background monitor turn timed out: '+JSON.stringify({requests,events:client.events.slice(-8)}));await new Promise(r=>setTimeout(r,25));}
  assert.ok((await client.call('thread/backgroundTerminals/list',{threadId:side})).data.length>0,'The synthetic monitor must still be running');
  const goal=await client.call('thread/goal/set',{threadId:side,origin:'user',objective:'Synthetic paused goal',status:'paused'});assert.equal(goal.goal.status,'paused');
  const independent=await client.call('thread/identity/set',{threadId:root,identityId:'b',expectedRevision:1});
  assert.equal(independent.status,'applied');assert.equal(independent.identityId,'b');
  assert.equal((await client.call('thread/identity/read',{threadId:side})).identityId,'a');
  assert.ok((await client.call('thread/backgroundTerminals/list',{threadId:side})).data.length>0,'Switching root must preserve fork background command');
  const sideBlocked=await client.call('thread/identity/set',{threadId:side,identityId:'b',expectedRevision:1});
  assert.equal(sideBlocked.status,'busy');assert.equal(sideBlocked.blocker.reason,'background_terminals');
  const view={pending:true,desiredRevision:1,desiredIdentityId:'b',wait:{reason:'background_terminals',threadId:side}};
  const bridge={status:()=>({connected:true,pid:client.child.pid}),async connect(){return this.status()},call:(method,params)=>method==='bridge/terminals/capabilities'?Promise.resolve({revision:1}):client.call(method,params)};
  const coordinator={inflight:new Set(),view:()=>view,store:{pendingRequests:()=>[{threadId:side,desiredRevision:1,nativeRevision:1}]},tick:()=>{}};
  const force=new TerminalSwitch(bridge,()=>coordinator);
  const confirmation=await force.prepare({threadId:side,expectedDesiredRevision:1});
  assert.ok(confirmation.count>0);
  assert.ok((await client.call('thread/backgroundTerminals/list',{threadId:side})).data.length>0,'Preparing confirmation must not close the terminal');
  const forced=await force.confirm({threadId:side,confirmation:confirmation.confirmation});
  assert.ok(forced.terminated>0,'Confirmed native termination must stop the target monitor');
  await assert.rejects(()=>force.confirm({threadId:side,confirmation:confirmation.confirmation}));
  await writeFile(release,'done');
  const stopDeadline=Date.now()+10000;
  while((await client.call('thread/backgroundTerminals/list',{threadId:side})).data.length){if(Date.now()>stopDeadline)throw new Error('Synthetic monitor did not exit');await new Promise(r=>setTimeout(r,100));}
  const switched=await client.call('thread/identity/set',{threadId:side,identityId:'b',expectedRevision:1});assert.equal(switched.identityId,'b');assert.equal(switched.blocker,undefined);
  assert.equal((await client.call('thread/goal/get',{threadId:side})).goal.status,'paused');
  console.log(JSON.stringify({passed:true,realBackgroundCommand:true,forkBackgroundDoesNotBlockRoot:true,targetBackgroundStillBlocks:true,pausedGoalDidNotCauseBlock:true,pausedGoalPreserved:true,explicitConfirmation:true,nativeTermination:true,oneUseConfirmation:true,clearedAfterCommandExit:true,realModelRequests:0}));
}finally{
  await writeFile(release,'cleanup').catch(()=>{});await client?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await rm(home,{recursive:true,force:true,maxRetries:20,retryDelay:250});
}

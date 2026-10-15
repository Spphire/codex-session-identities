import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,copyFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {StdioClient} from '../stdio-client.mjs';
import {BridgeClient} from '../bridge-client.mjs';
import {panelServer} from '../server.mjs';
import {createServer} from 'node:http';
import {once} from 'node:events';
if(!process.argv[2])throw new Error('Pass the patched app-server executable');
const executable=resolve(process.argv[2]);
const root=await mkdtemp(join(tmpdir(),'execution-policy-smoke-'));const home=join(root,'home');
let client,panel,server,apiServer;let modelRequests=0;
try{
  server=createServer(async(req,res)=>{
    if(req.method!=='POST'||!req.url?.endsWith('/responses')){res.writeHead(404);res.end('{}');return;}
    for await(const chunk of req){};modelRequests++;
    const item={id:`msg_${modelRequests}`,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'OK'}]};const id=`resp_${modelRequests}`;
    const events=[{type:'response.created',response:{id,status:'in_progress'}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}];
    res.writeHead(200,{'content-type':'text/event-stream'});res.end(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
  });server.listen(0,'127.0.0.1');await once(server,'listening');
  await mkdir(home);const work=join(home,'workspace');await mkdir(work);
  await writeFile(join(home,'config.toml'),`model = "gpt-5.1-codex"\nmodel_provider = "fixture"\n[model_providers.fixture]\nname = "fixture"\nbase_url = "http://127.0.0.1:${server.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false\n[windows]\nsandbox = "unelevated"\n`);
  for(const name of ['runtime-bridge.cjs','model-catalog-compat.cjs','client-version-compat.cjs','execution-policy.cjs'])await copyFile(new URL(`../${name}`,import.meta.url),join(root,name));
  await writeFile(join(root,'runtime-config.json'),JSON.stringify({appServerExe:executable,managePermissions:true}));
  const env={...process.env,CODEX_HOME:home,RUST_MIN_STACK:'33554432',NO_PROXY:'127.0.0.1,localhost',no_proxy:'127.0.0.1,localhost'};for(const key of ['OPENAI_API_KEY','CODEX_ACCESS_TOKEN','CODEX_API_KEY'])delete env[key];
  client=new StdioClient(process.execPath,[join(root,'runtime-bridge.cjs'),'app-server','--analytics-default-enabled'],{cwd:work,env});
  await client.initialize('execution_policy_smoke');panel=new BridgeClient(home);
  apiServer=panelServer({codexDirectory:home,switcherDirectory:join(home,'identity-switcher')});apiServer.listen(0,'127.0.0.1');await once(apiServer,'listening');
  const apiBase=`http://127.0.0.1:${apiServer.address().port}`;
  async function setMode(mode,expectedRevision){
    const response=await fetch(apiBase+'/api/permissions',{method:'POST',headers:{'X-Codex-Identity-Access':apiServer.identityAccessToken,'Content-Type':'application/json',Origin:apiBase},body:JSON.stringify({mode,expectedRevision})});
    const result=await response.json();assert.equal(response.status,200,result.error);assert.equal(result.runtimeSupported,true);assert.equal(result.mode,mode);
  }
  assert.equal((await panel.call('bridge/permissions/read',{})).supported,true);
  const started=await client.call('thread/start',{cwd:work,approvalPolicy:'on-request',sandbox:'read-only',historyMode:'paginated'});
  assert.equal(started.approvalPolicy,'never');assert.equal(started.sandbox.type,'dangerFullAccess');
  const threadId=started.thread.id;const outside=join(root,'outside-workspace.txt');
  async function nextTurn(id){
    const turn=await client.call('turn/start',{threadId:id,input:[{type:'text',text:'synthetic permission check'}],approvalPolicy:'never',sandboxPolicy:{type:'dangerFullAccess'}});
    const deadline=Date.now()+15000;
    while(true){
      const done=client.events.find(e=>e.method==='turn/completed'&&e.params?.turn?.id===turn.turn.id);
      if(done){assert.equal(done.params.turn.status,'completed',done.params.turn.error?.message);return;}
      if(Date.now()>deadline)throw new Error('Synthetic turn timed out');await new Promise(r=>setTimeout(r,25));
    }
  }
  const command=['powershell.exe','-NoProfile','-NonInteractive','-Command',"[IO.File]::WriteAllText('"+outside.replaceAll("'","''")+"','YOLO_EXECUTED'); Write-Output YOLO_EXECUTED"];
  const executed=await client.call('command/exec',{command,cwd:work,sandboxPolicy:{type:'readOnly'},timeoutMs:10000});
  assert.equal(executed.exitCode,0,executed.stderr);assert.equal(await readFile(outside,'utf8'),'YOLO_EXECUTED');
  await nextTurn(threadId);
  await setMode('standard',0);
  await nextTurn(threadId);
  const restricted=await client.call('thread/resume',{threadId,excludeTurns:true,sandbox:'danger-full-access',approvalPolicy:'never'});
  assert.equal(restricted.approvalPolicy,'on-request');assert.equal(restricted.sandbox.type,'workspaceWrite');
  const side=await client.call('thread/fork',{threadId,excludeTurns:true});assert.equal(side.sandbox.type,'workspaceWrite');
  await setMode('yolo',1);
  await nextTurn(side.thread.id);
  const restored=await client.call('thread/resume',{threadId:side.thread.id,excludeTurns:true});assert.equal(restored.approvalPolicy,'never');assert.equal(restored.sandbox.type,'dangerFullAccess');
  assert.equal((await panel.call('bridge/permissions/read',{})).revision,2);
  console.log(JSON.stringify({passed:true,realBackend:true,realBridge:true,realPanelApi:true,defaultYolo:true,outsideWorkspaceWriteExecuted:true,standardPermissionsConfirmedByBackend:true,sideChatFollowed:true,noRestartBetweenSwitches:true,syntheticModelRequests:modelRequests,realModelRequests:0}));
}finally{if(apiServer)await new Promise(r=>apiServer.close(r));panel?.close();await client?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:250});}

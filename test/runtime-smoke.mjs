// Run explicitly against the patched standalone app-server executable. No real credentials.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { mkdtemp, mkdir, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';

if (!process.argv[2]) throw new Error('Pass the patched codex-app-server.exe path');
const executable = resolve(process.argv[2]);
const bridgeDirectory=process.argv[4]&&resolve(process.argv[4]);
const historyMode = process.argv[3] || 'paginated';
assert.ok(['legacy','paginated'].includes(historyMode));
const directory = await mkdtemp(join(tmpdir(), 'codex-identity-smoke-'));
const requests = [];
let releaseTurn = null;
const endpoints = [];
let rpc;

function finish(response, text) {
  const id = `resp_${Date.now()}`;
  const item = { id:`msg_${id}`,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text}] };
  const events = [
    {type:'response.created',response:{id,status:'in_progress'}},
    {type:'response.output_item.done',output_index:0,item},
    {type:'response.completed',response:{id,status:'completed',output:[item],usage:{input_tokens:12,output_tokens:2,total_tokens:14}}},
  ];
  response.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
  response.end(events.map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
}

async function endpoint(label) {
  const server=createServer(async(req,res)=>{
    if(req.method==='POST' && req.url?.endsWith('/responses')) {
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const raw=Buffer.concat(chunks).toString('utf8');
      const record={label,authorization:req.headers.authorization,version:req.headers.version,body:JSON.parse(raw)};requests.push(record);
      if(raw.includes('hold_identity_test') && !releaseTurn){let released=false;releaseTurn=()=>{if(!released){released=true;finish(res,`${label} held response`);}};}
      else finish(res,`${label} response`);
    } else {res.writeHead(404);res.end('{}');}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');endpoints.push(server);
  return `http://127.0.0.1:${server.address().port}/v1`;
}

function connect() {
  const env={...process.env,CODEX_HOME:directory,RUST_MIN_STACK:'33554432',NO_PROXY:'127.0.0.1,localhost,::1',no_proxy:'127.0.0.1,localhost,::1'};
  env.CODEX_IDENTITY_CLIENT_VERSION='0.162.0-alpha.17.2';
  for(const key of ['CODEX_ACCESS_TOKEN','CODEX_API_KEY','OPENAI_API_KEY'])delete env[key];
  const child=spawn(bridgeDirectory?process.execPath:executable,bridgeDirectory?[join(bridgeDirectory,'runtime-bridge.cjs'),'app-server','--listen','stdio://']:['--listen','stdio://'],{env,cwd:directory,windowsHide:true,stdio:['pipe','pipe','pipe']});
  const waiters=new Map();const events=[];let sequence=0;let errors='';
  child.stderr.on('data',chunk=>{errors=(errors+chunk.toString()).slice(-12000);});
  child.on('exit',()=>{for(const w of waiters.values()){clearTimeout(w.timer);w.reject(new Error(`Runtime exited: ${errors}`));}waiters.clear();});
  createInterface({input:child.stdout}).on('line',line=>{
    let value;try{value=JSON.parse(line);}catch{return;}
    if(value.id!=null && waiters.has(value.id)){
      const w=waiters.get(value.id);waiters.delete(value.id);clearTimeout(w.timer);
      if(value.error)w.reject(new Error(JSON.stringify(value.error)));else w.resolve(value.result);
    }else events.push(value);
  });
  return {child,events,diagnostics:()=>errors,call(method,params){return new Promise((resolve,reject)=>{
    const id=++sequence;const timer=setTimeout(()=>{waiters.delete(id);reject(new Error(`RPC timeout: ${method}; ${errors}`));},60000);
    waiters.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');
  });},async close(){
    child.stdin.end();
    if(child.exitCode!==null)return;
    const killer=setTimeout(()=>child.kill(),10000);await once(child,'exit');clearTimeout(killer);
  }};
}

async function initialized() {
  const connection=connect();
  const initialized=await connection.call('initialize',{clientInfo:{name:'identity_smoke',version:'0.1.0'},capabilities:{experimentalApi:true}});
  if(bridgeDirectory)assert.match(initialized.userAgent,/\/0\.162\.0-alpha\.17\.2\s/,'Desktop must receive the installed backend capability version');
  connection.child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
  return connection;
}

async function waitUntil(predicate,label,timeout=30000) {
  const deadline=Date.now()+timeout;
  while(!predicate()){
    if(Date.now()>deadline)throw new Error(`Timeout waiting for ${label}`);
    await new Promise(resolve=>setTimeout(resolve,25));
  }
}

async function turn(threadId,text) {
  const result=await rpc.call('turn/start',{threadId,input:[{type:'text',text}]});
  return async()=>waitUntil(()=>rpc.events.some(x=>x.method==='turn/completed' && x.params?.threadId===threadId && x.params?.turn?.id===result.turn.id),'turn completion');
}

try {
  const a=await endpoint('a');const b=await endpoint('b');
  await writeFile(join(directory,'config.toml'),`model = "gpt-5.1-codex"\nmodel_provider = "test_a"\n[model_providers.test_a]\nname = "A"\nbase_url = "${a}"\nwire_api = "responses"\nexperimental_bearer_token = "synthetic-a"\nrequires_openai_auth = false\nsupports_websockets = false\n[model_providers.test_b]\nname = "B"\nbase_url = "${b}"\nwire_api = "responses"\nexperimental_bearer_token = "synthetic-b"\nrequires_openai_auth = false\nsupports_websockets = false\n`);
  for(const id of ['a','b']){
    const profile=join(directory,'session-identities','profiles',id);await mkdir(profile,{recursive:true});
    await writeFile(join(profile,'profile.json'),JSON.stringify({kind:'api',providerId:`pinned_${id}`,provider:{name:id,base_url:id==='a'?a:b,wire_api:'responses',experimental_bearer_token:`synthetic-${id}`,requires_openai_auth:false,supports_websockets:false}}));
  }
  rpc=await initialized();const initialPid=rpc.child.pid;
  const first=(await rpc.call('thread/start',{cwd:directory,approvalPolicy:'never',sandbox:'read-only',historyMode,developerInstructions:'identity_static_instructions_marker'})).thread.id;
  const second=(await rpc.call('thread/start',{cwd:directory,approvalPolicy:'never',sandbox:'read-only',historyMode})).thread.id;
  const set=(threadId,identityId,expectedRevision)=>rpc.call('thread/identity/set',{threadId,identityId,expectedRevision});
  assert.equal((await set(first,'a',0)).status,'applied');
  assert.equal((await set(second,'b',0)).status,'applied');
  await (await turn(first,'history_marker_first'))();
  await (await turn(second,'history_marker_second'))();
  assert.ok(requests.some(x=>x.label==='a' && x.authorization==='Bearer synthetic-a'));
  assert.ok(requests.some(x=>x.label==='b' && x.authorization==='Bearer synthetic-b'));
  const held=await turn(first,'hold_identity_test');
  await waitUntil(()=>Boolean(releaseTurn),'held endpoint request');
  const blocked=await set(first,'b',1);assert.equal(blocked.status,'busy');
  assert.equal(blocked.blocker.reason,'reply_running');assert.equal(blocked.blocker.threadId,first);
  await (await turn(second,'other_session_continues'))();
  releaseTurn();await held();
  assert.equal((await set(first,'b',1)).status,'applied');
  assert.equal(rpc.child.pid,initialPid);
  await (await turn(first,'after_identity_change'))();
  const last=requests.at(-1);assert.equal(last.label,'b');assert.equal(last.authorization,'Bearer synthetic-b');
  assert.ok(JSON.stringify(last.body).includes('history_marker_first'));
  assert.ok(JSON.stringify(last.body).includes('identity_static_instructions_marker'));
  await assert.rejects(()=>set(first,'missing',2));
  assert.equal((await rpc.call('thread/identity/read',{threadId:first})).identityId,'b');
  const fork=(await rpc.call('thread/fork',{threadId:first,excludeTurns:true})).thread.id;
  assert.equal((await rpc.call('thread/identity/read',{threadId:fork})).identityId,'b');
  await (await turn(fork,'fork_keeps_identity'))();assert.equal(requests.at(-1).label,'b');
  assert.ok(JSON.stringify(requests.at(-1).body).includes('history_marker_first'),'Fork must inherit actual conversation context');
  await rpc.close();rpc=await initialized();
  const resumed=await rpc.call('thread/resume',{threadId:first,excludeTurns:true});
  assert.equal(resumed.thread.id,first);
  const restored=await rpc.call('thread/identity/read',{threadId:first});
  assert.equal(restored.identityId,'b');assert.equal(restored.verified,true);
  await (await turn(first,'after_backend_restart'))();assert.equal(requests.at(-1).label,'b');
  await rpc.close();rpc=await initialized();
  await rename(join(directory,'session-identities','profiles','b'),join(directory,'session-identities','profiles','b-disabled'));
  const repaired=await rpc.call('thread/identity/set',{threadId:first,identityId:'a',expectedRevision:2});
  assert.equal(repaired.status,'unloaded');
  await rpc.call('thread/resume',{threadId:first,excludeTurns:true});
  await (await turn(first,'recovered_from_missing_identity'))();assert.equal(requests.at(-1).label,'a');
  assert.ok(requests.every(request=>request.version===undefined),'Official compatibility version must not enter API provider requests');
  console.log(JSON.stringify({passed:true,historyMode,directory,sessions:[first,second],requests:requests.length,originalRuntimePid:initialPid}));
} catch(error) {
  console.error(JSON.stringify({directory,error:error.message,requests:requests.map(x=>x.label),events:rpc?.events.slice(-12).map(x=>({method:x.method,status:x.params?.turn?.status,error:x.params?.error?.message})),diagnostics:rpc?.diagnostics()}));
  process.exitCode=1;
} finally {
  releaseTurn?.();if(rpc)await rpc.close();
  for(const server of endpoints){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}

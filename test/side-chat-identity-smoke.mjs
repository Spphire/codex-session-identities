import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import assert from 'node:assert/strict';

const executable=resolve(process.argv[2]||'');if(!executable)throw new Error('Pass patched app-server executable');
const home=await mkdtemp(join(tmpdir(),'side-chat-identity-'));let child;let server;const requests=[];
try{
  server=createServer(async(req,res)=>{if(req.method!=='POST'||!req.url?.endsWith('/responses')){res.writeHead(404);res.end('{}');return;}for await(const chunk of req){};requests.push({authorization:req.headers.authorization});const item={id:'msg_side',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'OK'}]};const id='resp_side';const events=[{type:'response.created',response:{id,status:'in_progress'}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}];res.writeHead(200,{'content-type':'text/event-stream'});res.end(events.map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/v1`;
  await writeFile(join(home,'config.toml'),`model = "gpt-5.1-codex"\nmodel_provider = "test_a"\n[model_providers.test_a]\nname = "A"\nbase_url = "${base}"\nwire_api = "responses"\nexperimental_bearer_token = "synthetic-a"\nrequires_openai_auth = false\nsupports_websockets = false\n[model_providers.test_b]\nname = "B"\nbase_url = "${base}"\nwire_api = "responses"\nexperimental_bearer_token = "synthetic-b"\nrequires_openai_auth = false\nsupports_websockets = false\n`);
  for(const id of ['a','b']){const profile=join(home,'session-identities','profiles',id);await mkdir(profile,{recursive:true});await writeFile(join(profile,'profile.json'),JSON.stringify({kind:'api',providerId:`pinned_${id}`,provider:{name:id,base_url:base,wire_api:'responses',experimental_bearer_token:`synthetic-${id}`,requires_openai_auth:false,supports_websockets:false}}));}
  const environment={...process.env,CODEX_HOME:home,CODEX_IDENTITY_CLIENT_VERSION:'0.162.0-alpha.17.2'};for(const key of ['OPENAI_API_KEY','CODEX_ACCESS_TOKEN','CODEX_API_KEY'])delete environment[key];
  child=spawn(executable,['--listen','stdio://'],{cwd:home,windowsHide:true,env:environment,stdio:['pipe','pipe','pipe']});
  const pending=new Map();const events=[];let sequence=0;let stderr='';child.stderr.on('data',x=>stderr=(stderr+x).toString().slice(-8000));createInterface({input:child.stdout}).on('line',line=>{let m;try{m=JSON.parse(line)}catch{return}if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result)}else events.push(m)});
  const call=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`timeout ${method} ${stderr}`))},30000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:value=>{clearTimeout(timer);reject(value)}});child.stdin.write(JSON.stringify({id,method,params})+'\n')});
  await call('initialize',{clientInfo:{name:'side_chat_identity_smoke',version:'0.1.0'},capabilities:{experimentalApi:true}});child.stdin.write('{"method":"initialized","params":{}}\n');
  const root=(await call('thread/start',{cwd:home,approvalPolicy:'never',sandbox:'read-only',historyMode:'paginated'})).thread.id;
  assert.equal((await call('thread/identity/set',{threadId:root,identityId:'a',expectedRevision:0})).identityId,'a');
  const side=(await call('thread/fork',{threadId:root,excludeTurns:true})).thread.id;
  assert.equal((await call('thread/identity/read',{threadId:side})).identityId,'a');
  const switched=await call('thread/identity/set',{threadId:root,identityId:'b',expectedRevision:1});
  const sideAfter=await call('thread/identity/read',{threadId:side});
  assert.equal(switched.identityId,'b');assert.equal(sideAfter.identityId,'a','ordinary fork keeps its inherited identity independently');
  await call('thread/resume',{threadId:side,excludeTurns:true});assert.equal((await call('thread/identity/read',{threadId:side})).verified,true);
  const started=await call('turn/start',{threadId:side,input:[{type:'text',text:'side identity check'}]});const deadline=Date.now()+30000;while(!events.some(x=>x.method==='turn/completed'&&x.params?.threadId===side&&x.params?.turn?.id===started.turn.id)){if(Date.now()>deadline)throw new Error('side chat turn timed out');await new Promise(resolve=>setTimeout(resolve,25));}
  assert.equal(requests.at(-1).authorization,'Bearer synthetic-a');
  console.log(JSON.stringify({passed:true,root,side,rootIdentity:switched.identityId,sideIdentity:sideAfter.identityId,sideRequestAuthorizationMatched:true}));
}finally{if(child){child.stdin.end();if(child.exitCode===null){const killer=setTimeout(()=>child.kill(),5000);await once(child,'exit').catch(()=>{});clearTimeout(killer);}}if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await rm(home,{recursive:true,force:true,maxRetries:20,retryDelay:250});}

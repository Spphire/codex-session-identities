import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {panelServer} from '../server.mjs';
import {credentialOperation} from '../api-identities.mjs';
import {StdioClient} from '../stdio-client.mjs';
const home=await mkdtemp(join(tmpdir(),'api-vault-native-')),helper=resolve('codex-identity-credential.exe'),created=[],seen=[];
let panel,modelServer,rpc;
try{
  modelServer=createServer(async(req,res)=>{
    if(req.method!=='POST'){res.writeHead(404);res.end('{}');return}
    const chunks=[];for await(const c of req)chunks.push(c);seen.push({path:req.url,authorization:req.headers.authorization,body:JSON.parse(Buffer.concat(chunks).toString())});
    const id='response_'+seen.length,item={type:'message',id:'message_'+seen.length,role:'assistant',status:'completed',content:[{type:'output_text',text:'Synthetic API reply.'}]};
    const events=[{type:'response.created',response:{id,status:'in_progress'}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}];
    res.writeHead(200,{'content-type':'text/event-stream'});res.end(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
  });modelServer.listen(0,'127.0.0.1');await once(modelServer,'listening');const base=`http://127.0.0.1:${modelServer.address().port}`;
  const config=`model="gpt-5.1-codex"\nmodel_provider="fixture"\n[model_providers.fixture]\nname="fixture"\nbase_url="${base}/default/v1"\nwire_api="responses"\nrequires_openai_auth=false\nsupports_websockets=false\n`;
  await writeFile(join(home,'config.toml'),config);
  panel=panelServer({codexDirectory:home,switcherDirectory:join(home,'identity-switcher')});panel.listen(0,'127.0.0.1');await once(panel,'listening');
  const panelBase=`http://127.0.0.1:${panel.address().port}`,headers={'X-Codex-Identity-Access':panel.identityAccessToken,Origin:panelBase,'Content-Type':'application/json'};
  for(const label of ['a','b']){
    const result=await fetch(panelBase+'/api/identities/add-api',{method:'POST',headers,body:JSON.stringify({name:'Synthetic API '+label,baseUrl:base+'/'+label+'/v1',model:label==='a'?'gpt-5.1-codex':'gpt-5-codex',apiKey:'SYNTHETIC_API_'+label})});
    const value=await result.json();assert.equal(result.status,201,JSON.stringify(value));
    const profile=JSON.parse(await readFile(join(home,'session-identities','profiles',value.identityId,'profile.json'),'utf8'));created.push({id:value.identityId,providerId:profile.providerId});
    await assert.rejects(()=>credentialOperation('store',profile.providerId,'SYNTHETIC_REPLACEMENT',helper),'Create-only helper must not overwrite an existing key');
  }
  const env={...process.env,CODEX_HOME:home,CODEX_SQLITE_HOME:home,NO_PROXY:'127.0.0.1,localhost',RUST_MIN_STACK:'33554432'};for(const k of Object.keys(env))if(/TOKEN|API_KEY|PASSWORD|SECRET/i.test(k))delete env[k];
  async function connect(){rpc=new StdioClient(resolve(process.argv[2]),['--listen','stdio://'],{cwd:home,env});await rpc.initialize('api_identity_fixture')}
  await connect();const thread=(await rpc.call('thread/start',{cwd:home,approvalPolicy:'never',sandbox:'read-only',historyMode:'paginated'})).thread;
  async function turn(){const started=(await rpc.call('turn/start',{threadId:thread.id,input:[{type:'text',text:'Return the synthetic API fixture reply.'}]})).turn;const deadline=Date.now()+30000;while(true){const done=rpc.events.find(e=>e.method==='turn/completed'&&e.params?.turn?.id===started.id);if(done){assert.equal(done.params.turn.status,'completed',JSON.stringify(done.params.turn.error));return}if(Date.now()>deadline)throw Error('Synthetic API turn timed out');await new Promise(r=>setTimeout(r,25))}}
  for(let i=0;i<created.length;i++){const result=await rpc.call('thread/identity/set',{threadId:thread.id,identityId:created[i].id,expectedRevision:i});assert.equal(result.verified,true);await turn()}
  assert.equal(seen.length,2);assert.deepEqual(seen.map(r=>r.authorization),['Bearer SYNTHETIC_API_a','Bearer SYNTHETIC_API_b']);assert.deepEqual(seen.map(r=>r.body.model),['gpt-5.1-codex','gpt-5-codex']);assert.deepEqual(seen.map(r=>r.path),['/a/v1/responses','/b/v1/responses']);
  await rpc.close();await connect();await rpc.call('thread/resume',{threadId:thread.id});await turn();assert.equal(seen.at(-1).authorization,'Bearer SYNTHETIC_API_b');
  assert.equal(await readFile(join(home,'config.toml'),'utf8'),config,'Global provider configuration must remain unchanged');
  const state=await(await fetch(panelBase+'/api/state',{headers})).text();assert.ok(!state.includes('SYNTHETIC_API_'));
  console.log(JSON.stringify({passed:true,realWindowsVault:true,createOnlyCredential:true,panelRegistration:true,nativeSwitch:true,actualAuthorizationAndModelVerified:true,coldResumeVerified:true,globalConfigUnchanged:true,externalModelRequests:0}));
}finally{await rpc?.close();if(panel)await new Promise(r=>panel.close(r));modelServer?.closeAllConnections();if(modelServer)await new Promise(r=>modelServer.close(r));for(const item of created)await credentialOperation('delete',item.providerId,undefined,helper);await rm(home,{recursive:true,force:true,maxRetries:10,retryDelay:200})}

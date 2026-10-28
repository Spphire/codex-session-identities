import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {addApiIdentity,validateApiIdentity} from '../api-identities.mjs';
import {panelServer} from '../server.mjs';
const input={name:'Synthetic gateway',baseUrl:'https://example.invalid/v1/',model:'fixture-model',apiKey:'SYNTHETIC_PRIVATE_KEY'};
async function fixture(t){const home=await mkdtemp(join(tmpdir(),'add-api-'));t.after(()=>rm(home,{recursive:true,force:true}));return home}
test('API identity validates endpoint, protocol shape, model and secret without echoing input',()=>{
  assert.equal(validateApiIdentity(input).baseUrl,'https://example.invalid/v1');
  assert.equal(validateApiIdentity({...input,baseUrl:'http://127.0.0.1:1234/v1'}).model,'fixture-model');
  for(const change of [{name:''},{baseUrl:'javascript:SYNTHETIC_PRIVATE_KEY'},{baseUrl:'http://example.invalid/v1'},{baseUrl:'https://user:password@example.invalid/v1'},{baseUrl:'https://example.invalid/v1?key=SYNTHETIC_PRIVATE_KEY'},{baseUrl:'https://example.invalid/v1/responses'},{model:''},{apiKey:'bad key'},{apiKey:'x'.repeat(2561)},{protocol:'chat'}]){
    assert.throws(()=>validateApiIdentity({...input,...change}),error=>!error.message.includes(input.apiKey));
  }
});
test('API registration publishes credential-free profiles only after vault verification',async t=>{
  const home=await fixture(t),ops=[];
  const result=await addApiIdentity(home,input,{helper:'C:/fixture/credential.exe',credential:async(op,id,secret)=>{ops.push({op,id,secret});if(op==='check')assert.equal((await readdir(join(home,'session-identities','profiles'))).some(n=>!n.startsWith('.')),false)}});
  assert.deepEqual(ops.map(x=>x.op),['store','check']);assert.equal(ops[0].secret,input.apiKey);
  const file=await readFile(join(home,'session-identities','profiles',result.identityId,'profile.json'),'utf8');
  assert.ok(!file.includes(input.apiKey));assert.ok(!JSON.stringify(result).includes(input.apiKey));
  const profile=JSON.parse(file);assert.equal(profile.provider.wire_api,'responses');assert.equal(profile.model,input.model);assert.equal(profile.provider.requires_openai_auth,false);
  assert.deepEqual(profile.provider.auth.args,['--provider-id',ops[0].id]);assert.equal(result.connectionVerified,false);
});
test('API registration removes staged profile and newly stored credential on check failure',async t=>{
  const home=await fixture(t),ops=[];
  await assert.rejects(()=>addApiIdentity(home,input,{credential:async op=>{ops.push(op);if(op==='check')throw Error('secret '+input.apiKey)}}),error=>!error.message.includes(input.apiKey));
  assert.deepEqual(ops,['store','check','delete']);assert.deepEqual(await readdir(join(home,'session-identities','profiles')),[]);
});
test('API endpoint requires access, origin and bounded JSON; state never returns the API key',async t=>{
  const home=await fixture(t),db=new DatabaseSync(join(home,'state_5.sqlite'));
  db.exec('CREATE TABLE threads(id TEXT,title TEXT,model_provider TEXT,model TEXT,cwd TEXT,updated_at INTEGER,archived INTEGER)');db.close();
  const ops=[],server=panelServer({codexDirectory:home,switcherDirectory:join(home,'identity-switcher'),apiIdentityOptions:{credential:async op=>ops.push(op)}});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`,url=base+'/api/identities/add-api',headers={'X-Codex-Identity-Access':server.identityAccessToken,Origin:base,'Content-Type':'application/json'};
  assert.equal((await fetch(url,{method:'POST',body:JSON.stringify(input)})).status,401);
  assert.equal((await fetch(url,{method:'POST',headers:{...headers,Origin:'http://other.invalid'},body:JSON.stringify(input)})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers,body:'{"apiKey":"'+input.apiKey+'",'})).status,400);
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({...input,apiKey:'x'.repeat(17000)})})).status,413);
  const response=await fetch(url,{method:'POST',headers,body:JSON.stringify(input)});assert.equal(response.status,201);const added=await response.json();
  const state=await(await fetch(base+'/api/state',{headers})).json();assert.equal(state.identities.find(i=>i.runtimeId===added.identityId).available,true);
  assert.doesNotMatch(JSON.stringify(state),/SYNTHETIC_PRIVATE_KEY|auth.command|apiKey/);assert.deepEqual(ops,['store','check']);
});

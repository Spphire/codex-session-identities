import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { readCatalog } from '../catalog.mjs';
import { panelServer } from '../server.mjs';

function fixture(t) {
  const dir=mkdtempSync(join(tmpdir(),'identity-panel-')); const store=join(dir,'identity-switcher');mkdirSync(store);
  const db=new DatabaseSync(join(dir,'state_5.sqlite'));
  db.exec("CREATE TABLE threads(id TEXT,title TEXT,model_provider TEXT,model TEXT,cwd TEXT,updated_at INTEGER,archived INTEGER); INSERT INTO threads VALUES('session-1','Session','openai','test-model','C:/test',1,0)");db.close();
  const state={identities:[{id:'gateway-a',name:'Gateway',providerId:'openai',baseURL:'https://secret.invalid/?key=DO-NOT-EXPOSE'}],officialAccounts:[{id:'account-a',name:'Official',authIdentity:'PRIVATE-ACCOUNT-ID',baseline:{api_key:'DO-NOT-EXPOSE'}}],activeOfficialAccountId:'account-a'};
  writeFileSync(join(store,'state.json'),JSON.stringify(state));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  return {codexDirectory:dir,switcherDirectory:store};
}
test('only allowlisted metadata leaves the server; shared provider never implies account binding',t=>{
  const config=fixture(t);const file=join(config.codexDirectory,'state_5.sqlite');const before=readFileSync(file);
  const state=readCatalog(config.codexDirectory,config.switcherDirectory);
  assert.equal(state.sessions.length,1);assert.equal(state.identities.length,2);
  assert.equal(state.sessions[0].identityId,null);assert.equal(state.runtime.canSwitch,false);
  assert.doesNotMatch(JSON.stringify(state),/DO-NOT-EXPOSE|PRIVATE-ACCOUNT-ID|baseURL|baseline/);
  assert.deepEqual(readFileSync(file),before);
});
test('HTTP refuses writes and DNS-rebinding hosts',async t=>{
  const config=fixture(t);const server=panelServer(config);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const authorization={'X-Codex-Identity-Access':server.identityAccessToken};
  assert.equal((await fetch(base+'/api/state')).status,401);
  const state=await fetch(base+'/api/state',{headers:authorization});assert.equal(state.status,200);
  const forbidden=await fetch(base+'/api/switch',{method:'POST',headers:authorization,body:'{}'});assert.equal(forbidden.status,403);
  const mutation=await fetch(base+'/api/switch',{method:'POST',headers:{...authorization,Origin:base,'Content-Type':'application/json'},body:'{}'});assert.equal(mutation.status,503);
  assert.match((await mutation.json()).error,/未更改/);
  const hostile=await new Promise(resolve=>{const req=httpRequest(`http://127.0.0.1:${server.address().port}/api/state`,{headers:{host:'attacker.example'}},res=>{res.resume();res.on('end',()=>resolve(res));});req.end();});assert.equal(hostile.statusCode,403);
});

test('official labels use matching email and never expose tokens or mismatched accounts',t=>{
  const config=fixture(t);const root=join(config.codexDirectory,'session-identities','profiles');
  const auth=(account,user,email)=>({auth_mode:'chatgpt',tokens:{account_id:account,id_token:'header.'+Buffer.from(JSON.stringify({email,'https://api.openai.com/auth':{chatgpt_user_id:user}})).toString('base64url')+'.signature',refresh_token:'SECRET_REFRESH'}});
  for(const [id,kind,account,user,email] of [['host','chatgpt-system','HOST_ACCOUNT','HOST_USER','host@example.com'],['chatgpt_account-a','chatgpt','SECOND_ACCOUNT','SECOND_USER','second@example.com']]){
    const directory=join(root,id);mkdirSync(directory,{recursive:true});
    writeFileSync(join(directory,'profile.json'),JSON.stringify({kind,accountId:account,userId:user,providerId:'openai'}));
    writeFileSync(join(directory,'label.json'),JSON.stringify({name:'Old label'}));
    writeFileSync(join(kind==='chatgpt-system'?config.codexDirectory:directory,'auth.json'),JSON.stringify(auth(account,user,email)));
  }
  const state=readCatalog(config.codexDirectory,config.switcherDirectory);
  assert.equal(state.identities.find(x=>x.runtimeId==='host').name,'host@example.com');
  assert.equal(state.identities.find(x=>x.runtimeId==='chatgpt_account-a').name,'second@example.com');
  assert.doesNotMatch(JSON.stringify(state),/SECRET_REFRESH|HOST_ACCOUNT|SECOND_ACCOUNT|id_token|signature/);
  writeFileSync(join(config.codexDirectory,'auth.json'),JSON.stringify(auth('OTHER_ACCOUNT','OTHER_USER','other@example.com')));
  assert.equal(readCatalog(config.codexDirectory,config.switcherDirectory).identities.find(x=>x.runtimeId==='host').name,'Old label');
  writeFileSync(join(root,'chatgpt_account-a','auth.json'),'{broken');
  assert.equal(readCatalog(config.codexDirectory,config.switcherDirectory).identities.find(x=>x.runtimeId==='chatgpt_account-a').name,'Official');
});

test('saved bindings are visible offline without claiming a live identity was verified',t=>{
  const config=fixture(t);const id='11111111-1111-4111-8111-111111111111';
  const db=new DatabaseSync(join(config.codexDirectory,'state_5.sqlite'));
  db.prepare('UPDATE threads SET id=?').run(id);db.close();
  const bindings=join(config.codexDirectory,'session-identities','bindings');mkdirSync(bindings,{recursive:true});
  writeFileSync(join(bindings,id+'.json'),JSON.stringify({identityId:'api_a',revision:2,privateToken:'DO-NOT-EXPOSE'}));
  const state=readCatalog(config.codexDirectory,config.switcherDirectory);
  assert.equal(state.sessions[0].identityId,'api_a');assert.equal(state.sessions[0].identityState,'configured');
  assert.equal(state.sessions[0].identityRevision,2);assert.equal(state.runtime.connected,false);
  assert.doesNotMatch(JSON.stringify(state),/DO-NOT-EXPOSE/);
});

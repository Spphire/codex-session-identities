import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {once} from 'node:events';
import {readCatalog} from '../catalog.mjs';
import {removeIdentity} from '../identity-management.mjs';
import {panelServer} from '../server.mjs';

function fixture(t){
  const home=mkdtempSync(join(tmpdir(),'identity-management-'));
  t.after(()=>rmSync(home,{recursive:true,force:true}));
  const db=new DatabaseSync(join(home,'state_5.sqlite'));
  db.exec('CREATE TABLE threads(id TEXT,title TEXT,model_provider TEXT,model TEXT,cwd TEXT,updated_at INTEGER,archived INTEGER)');db.close();
  const config={codexDirectory:home,switcherDirectory:join(home,'identity-switcher')};
  function official(id,kind,account='ACCOUNT_A',user='USER_A',email='same@example.com'){
    const directory=join(home,'session-identities','profiles',id);mkdirSync(directory,{recursive:true});
    writeFileSync(join(directory,'profile.json'),JSON.stringify({kind,accountId:account,userId:user,providerId:'identity_'+id}));
    writeFileSync(join(directory,'label.json'),JSON.stringify({name:'Original label'}));
    const file=join(kind==='chatgpt-system'?home:directory,'auth.json');
    writeFileSync(file,JSON.stringify({auth_mode:'chatgpt',tokens:{account_id:account,id_token:'header.'+Buffer.from(JSON.stringify({email,'https://api.openai.com/auth':{chatgpt_user_id:user}})).toString('base64url')+'.signature',refresh_token:'SYNTHETIC_SECRET'}}));
    return file;
  }
  function binding(identityId){const root=join(home,'session-identities','bindings');mkdirSync(root,{recursive:true});writeFileSync(join(root,'11111111-1111-1111-1111-111111111111.json'),JSON.stringify({identityId,revision:1}));}
  return {home,config,official,binding,catalog:()=>readCatalog(home,config.switcherDirectory)};
}
const input=identity=>({identityId:identity.id,expectedMemberIds:identity.memberIds});

test('official grouping uses account and user, not email; both aliases remain resolvable',t=>{
  const f=fixture(t);f.official('independent','chatgpt');f.official('system','chatgpt-system');
  f.official('other_account','chatgpt','ACCOUNT_B');f.official('other_user','chatgpt','ACCOUNT_A','USER_B');
  const state=f.catalog();assert.equal(state.identities.length,3);
  const group=state.identities.find(x=>x.runtimeId==='system');
  assert.deepEqual([...group.runtimeIds].sort(),['independent','system']);assert.deepEqual([...group.sources].sort(),['independent','system']);
  assert.doesNotMatch(JSON.stringify(state),/ACCOUNT_A|ACCOUNT_B|USER_A|USER_B|SYNTHETIC_SECRET|signature/);
});
test('a changed host login cannot rename or merge the previous fixed system identity',t=>{
  const f=fixture(t);f.official('system','chatgpt-system');f.official('new','chatgpt','NEW_ACCOUNT','NEW_USER','new@example.com');
  const next=readFileSync(join(f.home,'session-identities','profiles','new','auth.json'));
  writeFileSync(join(f.home,'auth.json'),next);
  const state=f.catalog();assert.equal(state.identities.length,2);
  const old=state.identities.find(x=>x.runtimeId==='system');assert.equal(old.name,'Original label');assert.equal(old.available,false);
});
test('removal hides all duplicate members persistently without deleting login or profiles',t=>{
  const f=fixture(t);const auth=f.official('independent','chatgpt');f.official('system','chatgpt-system');
  const before=readFileSync(auth);const group=f.catalog().identities[0];
  assert.deepEqual(removeIdentity(f.home,f.catalog(),input(group)),{removed:true,credentialsDeleted:false});
  assert.ok(f.catalog().identities.every(x=>x.removed));assert.deepEqual(readFileSync(auth),before);
  assert.throws(()=>removeIdentity(f.home,f.catalog(),input(group)),/变化/);
});
test('orphan binding, queued request and observed runtime each prevent removal',t=>{
  const f=fixture(t);f.official('independent','chatgpt');const group=f.catalog().identities[0];
  assert.throws(()=>removeIdentity(f.home,f.catalog(),input(group),[{desiredIdentityId:'independent'}]),/会话绑定/);
  assert.throws(()=>removeIdentity(f.home,f.catalog(),input(group),[],[{identityId:'independent'}]),/会话绑定/);
  f.binding('independent');assert.throws(()=>removeIdentity(f.home,f.catalog(),input(group)),/会话绑定/);
  assert.equal(f.catalog().identities[0].removed,false);
});
test('stale duplicate membership refuses removal after another profile is added',t=>{
  const f=fixture(t);f.official('independent','chatgpt');const previous=input(f.catalog().identities[0]);
  f.official('system','chatgpt-system');assert.throws(()=>removeIdentity(f.home,f.catalog(),previous),/变化/);
});
test('removal endpoint requires token and same origin, and rejects forged identities',async t=>{
  const f=fixture(t);f.official('independent','chatgpt');const server=panelServer(f.config);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const headers={'X-Codex-Identity-Access':server.identityAccessToken,'Content-Type':'application/json',Origin:base};
  const body=JSON.stringify(input(f.catalog().identities[0]));
  assert.equal((await fetch(base+'/api/identities/remove',{method:'POST',body})).status,401);
  assert.equal((await fetch(base+'/api/identities/remove',{method:'POST',headers:{...headers,Origin:'http://attacker.example'},body})).status,403);
  assert.equal((await fetch(base+'/api/identities/remove',{method:'POST',headers,body:JSON.stringify({identityId:'../../auth.json',expectedMemberIds:[]})})).status,409);
  assert.equal((await fetch(base+'/api/identities/remove',{method:'POST',headers,body})).status,200);
  assert.ok(f.catalog().identities[0].removed);
});

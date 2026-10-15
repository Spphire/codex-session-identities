import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {OfficialLogin} from '../official-login.mjs';

async function fixture(t){
  const home=await mkdtemp(join(tmpdir(),'official-login-test-'));t.after(()=>rm(home,{recursive:true,force:true}));
  await writeFile(join(home,'auth.json'),'GLOBAL_AUTH_UNCHANGED');
  class Client{
    constructor(exe,args,options){this.directory=options.env.CODEX_HOME;this.events=[];Client.current=this;}
    async initialize(){}
    async call(method,params){assert.equal(method,'account/login/start');assert.equal(params.type,'chatgptDeviceCode');return {loginId:'login',verificationUrl:'https://auth.openai.com/codex/device',userCode:'TEST-CODE'};}
    async close(){this.closed=true;}
    async complete(account='SYNTHETIC_ACCOUNT',user='SYNTHETIC_USER'){
      await writeFile(join(this.directory,'auth.json'),JSON.stringify({auth_mode:'chatgpt',tokens:{account_id:account,refresh_token:'SYNTHETIC_REFRESH',id_token:'header.'+Buffer.from(JSON.stringify({email:'test@example.com','https://api.openai.com/auth':{chatgpt_user_id:user}})).toString('base64url')+'.signature'}}));
      this.events.push({method:'account/login/completed',params:{loginId:'login',success:true}});
    }
  }
  const login=new OfficialLogin(home,'original.exe',Client);t.after(()=>login.cancel());return {home,login,Client};
}
test('device login registers a new private profile without changing host auth or exposing tokens',async t=>{
  const {home,login,Client}=await fixture(t);const state=await login.start();assert.equal(state.status,'waiting');
  assert.equal(state.userCode,'TEST-CODE');await assert.rejects(login.start(),/正在进行/);
  await Client.current.complete();await login.poll();assert.equal(login.view().status,'completed');
  const names=await readdir(join(home,'session-identities','profiles'));assert.equal(names.length,1);
  const directory=join(home,'session-identities','profiles',names[0]);
  const profile=JSON.parse(await readFile(join(directory,'profile.json'),'utf8'));assert.equal(profile.kind,'chatgpt');assert.equal(profile.userId,'SYNTHETIC_USER');
  assert.match(await readFile(join(directory,'auth.json'),'utf8'),/SYNTHETIC_REFRESH/);
  assert.equal(await readFile(join(home,'auth.json'),'utf8'),'GLOBAL_AUTH_UNCHANGED');
  assert.doesNotMatch(JSON.stringify(login.view()),/SYNTHETIC_REFRESH|SYNTHETIC_ACCOUNT|signature/);
});
test('same account and user is refused and the staging credentials are cleaned',async t=>{
  const {home,login,Client}=await fixture(t);const directory=join(home,'session-identities','profiles','existing');await mkdir(directory,{recursive:true});
  const original=JSON.stringify({kind:'chatgpt',accountId:'SYNTHETIC_ACCOUNT',userId:'SYNTHETIC_USER'});await writeFile(join(directory,'profile.json'),original);
  await login.start();await Client.current.complete();await login.poll();assert.equal(login.view().status,'duplicate');
  assert.deepEqual(await readdir(join(home,'session-identities')),['profiles']);assert.equal(await readFile(join(directory,'profile.json'),'utf8'),original);
});
test('cancellation stops only the isolated login process and removes its staging directory',async t=>{
  const {home,login,Client}=await fixture(t);await login.start();await login.cancel();assert.equal(Client.current.closed,true);assert.equal(login.view().status,'cancelled');
  assert.deepEqual(await readdir(join(home,'session-identities')),[]);assert.equal(await readFile(join(home,'auth.json'),'utf8'),'GLOBAL_AUTH_UNCHANGED');
});

test('refresh login replaces only the matching private profile and preserves its identity binding',async t=>{
  const {home,login,Client}=await fixture(t);const directory=join(home,'session-identities','profiles','target');await mkdir(directory,{recursive:true});
  await writeFile(join(directory,'profile.json'),JSON.stringify({kind:'chatgpt',accountId:'SYNTHETIC_ACCOUNT',userId:'SYNTHETIC_USER',providerId:'identity_target'}));
  await writeFile(join(directory,'auth.json'),JSON.stringify({auth_mode:'chatgpt',tokens:{account_id:'SYNTHETIC_ACCOUNT',refresh_token:'OLD_REFRESH'}}));
  const state=await login.startRefresh('target');assert.equal(state.status,'waiting');await Client.current.complete();await login.poll();
  assert.equal(login.view().status,'completed');assert.match(await readFile(join(directory,'auth.json'),'utf8'),/SYNTHETIC_REFRESH/);assert.match(await readFile(join(directory,'auth.json'),'utf8'),/SYNTHETIC_ACCOUNT/);
  assert.match(await readFile(join(directory,'profile.json'),'utf8'),/identity_target/);assert.equal(await readFile(join(home,'auth.json'),'utf8'),'GLOBAL_AUTH_UNCHANGED');
  assert.deepEqual(await readdir(join(home,'session-identities')),['profiles']);
});

test('refresh login rejects a different official account without touching the old credentials',async t=>{
  const {home,login,Client}=await fixture(t);const directory=join(home,'session-identities','profiles','target');await mkdir(directory,{recursive:true});
  await writeFile(join(directory,'profile.json'),JSON.stringify({kind:'chatgpt',accountId:'SYNTHETIC_ACCOUNT',userId:'SYNTHETIC_USER'}));
  const old=JSON.stringify({auth_mode:'chatgpt',tokens:{account_id:'SYNTHETIC_ACCOUNT',refresh_token:'OLD_REFRESH'}});await writeFile(join(directory,'auth.json'),old);
  await login.startRefresh('target');await Client.current.complete('OTHER_ACCOUNT','OTHER_USER');await login.poll();
  assert.equal(login.view().status,'account_mismatch');assert.equal(await readFile(join(directory,'auth.json'),'utf8'),old);assert.deepEqual(await readdir(join(home,'session-identities')),['profiles']);
});

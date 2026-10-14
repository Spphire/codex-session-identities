import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {OfficialUsage,normalizeOfficialUsage} from '../official-usage.mjs';
import {panelServer} from '../server.mjs';

const payload=(account,user,used=22)=>({account_id:account,user_id:user,plan_type:'pro',rate_limit:{primary_window:{used_percent:used,limit_window_seconds:300*60,reset_at:2000000000},secondary_window:{used_percent:40,limit_window_seconds:10080*60,reset_at:2000600000}},credits:{has_credits:true,unlimited:false,balance:'12.5'},private:'DO-NOT-EXPOSE'});
function fixture(t){
  const home=mkdtempSync(join(tmpdir(),'official-usage-'));
  t.after(()=>rmSync(home,{recursive:true,force:true}));
  const put=(id,account,user,kind='chatgpt',token='DO-NOT-EXPOSE-'+id)=>{
    const directory=join(home,'session-identities','profiles',id);mkdirSync(directory,{recursive:true});
    writeFileSync(join(directory,'profile.json'),JSON.stringify({kind,accountId:account,userId:user,providerId:'official'}));
    const file=join(kind==='chatgpt-system'?home:directory,'auth.json');
    writeFileSync(file,JSON.stringify({auth_mode:'chatgpt',tokens:{account_id:account,access_token:token,id_token:'h.'+Buffer.from(JSON.stringify({email:id+'@example.com','https://api.openai.com/auth':{chatgpt_user_id:user}})).toString('base64url')+'.s'}}));
    return {id,runtimeId:id,runtimeIds:[id],kind:'chatgpt',available:true,removed:false,file};
  };
  const a=put('a','ACCOUNT-A','USER-A','chatgpt-system');const b=put('b','ACCOUNT-B','USER-B');
  return {home,a,b,put};
}
const settled=()=>new Promise(resolve=>setImmediate(resolve));

test('usage preserves null vs zero, clamps remaining percent and fences account/user',()=>{
  const credential={accountId:'A',userId:'U'};const raw=payload('A','U',120);
  raw.additional_rate_limits=[{metered_feature:'model-x',limit_name:'Model X',rate_limit:{primary_window:{used_percent:10,reset_at:null}}}];
  const result=normalizeOfficialUsage(raw,credential);
  assert.equal(result.limits[0].primary.remainingPercent,0);assert.equal(result.limits[1].primary.resetsAt,null);
  assert.equal(result.credits.balance,'12.5');assert.doesNotMatch(JSON.stringify(result),/DO-NOT-EXPOSE|ACCOUNT/);
  assert.throws(()=>normalizeOfficialUsage(payload('B','U'),credential),{code:'account_mismatch'});
  assert.throws(()=>normalizeOfficialUsage(payload('A','V'),credential),{code:'account_mismatch'});
  raw.credits.balance=null;assert.equal(normalizeOfficialUsage(raw,credential).credits.balance,null);
  raw.credits.balance='0';assert.equal(normalizeOfficialUsage(raw,credential).credits.balance,'0');
  raw.credits.balance='DO-NOT-EXPOSE';assert.equal(normalizeOfficialUsage(raw,credential).credits.balance,null);
  assert.throws(()=>normalizeOfficialUsage({rate_limit:{primary_window:{used_percent:null}}},credential),{code:'invalid_response'});
});

test('distinct identities use distinct tokens and caches; aliases dedupe, manual refresh throttles',async t=>{
  const {home,a,b,put}=fixture(t);const alias=put('alias','ACCOUNT-A','USER-A','chatgpt','DO-NOT-EXPOSE-a');
  let clock=100000;const calls=[];
  const service=new OfficialUsage(home,{now:()=>clock,fetchUsage:async credential=>{calls.push(credential);return payload(credential.accountId,credential.userId,credential.accountId==='ACCOUNT-A'?22:41);}});t.after(()=>service.close());
  const identities=[a,b,alias];assert.equal(service.snapshot(identities).a.status,'loading');await settled();
  const state=service.snapshot(identities);assert.equal(calls.length,2);
  assert.equal(state.a.limits[0].primary.remainingPercent,78);assert.equal(state.b.limits[0].primary.remainingPercent,59);assert.deepEqual(state.a,state.alias);
  assert.deepEqual(calls.map(x=>x.token),['DO-NOT-EXPOSE-a','DO-NOT-EXPOSE-b']);assert.doesNotMatch(JSON.stringify(state),/DO-NOT-EXPOSE|ACCOUNT-A|USER-A/);
  service.snapshot(identities,{refresh:true});await settled();assert.equal(calls.length,2);
  clock+=30001;service.snapshot(identities,{refresh:true});await settled();assert.equal(calls.length,4);
  clock+=300001;service.snapshot(identities);await settled();assert.equal(calls.length,6);
});

test('token rotation invalidates cache and invalid/mismatched/removed identities do not query',async t=>{
  const {home,a,b}=fixture(t);let calls=0;
  const service=new OfficialUsage(home,{fetchUsage:async credential=>{calls++;return payload(credential.accountId,credential.userId);}});t.after(()=>service.close());
  service.snapshot([a]);await settled();assert.equal(calls,1);
  const auth=JSON.parse(readFileSync(a.file));auth.tokens.access_token='DO-NOT-EXPOSE-ROTATED';writeFileSync(a.file,JSON.stringify(auth));
  assert.equal(service.snapshot([a]).a.status,'loading');await settled();assert.equal(calls,2);
  auth.tokens.account_id='OTHER';writeFileSync(a.file,JSON.stringify(auth));
  const state=service.snapshot([a,{...b,removed:true},{id:'api',kind:'api',available:true}]);await settled();
  assert.equal(state.a.status,'unavailable');assert.equal(state.b,undefined);assert.equal(calls,2);assert.equal(service.cache.size,0);
});

test('in-flight credential change prevents attribution of old results',async t=>{
  const {home,a}=fixture(t);let release;
  const service=new OfficialUsage(home,{fetchUsage:()=>new Promise(resolve=>{release=resolve;})});t.after(()=>service.close());
  service.snapshot([a]);const entry=[...service.cache.values()][0];
  const auth=JSON.parse(readFileSync(a.file));auth.tokens.access_token='NEW';writeFileSync(a.file,JSON.stringify(auth));
  release(payload('ACCOUNT-A','USER-A'));await settled();assert.equal(entry.data,null);assert.equal(entry.status,'error');
});

test('network errors retain marked old data, back off and never leak upstream errors',async t=>{
  const {home,a}=fixture(t);let clock=100000;let fail=false;let calls=0;
  const service=new OfficialUsage(home,{now:()=>clock,fetchUsage:async credential=>{calls++;if(fail)throw new Error('Bearer DO-NOT-EXPOSE');return payload(credential.accountId,credential.userId);}});t.after(()=>service.close());
  service.snapshot([a]);await settled();clock+=300001;fail=true;service.snapshot([a]);await settled();
  const state=service.snapshot([a]);assert.equal(state.a.stale,true);assert.equal(state.a.status,'error');assert.equal(state.a.credits.balance,'12.5');assert.doesNotMatch(JSON.stringify(state),/DO-NOT-EXPOSE/);
  clock+=30001;service.snapshot([a],{refresh:true});await settled();assert.equal(calls,2);
  clock+=30000;service.snapshot([a]);await settled();assert.equal(calls,3);
});

test('bounded concurrency and shutdown abort outstanding queries without dispatching removed jobs',async t=>{
  const {home,a,b,put}=fixture(t);const c=put('c','C','U');const pending=[];
  const service=new OfficialUsage(home,{concurrency:1,fetchUsage:(credential,signal)=>new Promise((resolve,reject)=>{pending.push({credential,resolve,signal});signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});})});t.after(()=>service.close());
  service.snapshot([a,b,c]);assert.equal(pending.length,1);assert.equal(service.active,1);
  service.snapshot([a,c]);pending[0].resolve(payload('ACCOUNT-A','USER-A'));await settled();
  assert.equal(pending.length,2);assert.equal(pending[1].credential.accountId,'C');service.close();await settled();
  assert.equal(pending[1].signal.aborted,true);assert.equal(service.active,0);assert.equal(service.cache.size,0);
});

test('quota HTTP endpoint is authenticated and does not block state on upstream work',async t=>{
  const {home}=fixture(t);const db=new DatabaseSync(join(home,'state_5.sqlite'));
  db.exec('CREATE TABLE threads(id TEXT,title TEXT,model_provider TEXT,model TEXT,cwd TEXT,updated_at INTEGER,archived INTEGER)');db.close();
  const server=panelServer({codexDirectory:home,switcherDirectory:join(home,'identity-switcher'),officialUsageOptions:{fetchUsage:(_credential,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))}});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;const headers={'X-Codex-Identity-Access':server.identityAccessToken};
  assert.equal((await fetch(base+'/api/official-usage')).status,401);
  const response=await fetch(base+'/api/official-usage',{headers});assert.equal(response.status,200);assert.equal((await response.json()).identities.a.status,'loading');
  assert.equal((await fetch(base+'/api/state',{headers,signal:AbortSignal.timeout(1000)})).status,200);
});

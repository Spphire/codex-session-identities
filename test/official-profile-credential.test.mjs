import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve,sep} from 'node:path';
import {validatePinnedAuth,readPinnedCredential} from '../official-profile-credential.mjs';
const jwt=claims=>'e30.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.synthetic';
const profile={kind:'chatgpt',accountId:'pinned-account',userId:'pinned-user'};
const auth=(account='pinned-account',user='pinned-user',exp=Date.now()/1000+3600)=>({auth_mode:'chatgpt',tokens:{account_id:account,id_token:jwt({'https://api.openai.com/auth':{chatgpt_user_id:user}}),access_token:jwt({exp})}});
test('independent credential requires the pinned account and user',()=>{
 assert.ok(validatePinnedAuth(profile,auth()).token);
 assert.throws(()=>validatePinnedAuth(profile,auth('different-account')),/mismatch/);
 assert.throws(()=>validatePinnedAuth(profile,auth('pinned-account','different-user')),/mismatch/);
 assert.throws(()=>validatePinnedAuth({...profile,kind:'chatgpt-system'},auth()),/Independent/);
});
test('credential reads only its profile and rechecks identity after refresh',async()=>{
 const root=await mkdtemp(join(tmpdir(),'identity-credential-test-'));const id='chatgpt_test';const directory=join(root,'session-identities/profiles',id);
 await mkdir(directory,{recursive:true});await writeFile(join(directory,'profile.json'),JSON.stringify(profile));
 const global=JSON.stringify(auth('global-account','global-user'));await writeFile(join(root,'auth.json'),global);
 try{
  const fresh=auth();await writeFile(join(directory,'auth.json'),JSON.stringify(fresh));
  assert.equal(await readPinnedCredential(root,id),fresh.tokens.access_token);
  const check=await readPinnedCredential(root,id,{check:true});assert.equal(check.pinnedAccountVerified,true);assert.equal('token' in check,false);
  await writeFile(join(directory,'auth.json'),JSON.stringify(auth('pinned-account','pinned-user',1)));
  await assert.rejects(readPinnedCredential(root,id),/refresh/);
  const refreshed=await readPinnedCredential(root,id,{refresh:async path=>{assert.equal(path,directory);await writeFile(join(directory,'auth.json'),JSON.stringify(fresh))}});assert.equal(refreshed,fresh.tokens.access_token);
  await writeFile(join(directory,'auth.json'),JSON.stringify(auth('pinned-account','pinned-user',1)));
  await assert.rejects(readPinnedCredential(root,id,{refresh:async()=>{await writeFile(join(directory,'auth.json'),JSON.stringify(auth('wrong-account')))}}),/mismatch/);
  assert.equal(await readFile(join(root,'auth.json'),'utf8'),global);
 }finally{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'identity-credential-test-'));await rm(root,{recursive:true,force:true})}
});

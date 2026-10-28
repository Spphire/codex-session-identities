import test from 'node:test';import assert from 'node:assert/strict';import {join} from 'node:path';import {officialAlias,legacyAliasNeedsMigration} from '../ensure-provider-aliases.mjs';
test('independent official placeholder cannot conflict with pinned native authentication',()=>{
 const profile={kind:'chatgpt',accountId:'private-account',userId:'private-user',providerId:'identity_chatgpt_abc_def'};
 const provider=officialAlias('C:/adapter','C:/home','chatgpt_abc-def',profile,{accountId:'global-account',userId:'global-user'});
 assert.equal(provider.requires_openai_auth,false);assert.equal(provider.http_headers['ChatGPT-Account-Id'],'private-account');assert.equal(provider.auth,undefined);assert.equal(provider.experimental_bearer_token,undefined);
});
test('migration recognizes only the exact owned legacy credential command',()=>{
 const root='C:/adapter',home='C:/home',id='chatgpt_abc-def';const profile={kind:'chatgpt',accountId:'private-account'};
 const old={requires_openai_auth:false,http_headers:{'ChatGPT-Account-Id':'private-account'},auth:{command:join(root,'node.exe'),cwd:root,args:[join(root,'official-profile-credential.mjs'),home,id]}};
 assert.equal(legacyAliasNeedsMigration(root,home,id,profile,old),true);
 assert.equal(legacyAliasNeedsMigration(root,home,id,profile,{...old,auth:{...old.auth,command:'custom.exe'}}),false);
 assert.equal(legacyAliasNeedsMigration(root,home,id,profile,{...old,http_headers:{'ChatGPT-Account-Id':'other'}}),false);
 assert.equal(legacyAliasNeedsMigration(root,home,id,profile,{...old,requires_openai_auth:true}),false);
 assert.equal(legacyAliasNeedsMigration(root,home,id,{...profile,kind:'api'},old),false);
});
test('system alias requires both account and user, and arbitrary provider keys are refused',()=>{
 const profile={kind:'chatgpt-system',providerId:'identity_chatgpt_system_abc',accountId:'account',userId:'user'};
 assert.equal(officialAlias('C:/adapter','C:/home','chatgpt_system_abc',profile,{accountId:'account',userId:'other'}),null);
 assert.equal(officialAlias('C:/adapter','C:/home','chatgpt_system_abc',profile,{accountId:'other',userId:'user'}),null);
 assert.equal(officialAlias('C:/adapter','C:/home','chatgpt_system_abc',profile,{accountId:'account',userId:'user'}).requires_openai_auth,true);
 assert.equal(officialAlias('C:/adapter','C:/home','chatgpt_system_abc',{...profile,providerId:'wrong'},{}),null);
});

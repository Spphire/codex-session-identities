import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const home=process.argv[2];
const directory=join(home,'session-identities','profiles','chatgpt_second_official');
function metadata(auth){
  assert.equal(auth.auth_mode,'chatgpt');
  const claims=JSON.parse(Buffer.from(auth.tokens.id_token.split('.')[1],'base64url').toString('utf8'));
  const info=claims['https://api.openai.com/auth'];
  const accountId=auth.tokens.account_id;const userId=info?.chatgpt_user_id||info?.user_id;
  assert.ok(accountId&&userId);return {accountId,userId};
}
const original=metadata(JSON.parse(await readFile(join(home,'auth.json'),'utf8')));
const second=metadata(JSON.parse(await readFile(join(directory,'auth.json'),'utf8')));
assert.notEqual(second.accountId,original.accountId,'Second login belongs to the original account');
assert.notEqual(second.userId,original.userId,'Second login belongs to the original user');
const profile={kind:'chatgpt',providerId:'identity_chatgpt_second_official',...second,provider:{name:'OpenAI',base_url:'https://chatgpt.com/backend-api/codex',wire_api:'responses',requires_openai_auth:true}};
await writeFile(join(directory,'profile.json'),JSON.stringify(profile),{flag:'wx'});
await writeFile(join(directory,'label.json'),JSON.stringify({name:'官方账号 B（独立登录）'}));
console.log(JSON.stringify({registered:true,distinctAccounts:true,distinctUsers:true,credentialsCopied:false}));

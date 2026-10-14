// Register only identity metadata. The patched server reuses its existing global AuthManager.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

const home=process.argv[2];
if(!home)throw new Error('Pass the existing Codex home directory');
const auth=JSON.parse(await readFile(join(home,'auth.json'),'utf8'));
if(auth.auth_mode!=='chatgpt'||!auth.tokens?.id_token)throw new Error('The current login is not a ChatGPT login');
const claims=JSON.parse(Buffer.from(auth.tokens.id_token.split('.')[1],'base64url').toString('utf8'));
const accountId=auth.tokens.account_id;
const info=claims['https://api.openai.com/auth'];
const userId=info?.chatgpt_user_id||info?.user_id;
if(!accountId||!userId)throw new Error('Current login has no complete identity metadata');
const id='chatgpt_system_'+createHash('sha256').update(accountId+'\0'+userId).digest('hex').slice(0,20);
const directory=join(home,'session-identities','profiles',id);await mkdir(directory,{recursive:true});
const profile={kind:'chatgpt-system',providerId:'identity_'+id,accountId,userId,provider:{name:'OpenAI',base_url:'https://chatgpt.com/backend-api/codex',wire_api:'responses',requires_openai_auth:true}};
try{await writeFile(join(directory,'profile.json'),JSON.stringify(profile),{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
await writeFile(join(directory,'label.json'),JSON.stringify({name:'官方账号（原有登录）'}));
console.log(JSON.stringify({registered:true,identityId:id,credentialCopied:false}));

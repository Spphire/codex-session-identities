import {readFile,readdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {StdioClient} from './stdio-client.mjs';

const root=dirname(fileURLToPath(import.meta.url));
const config=JSON.parse(await readFile(join(root,'runtime-config.json'),'utf8'));
const home=config.codexHome;const registry=join(home,'session-identities');
const auth=JSON.parse(await readFile(join(home,'auth.json'),'utf8').catch(()=> '{}'));
let claims={};try{claims=JSON.parse(Buffer.from(auth.tokens.id_token.split('.')[1],'base64url').toString());}catch{}
const info=claims['https://api.openai.com/auth']||{};
const identities=new Set();
for(const file of await readdir(join(registry,'bindings')).catch(()=>[])){
  if(!/^[a-f0-9-]{36}\.json$/.test(file))continue;
  const binding=JSON.parse(await readFile(join(registry,'bindings',file),'utf8'));
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(binding.identityId))throw new Error('Invalid binding reference');
  identities.add(binding.identityId);
}
const edits=[];
for(const id of identities){
  const profile=JSON.parse(await readFile(join(registry,'profiles',id,'profile.json'),'utf8'));
  if(profile.kind==='chatgpt')throw new Error('Rebind independently registered official accounts before returning to the unpatched global-login runtime.');
  if(profile.kind==='chatgpt-system' && (profile.accountId!==auth.tokens?.account_id||profile.userId!==(info.chatgpt_user_id||info.user_id)))throw new Error('The fixed official identity no longer matches the global login. Rebind these sessions first.');
  if(!profile.provider)throw new Error('A bound profile has no pinned provider definition');
  edits.push({keyPath:'model_providers.'+profile.providerId,value:profile.provider,mergeStrategy:'upsert'});
}
const rpc=new StdioClient(config.originalCodexExe,['app-server','--stdio'],{cwd:home,env:{...process.env,CODEX_HOME:home}});
try{await rpc.initialize('identity_compat_export');if(edits.length)await rpc.call('config/batchWrite',{edits,reloadUserConfig:true});console.log(JSON.stringify({compatibilityProviders:edits.length,historyChanged:false}));}
finally{await rpc.close();}

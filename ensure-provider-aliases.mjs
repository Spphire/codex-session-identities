import {readFile,readdir,copyFile,mkdir} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {StdioClient} from './stdio-client.mjs';

export function officialAlias(root,home,id,profile,globalIdentity={}){
  if(!/^chatgpt_[A-Za-z0-9_-]{1,100}$/.test(id)||profile.providerId!=='identity_'+id.replaceAll('-','_')||!profile.accountId||!profile.userId)return null;
  const provider={name:'OpenAI',base_url:'https://chatgpt.com/backend-api/codex',wire_api:'responses'};
  if(profile.kind==='chatgpt-system'){
    if(profile.accountId!==globalIdentity.accountId||profile.userId!==globalIdentity.userId)return null;
    return {...provider,requires_openai_auth:true};
  }
  if(profile.kind!=='chatgpt')return null;
  // Native identity loading deep-merges this table with its pinned provider.
  // A global auth command would survive that merge and conflict with native
  // requires_openai_auth=true. Keep a credential-free placeholder instead:
  // the native identity manager supplies the pinned account at resume/switch.
  return {...provider,requires_openai_auth:false,http_headers:{'ChatGPT-Account-Id':profile.accountId}};
}

export function legacyAliasNeedsMigration(root,home,id,profile,current){
 if(profile.kind!=='chatgpt'||!current||current.requires_openai_auth!==false)return false;
 const auth=current.auth;
 return current.http_headers?.['ChatGPT-Account-Id']===profile.accountId&&auth?.command===join(root,'node.exe')&&auth.cwd===root&&JSON.stringify(auth.args)===JSON.stringify([join(root,'official-profile-credential.mjs'),home,id]);
}

async function main(){
 const root=resolve(process.argv[2]||dirname(fileURLToPath(import.meta.url)));
 const runtime=JSON.parse(await readFile(join(root,'runtime-config.json'),'utf8'));const home=runtime.codexHome;
 let globalIdentity={};
 try{const auth=JSON.parse(await readFile(join(home,'auth.json'),'utf8'));if(auth.auth_mode==='chatgpt'){const info=JSON.parse(Buffer.from(auth.tokens.id_token.split('.')[1],'base64url'))['https://api.openai.com/auth'];globalIdentity={accountId:auth.tokens.account_id,userId:info.chatgpt_user_id||info.user_id}}}catch{}
 const directory=join(home,'session-identities/profiles');const candidates=[];
 for(const id of await readdir(directory).catch(()=>[])){
  try{const profile=JSON.parse(await readFile(join(directory,id,'profile.json'),'utf8'));const provider=officialAlias(root,home,id,profile,globalIdentity);if(provider)candidates.push({id:profile.providerId,profileId:id,profile,provider})}catch{}
 }
 if(!candidates.length){console.log('{"passed":true,"providersAdded":0}');return}
 const client=new StdioClient(runtime.originalCodexExe,['-c','model_provider="openai"','app-server','--listen','stdio://'],{cwd:home,env:{...process.env,CODEX_HOME:home}});
 try{
  await client.initialize('identity_provider_compatibility');const before=await client.call('config/read',{includeLayers:false});
  const missing=candidates.filter(x=>!before.config.model_providers?.[x.id]);
  const migrated=candidates.filter(x=>legacyAliasNeedsMigration(root,home,x.profileId,x.profile,before.config.model_providers?.[x.id]));
  const changes=[...missing,...migrated];
  if(changes.length){
   await mkdir(join(root,'backups'),{recursive:true});
   await copyFile(join(home,'config.toml'),join(root,'backups','config-before-alias-sync-'+Date.now()+'.toml'));
   await client.call('config/batchWrite',{edits:changes.map(x=>({keyPath:'model_providers.'+x.id,value:x.provider,mergeStrategy:'replace'})),reloadUserConfig:true});
   const after=await client.call('config/read',{includeLayers:false});if(changes.some(x=>!after.config.model_providers?.[x.id]||after.config.model_providers[x.id].auth))throw new Error('Provider read-back failed');
  }
  console.log(JSON.stringify({passed:true,providersAdded:missing.length,providersMigrated:migrated.length}));
 }finally{await client.close()}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Identity provider definitions could not be repaired; the global login was not changed.');process.exitCode=1});

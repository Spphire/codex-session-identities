// This command is consumed only by Codex's bearer-token pipe. Never log tokens.
import {readFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {StdioClient} from './stdio-client.mjs';

const decode=value=>JSON.parse(Buffer.from(value.split('.')[1],'base64url').toString('utf8'));
export function validatePinnedAuth(profile,auth){
  if(profile.kind!=='chatgpt'||auth.auth_mode!=='chatgpt')throw new Error('Independent official identity is required');
  const info=decode(auth.tokens?.id_token)['https://api.openai.com/auth']||{};
  if(!profile.accountId||!profile.userId||auth.tokens?.account_id!==profile.accountId||(info.chatgpt_user_id||info.user_id)!==profile.userId)throw new Error('Official identity account/user mismatch');
  const token=auth.tokens?.access_token;
  if(typeof token!=='string'||!token||/[\r\n]/.test(token))throw new Error('Official identity token is unavailable');
  let expiresAt=null;try{const exp=decode(token).exp;if(Number.isFinite(exp))expiresAt=exp*1000}catch{}
  return {token,expiresAt};
}

export async function readPinnedCredential(home,id,{check=false,refresh}={}){
  if(!/^chatgpt_[A-Za-z0-9_-]{1,100}$/.test(id)||id.startsWith('chatgpt_system_'))throw new Error('Invalid independent official identity');
  const directory=join(resolve(home),'session-identities','profiles',id);
  const profile=JSON.parse(await readFile(join(directory,'profile.json'),'utf8'));
  const read=async()=>validatePinnedAuth(profile,JSON.parse(await readFile(join(directory,'auth.json'),'utf8')));
  let credential=await read();
  if(check)return {pinnedAccountVerified:true,credentialPresent:true,expired:credential.expiresAt!==null&&credential.expiresAt<=Date.now()};
  if(credential.expiresAt!==null&&credential.expiresAt<Date.now()+60000){
    if(!refresh)throw new Error('Official identity needs credential refresh');
    await refresh(directory);
    credential=await read();
    if(credential.expiresAt!==null&&credential.expiresAt<=Date.now())throw new Error('Official identity credentials are expired');
  }
  return credential.token;
}

async function main(){
  const [home,id,...args]=process.argv.slice(2);if(!home||!id)throw new Error('Pass Codex home and independent identity id');
  const check=args.includes('--check');
  const refresh=async directory=>{
    const runtime=JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)),'runtime-config.json'),'utf8'));
    const env={...process.env,CODEX_HOME:directory,CODEX_SQLITE_HOME:directory};
    for(const key of Object.keys(env))if(/(?:TOKEN|API_KEY|PASSWORD|SECRET)/i.test(key))delete env[key];
    const client=new StdioClient(runtime.originalCodexExe,['-c','cli_auth_credentials_store="file"','app-server','--listen','stdio://'],{cwd:directory,env});
    try{await client.initialize('identity_profile_credential_refresh');await client.call('account/read',{refreshToken:true},20000)}finally{await client.close()}
  };
  const result=await readPinnedCredential(home,id,{check,refresh});
  process.stdout.write(check?JSON.stringify(result)+'\n':result);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Pinned official identity is unavailable or needs re-login in the identity panel; global login was not used.');process.exitCode=1});

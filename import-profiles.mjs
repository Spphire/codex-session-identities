import {spawn,spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';

const [originalCli,targetHome]=process.argv.slice(2);
if(!originalCli||!targetHome)throw new Error('Usage: node import-profiles.mjs <installed-codex.exe> <target-CODEX_HOME>');
const sourceHome=process.env.CODEX_HOME||join(homedir(),'.codex');
const sourceStore=join(sourceHome,'identity-switcher');
const state=JSON.parse(await readFile(join(sourceStore,'state.json'),'utf8'));
await mkdir(targetHome,{recursive:true});
const child=spawn(originalCli,['app-server','--stdio'],{env:{...process.env,CODEX_HOME:sourceHome},cwd:targetHome,windowsHide:true,stdio:['pipe','pipe','ignore']});
let sequence=0;const waiters=new Map();
createInterface({input:child.stdout}).on('line',line=>{
  let message;try{message=JSON.parse(line);}catch{return;}
  const waiter=waiters.get(message.id);if(!waiter)return;waiters.delete(message.id);clearTimeout(waiter.timer);
  message.error?waiter.reject(new Error('Configuration RPC rejected import')):waiter.resolve(message.result);
});
const call=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{waiters.delete(id);reject(new Error('Configuration RPC timed out'));},20000);waiters.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
const root=dirname(fileURLToPath(import.meta.url));
let imported=0;
try{
  await call('initialize',{clientInfo:{name:'identity_profile_import',version:'0.1.0'}});
  child.stdin.write('{"method":"initialized","params":{}}\n');
  const result=await call('config/read',{includeLayers:true});
  const userLayer=result.layers?.find(layer=>layer.name?.type==='user');
  const providers=userLayer?.config?.model_providers||result.config.model_providers||{};
  async function save(id,profile,label){
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw new Error('Unsupported identity ID');
    const directory=join(targetHome,'session-identities','profiles',id);await mkdir(directory,{recursive:true});
    const destination=join(directory,'profile.json');
    try{await writeFile(destination,JSON.stringify(profile),{flag:'wx'});}catch(error){
      if(error.code!=='EEXIST')throw error;
      const existing=JSON.parse(await readFile(destination,'utf8'));
      if(existing.kind==='api'&&profile.kind==='api'&&existing.providerId===profile.providerId&&existing.provider?.base_url===profile.provider?.base_url){
        existing.provider.auth=profile.provider.auth;
        const temporary=destination+'.import.tmp';await writeFile(temporary,JSON.stringify(existing));await rename(temporary,destination);
      }
    }
    await writeFile(join(directory,'label.json'),JSON.stringify({name:label}));imported++;
  }
  for(const identity of state.identities||[]){
    const entry=providers[identity.providerId];
    let command=join(root,'codex-identity-credential.exe');let args=['--provider-id',identity.providerId];
    const check=spawnSync(command,[...args,'--check'],{windowsHide:true,stdio:'ignore'});
    if(check.status!==0){
      command=entry?.auth?.command;args=entry?.auth?.args?[...entry.auth.args]:null;
      if(!command||!args)throw new Error('Registered API credential is unavailable in Windows Credential Manager');
      const index=args.findIndex(x=>x==='--provider-id'||x==='--credential');
      if(index<0||index+1>=args.length)throw new Error('Unsupported credential helper arguments');
      args[index+1]=identity.providerId;
    }
    const id=`api_${identity.id}`;
    await save(id,{kind:'api',providerId:`identity_${id.replaceAll('-','_')}`,provider:{name:identity.name,base_url:identity.baseURL,wire_api:'responses',requires_openai_auth:false,auth:{command,args,refresh_interval_ms:0}}},identity.name);
  }
  for(const account of state.officialAccounts||[]){
    if(state.activeOfficialAccountId===account.id)continue;
    const id=`chatgpt_${account.id}`;
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw new Error('Unsupported official identity ID');
    const destination=join(targetHome,'session-identities','profiles',id,'auth.json');
    const decrypted=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'official-vault.ps1'),'-VaultFile',join(sourceStore,'official-accounts',`${account.id}.dpapi`),'-Destination',destination,'-ExpectedIdentity',account.authIdentity],{windowsHide:true,encoding:'utf8'});
    if(decrypted.status!==0)throw new Error('Official identity could not be imported');
    const metadata=JSON.parse(decrypted.stdout.trim());
    await save(id,{kind:'chatgpt',providerId:`identity_${id.replaceAll('-','_')}`,accountId:metadata.accountId,userId:metadata.userId,provider:{name:'OpenAI',base_url:'https://chatgpt.com/backend-api/codex',wire_api:'responses',requires_openai_auth:true}},account.name);
  }
  console.log(JSON.stringify({imported,targetHome,globalConfigChanged:false}));
}catch(error){console.error(error.message);process.exitCode=1;}
finally{child.stdin.end();if(child.exitCode===null){const timer=setTimeout(()=>child.kill(),5000);await once(child,'exit');clearTimeout(timer);}}

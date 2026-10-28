import {spawn} from 'node:child_process';
import {mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=dirname(fileURLToPath(import.meta.url));
export function validateApiIdentity(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['name','baseUrl','apiKey','model'].includes(k)))throw new Error('API 身份字段无效。');
  const {name,baseUrl,apiKey,model}=input;
  if(typeof name!=='string'||!name.trim()||name.trim().length>80||/[\x00-\x1f\x7f]/.test(name))throw new Error('请填写 1–80 字的身份名称。');
  if(typeof model!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(model.trim()))throw new Error('请填写服务商支持的模型 ID。');
  if(typeof apiKey!=='string'||!apiKey||Buffer.byteLength(apiKey)>2560||/[\s\x00-\x1f\x7f]/.test(apiKey))throw new Error('API Key 不能为空、包含空白或超过 2560 字节。');
  let url;try{if(typeof baseUrl!=='string'||baseUrl.length>2048||/[\x00-\x1f\x7f]/.test(baseUrl))throw 0;url=new URL(baseUrl.trim())}catch{throw new Error('请填写完整的 API Base URL。')}
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(url.protocol!=='https:'&&!(local&&url.protocol==='http:'))throw new Error('Base URL 需使用 HTTPS；本机服务可使用 HTTP。');
  if(url.username||url.password||url.search||url.hash)throw new Error('Base URL 不能包含账号、密码、查询参数或片段。');
  if(/\/responses\/?$/i.test(url.pathname))throw new Error('请输入 API 根地址（通常以 /v1 结尾），不要包含 /responses。');
  return {name:name.trim(),baseUrl:url.href.replace(/\/+$/,''),apiKey,model:model.trim()};
}

export function credentialOperation(operation,id,secret,helper=join(root,'codex-identity-credential.exe')){
  return new Promise((resolve,reject)=>{
    const child=spawn(helper,['--provider-id',id,'--'+operation],{windowsHide:true,stdio:['pipe','ignore','ignore']});
    const timer=setTimeout(()=>{child.kill();reject(new Error('凭据操作超时。'))},10000);
    child.stdin.on('error',()=>{});
    child.on('error',()=>{clearTimeout(timer);reject(new Error('Windows 凭据助手不可用。'))});
    child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('Windows 凭据操作失败。'))});
    child.stdin.end(secret??'');
  });
}

export async function addApiIdentity(home,input,{credential=credentialOperation,helper=join(root,'codex-identity-credential.exe')}={}){
  const value=validateApiIdentity(input),id='api_'+randomUUID(),providerId='identity_'+id.replaceAll('-','_');
  const profiles=join(home,'session-identities','profiles'),staging=join(profiles,'.'+id+'.tmp');
  let stored=false;
  try{
    await mkdir(staging,{recursive:true,mode:0o700});
    const profile={kind:'api',providerId,model:value.model,provider:{name:value.name,base_url:value.baseUrl,wire_api:'responses',requires_openai_auth:false,auth:{command:helper,args:['--provider-id',providerId],refresh_interval_ms:0}}};
    await writeFile(join(staging,'profile.json'),JSON.stringify(profile),{mode:0o600,flag:'wx'});
    await writeFile(join(staging,'label.json'),JSON.stringify({name:value.name}),{mode:0o600,flag:'wx'});
    await credential('store',providerId,value.apiKey,helper);stored=true;
    await credential('check',providerId,undefined,helper);
    await rename(staging,join(profiles,id));
    return {added:true,identityId:id,name:value.name,model:value.model,protocol:'responses',credentialsStored:'windows-credential-manager',connectionVerified:false};
  }catch{
    if(stored)await credential('delete',providerId,undefined,helper).catch(()=>{});
    await rm(staging,{recursive:true,force:true}).catch(()=>{});
    throw new Error('API 身份保存失败，未添加身份。请检查 Windows 凭据助手及安装目录权限。');
  }
}

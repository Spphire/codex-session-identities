import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {request,Agent} from 'node:https';

const safeText=value=>typeof value==='string'?value.slice(0,100):null;
const failure=code=>Object.assign(new Error('Official usage unavailable'),{code});
const messages={login_expired:'登录凭据已失效，请点击“重新登录”并使用原账号授权',account_mismatch:'账号不匹配，未显示额度',rate_limited:'查询频繁，稍后自动重试',network:'额度查询失败，稍后自动重试',invalid_response:'官方未返回有效额度数据'};

function credentials(home,id){
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(id||''))return null;
  try{
    const directory=join(home,'session-identities','profiles',id);
    const profile=JSON.parse(readFileSync(join(directory,'profile.json'),'utf8'));
    if(!['chatgpt','chatgpt-system'].includes(profile.kind))return null;
    const auth=JSON.parse(readFileSync(join(profile.kind==='chatgpt-system'?home:directory,'auth.json'),'utf8'));
    const claims=JSON.parse(Buffer.from(auth.tokens.id_token.split('.')[1],'base64url').toString('utf8'));
    const info=claims['https://api.openai.com/auth'];const userId=info?.chatgpt_user_id||info?.user_id;
    if(auth.auth_mode!=='chatgpt'||!profile.accountId||!profile.userId||auth.tokens.account_id!==profile.accountId||userId!==profile.userId||typeof auth.tokens.access_token!=='string'||!auth.tokens.access_token)return null;
    const accountId=profile.accountId;const token=auth.tokens.access_token;
    return {accountId,userId,token,key:createHash('sha256').update(JSON.stringify([accountId,userId,token])).digest('hex')};
  }catch{return null;}
}

// Match the native backend-client's passive /wham/usage GET; never follow redirects.
export async function fetchOfficialUsage({accountId,token},signal){
  const agent=new Agent({keepAlive:false,proxyEnv:process.env});
  try{
    return await new Promise((resolve,reject)=>{
      const req=request('https://chatgpt.com/backend-api/wham/usage',{agent,signal:AbortSignal.any([signal,AbortSignal.timeout(12000)]),headers:{Authorization:`Bearer ${token}`,'ChatGPT-Account-Id':accountId,'User-Agent':'codex-cli',Accept:'application/json'}},res=>{
        if(res.statusCode!==200){res.resume();reject(failure(res.statusCode===401?'login_expired':res.statusCode===429?'rate_limited':'network'));return;}
        const chunks=[];let size=0;
        res.on('data',chunk=>{size+=chunk.length;if(size>1024*1024)res.destroy(failure('invalid_response'));else chunks.push(chunk);});
        res.on('error',()=>reject(failure('network')));
        res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(failure('invalid_response'));}});
      });
      req.on('error',()=>reject(failure('network')));req.end();
    });
  }finally{agent.destroy();}
}

function window(value){
  if(!value||typeof value.used_percent!=='number'||!Number.isFinite(value.used_percent))return null;
  const minutes=value.limit_window_seconds;
  const reset=value.reset_at;
  return {remainingPercent:Math.max(0,Math.min(100,100-value.used_percent)),windowDurationMins:typeof minutes==='number'&&Number.isFinite(minutes)&&minutes>0?minutes/60:null,resetsAt:Number.isSafeInteger(reset)&&reset>0&&reset<8640000000000?reset:null};
}

export function normalizeOfficialUsage(payload,credential){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw failure('invalid_response');
  if(payload.account_id!=null&&payload.account_id!==credential.accountId||payload.user_id!=null&&payload.user_id!==credential.userId)throw failure('account_mismatch');
  const bucket=(id,name,rate)=>({id,name,primary:window(rate?.primary_window),secondary:window(rate?.secondary_window)});
  const limits=[bucket('codex','Codex',payload.rate_limit)];
  if(Array.isArray(payload.additional_rate_limits))for(const item of payload.additional_rate_limits.slice(0,20)){
    if(item&&typeof item.metered_feature==='string')limits.push(bucket(safeText(item.metered_feature),safeText(item.limit_name)||'其他额度',item.rate_limit));
  }
  const raw=payload.credits;
  const balance=typeof raw?.balance==='number'?String(raw.balance):raw?.balance;
  const credits=raw&&typeof raw.has_credits==='boolean'&&typeof raw.unlimited==='boolean'?{hasCredits:raw.has_credits,unlimited:raw.unlimited,balance:typeof balance==='string'&&/^\d+(\.\d+)?$/.test(balance)&&balance.length<=50?balance:null}:null;
  if(!credits&&!limits.some(x=>x.primary||x.secondary))throw failure('invalid_response');
  return {planType:safeText(payload.plan_type),limits:limits.filter(x=>x.primary||x.secondary),credits};
}

export class OfficialUsage {
  constructor(home,{fetchUsage=fetchOfficialUsage,now=Date.now,ttl=300000,retry=60000,concurrency=2}={}){
    this.home=home;this.fetchUsage=fetchUsage;this.now=now;this.ttl=ttl;this.retry=retry;this.concurrency=concurrency;
    this.cache=new Map();this.queue=[];this.active=0;this.closed=false;
  }
  snapshot(identities,{refresh=false}={}){
    const output={};const retained=new Set();
    for(const identity of identities){
      if(identity.kind!=='chatgpt'||identity.removed)continue;
      const credential=identity.available?credentials(this.home,identity.runtimeId):null;
      if(!credential){output[identity.id]={status:'unavailable',message:'登录不匹配或未登记有效凭据'};continue;}
      retained.add(credential.key);
      let entry=this.cache.get(credential.key);
      if(!entry){entry={status:'loading',data:null,nextAt:0};this.cache.set(credential.key,entry);}
      if(!this.closed&&!entry.pending&&(this.now()>=entry.nextAt||refresh&&entry.status==='ready'&&this.now()-entry.lastAttempt>=30000)){
        entry.pending=true;entry.lastAttempt=this.now();
        this.queue.push({entry,credential,id:identity.runtimeId});
      }
      output[identity.id]={status:entry.status,loading:Boolean(entry.pending),...entry.data,message:entry.message||null,updatedAt:entry.updatedAt||null,stale:Boolean(entry.data&&(entry.status==='error'||this.now()-entry.updatedAt>=this.ttl))};
    }
    // Drop removed identities and old tokens, including queued work, before dispatch.
    for(const [key,entry] of this.cache)if(!retained.has(key)){entry.controller?.abort();this.cache.delete(key);}
    this.queue=this.queue.filter(job=>this.cache.get(job.credential.key)===job.entry);
    this.pump();return output;
  }
  pump(){
    while(!this.closed&&this.active<this.concurrency&&this.queue.length){
      const {entry,credential,id}=this.queue.shift();this.active++;
      entry.controller=new AbortController();
      void (async()=>{
        try{
          const result=normalizeOfficialUsage(await this.fetchUsage(credential,entry.controller.signal),credential);
          if(credentials(this.home,id)?.key!==credential.key)throw failure('account_mismatch');
          entry.data=result;entry.status='ready';entry.message=null;entry.updatedAt=this.now();entry.nextAt=this.now()+this.ttl;
        }catch(error){
          const code=Object.hasOwn(messages,error?.code)?error.code:'network';
          if(code==='account_mismatch')entry.data=null;
          entry.status='error';entry.message=messages[code];entry.nextAt=this.now()+this.retry;
        }finally{entry.pending=false;entry.controller=null;this.active--;this.pump();}
      })();
    }
  }
  close(){this.closed=true;this.queue=[];for(const entry of this.cache.values())entry.controller?.abort();this.cache.clear();}
}

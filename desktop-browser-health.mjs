import {readdir,open} from 'node:fs/promises';
import {join} from 'node:path';

// Observe official startup evidence only; never connect to its private browser pipe
// or synthesize feature flags. Unknown evidence must not block a working session.
export async function inspectDesktopBrowser({logsRoot=process.env.LOCALAPPDATA&&join(process.env.LOCALAPPDATA,'Codex','Logs'),now=new Date(),isAlive=pid=>{try{process.kill(pid,0);return true}catch(error){return error.code==='EPERM'}}}={}){
  if(!logsRoot)return {state:'unknown'};
  try{
    const files=[];
    for(const offset of [0,86400000]){
      const [year,month,day]=new Date(now.getTime()-offset).toISOString().slice(0,10).split('-');
      const directory=join(logsRoot,year,month,day);
      for(const name of await readdir(directory).catch(()=>[])){
        const match=name.match(/^codex-desktop-[a-f0-9-]+-(\d+)-t\d+-.*\.log$/i);
        if(match&&isAlive(Number(match[1])))files.push({file:join(directory,name),pid:Number(match[1])});
      }
    }
    const evidence=[];
    for(const item of files){
      const handle=await open(item.file,'r');
      try{
        const {size,mtimeMs}=await handle.stat(),limit=262144;
        const head=Buffer.alloc(Math.min(size,limit));await handle.read(head,0,head.length,0);
        let content=head.toString();
        if(size>limit){const tail=Buffer.alloc(Math.min(size-limit,limit));await handle.read(tail,0,tail.length,size-tail.length);content+='\n'+tail.toString()}
        evidence.push({...item,mtimeMs,ready:/browser-use native pipe listening|browser_use_iab_backend_startup_ready/.test(content),timeout:/Timed out while fetching post-login Statsig bootstrap/.test(content),unavailable:/bundled_plugins_reconcile_skipped_features_unavailable/.test(content)});
      }finally{await handle.close()}
    }
    evidence.sort((a,b)=>b.mtimeMs-a.mtimeMs);
    if(!evidence.length)return {state:'unknown'};
    const pid=evidence[0].pid,active=evidence.filter(item=>item.pid===pid);
    if(active.some(item=>item.ready))return {state:'available',pid};
    if(active.some(item=>item.timeout||item.unavailable))return {state:'unavailable',pid,reason:active.some(item=>item.timeout)?'featureBootstrapTimeout':'featureConfigurationUnavailable',restartRequired:true};
    return {state:'unknown',pid};
  }catch{return {state:'unknown'}}
}

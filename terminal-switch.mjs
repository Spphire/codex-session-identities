import {randomBytes} from 'node:crypto';
import {validThreadId} from './tool-health.mjs';

const stale=()=>new Error('切换请求或后台任务已变化，请重新检查并确认。');
const snapshot=rows=>JSON.stringify(rows.map(t=>[t.processId,t.itemId,t.osPid]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
export class TerminalSwitch {
  constructor(bridge,getCoordinator){this.bridge=bridge;this.getCoordinator=getCoordinator;this.tickets=new Map()}
  async inventory(threadId){
    const rows=[];let cursor=null;const seen=new Set();
    do{
      const page=await this.bridge.call('thread/backgroundTerminals/list',{threadId,cursor,limit:100},5000);
      if(!Array.isArray(page?.data)||page.data.some(t=>!/^\d{1,10}$/.test(t.processId)||typeof t.itemId!=='string'))throw stale();
      rows.push(...page.data);cursor=page.nextCursor??null;
      if(cursor!==null&&(typeof cursor!=='string'||seen.has(cursor)||seen.size>=20))throw stale();seen.add(cursor);
    }while(cursor!==null);
    return rows;
  }
  current(threadId,revision,pid){
    const c=this.getCoordinator(),v=c?.view(threadId);
    const reason=v?.wait?.reason;
    const owned=reason==='loaded_subagent'||(['background_terminals','reply_running','thread_became_busy'].includes(reason)&&v?.wait?.threadId===threadId);
    if(!validThreadId(threadId)||!c||!this.bridge.status().connected||this.bridge.status().pid!==pid||!v?.pending||v.errorCode||v.desiredRevision!==revision||!owned)throw stale();
    return {c,v};
  }
  async prepare({threadId,expectedDesiredRevision}){
    const connection=await this.bridge.connect();
    const {v}=this.current(threadId,expectedDesiredRevision,connection.pid);
    let allOwned=false;
    try{const cap=await this.bridge.call('bridge/terminals/capabilities',{},3000);if(cap?.revision!==1)throw stale();allOwned=cap.forceSwitchRevision===1}catch{throw new Error('当前运行的身份桥接尚未加载强制切换功能；更新已安装后需正常重启 Codex。不会停止任何任务。')}
    if(!allOwned&&v.wait.reason!=='background_terminals')throw new Error('当前桥接仅支持后台终端，尚未加载子代理/回复的完整强制切换功能；请正常重启加载新版。');
    const rows=await this.inventory(threadId);this.current(threadId,expectedDesiredRevision,connection.pid);
    if(!rows.length&&!allOwned)throw new Error('后台终端已结束，请等待自动切换。');
    for(const [key,t] of this.tickets)if(t.until<Date.now())this.tickets.delete(key);
    if(this.tickets.size>=100)this.tickets.delete(this.tickets.keys().next().value);
    const confirmation=randomBytes(24).toString('hex');
    this.tickets.set(confirmation,{threadId,revision:expectedDesiredRevision,pid:connection.pid,identityId:v.desiredIdentityId,allOwned,snapshot:snapshot(rows),until:Date.now()+120000});
    // Commands can contain credentials; display IDs and resource metrics only.
    return {threadId,confirmation,allOwned,reason:v.wait.reason,relatedThreadId:v.wait.threadId,count:rows.length,terminals:rows.map(t=>({processId:t.processId,osPid:t.osPid,cpuPercent:t.cpuPercent,rssKb:t.rssKb})),warning:allOwned?'将暂停此会话的活动目标，终止回复，关闭全部所属子代理和后台终端，并持续处理此范围内的阻塞，直到核验身份已生效。保留已写入的文件和历史；未完成任务会中断。独立分叉和其他聊天不受影响。SSH 已分离的远端任务可能继续运行。':'关闭这些终端会终止其中运行的命令及其子进程；SSH 命令启动的远端任务可能继续运行。仅关闭此会话列出的终端，不关闭分叉会话。'};
  }
  async confirm({threadId,confirmation}){
    const t=this.tickets.get(confirmation);this.tickets.delete(confirmation);
    if(!t||t.threadId!==threadId||t.until<Date.now())throw stale();
    const {c,v}=this.current(threadId,t.revision,t.pid);
    if(v.desiredIdentityId!==t.identityId||c.inflight.has(threadId))throw stale();
    c.inflight.add(threadId);
    try{
      const request=c.store.pendingRequests().find(r=>r.threadId===threadId&&r.desiredRevision===t.revision);
      if(!request)throw stale();
      if(t.allOwned){
        try{
          let goal;
          try{goal=await this.bridge.call('thread/goal/get',{threadId},5000)}catch(error){if(!/goals feature is disabled/i.test(error.message))throw error}
          if(goal?.goal?.status==='active')await this.bridge.call('thread/goal/set',{threadId,origin:'user',status:'paused'},10000);
          const result=await this.bridge.call('thread/identity/forceSet',{threadId,identityId:t.identityId,expectedRevision:request.nativeRevision},150000);
          if(!result.verified||result.status!=='applied'||result.identityId!==t.identityId)throw new Error('后端未确认新身份生效。');
          const current=this.current(threadId,t.revision,t.pid);
          if(current.v.desiredIdentityId!==t.identityId)throw stale();
          c.store.acknowledge(threadId,`runtime-${t.pid}`,t.revision,t.identityId);
          c.waiting.delete(threadId);
          return {status:'applied',verified:true,identityId:result.identityId};
        }catch(error){
          if(this.bridge.status().pid===t.pid){c.store.reject(threadId,`runtime-${t.pid}`,t.revision,'force_unverified');c.waiting.delete(threadId)}
          const detail=/timeout|deadline|超时/i.test(error.message)?'清理或切换超时，请刷新核对实际身份。':/revision|changed|变化/i.test(error.message)?'会话或切换请求已变化。':/auth|credential|login|登录/i.test(error.message)?'请检查目标账号登录状态。':'请刷新运行时状态并检查后台诊断。';
          throw new Error('强制切换未核验成功，已停止自动排队。'+detail);
        }
      }
      const check=await this.bridge.call('thread/identity/set',{threadId,identityId:t.identityId,expectedRevision:request.nativeRevision},10000);
      if(check.verified&&check.identityId===t.identityId)return {status:'retrying',terminated:0};
      if(check.status!=='busy'||check.blocker?.reason!=='background_terminals'||check.blocker.threadId!==threadId)throw new Error('会话已开始回复或存在其他阻塞，未关闭后台终端。');
      const rows=await this.inventory(threadId);if(snapshot(rows)!==t.snapshot)throw stale();
      for(const row of rows){
        const live=this.current(threadId,t.revision,t.pid);if(live.v.desiredIdentityId!==t.identityId)throw stale();
        await this.bridge.call('thread/backgroundTerminals/terminate',{threadId,processId:row.processId},5000);
      }
      const remaining=await this.inventory(threadId);
      return {status:remaining.length?'waiting':'retrying',terminated:rows.length-remaining.filter(row=>rows.some(t=>t.processId===row.processId)).length,remaining:remaining.length};
    }finally{c.inflight.delete(threadId);if(c.closed&&!c.inflight.size)c.closeStore();else void c.tick()}
  }
}

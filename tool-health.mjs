import {randomBytes} from 'node:crypto';
import {validThreadId} from './identity-contract.cjs';

const safeName=value=>typeof value==='string'?value.replace(/[^\p{L}\p{N}_.@ /:-]/gu,'').slice(0,160):'';
const states=new Set(['notStarted','starting','connected','authenticationRequired','failed','cancelled','disabled']);
const authStates=new Set(['unknown','unsupported','notLoggedIn','bearerToken','oAuth','oauth']);
export class ToolHealth {
  constructor(bridge){this.bridge=bridge;this.tickets=new Map();}
  async diagnose(threadId){
    if(!validThreadId(threadId))throw new Error('会话 ID 无效');
    const runtime=await this.bridge.connect();
    const report={threadId,observedAt:new Date().toISOString(),pid:runtime.pid??null,status:'unavailable',servers:[],limitations:['工具目录不代表模型本轮已收到工具，也不代表工具执行成功。','桌面注入工具、浏览器 URL 校验和 SSH 登录不在 MCP 重连的修复范围内；本操作不放宽授权。']};
    if(!runtime.connected){report.message='身份后端未连接，请先正常打开 Codex。';return report;}
    try{
      const capability=await this.bridge.call('bridge/tools/capabilities',{},3000);
      if(capability?.revision!==1)throw new Error('unsupported');
    }catch{report.status='unsupported';report.message='当前运行的身份桥接未启用工具诊断；下次正常重启 Codex 后再试。';return report;}
    try{
      let cursor=null;const seen=new Set();
      do{
        const page=await this.bridge.call('mcpServerStatus/list',{threadId,detail:'toolsAndAuthOnly',limit:100,cursor},12000);
        if(!Array.isArray(page?.data))throw new Error('schema');
        for(const item of page.data){
          report.servers.push({name:safeName(item.name),runtimeStatus:states.has(item.runtimeStatus)?item.runtimeStatus:'unknown',authStatus:authStates.has(item.authStatus)?item.authStatus:'unknown',toolCount:item.tools&&typeof item.tools==='object'?Object.keys(item.tools).length:0,discoveryFailed:Boolean(item.toolsError)});
        }
        cursor=page.nextCursor??null;
        if(cursor!==null&&(typeof cursor!=='string'||seen.has(cursor)||seen.size>=20))throw new Error('pagination');
        seen.add(cursor);
      }while(cursor!==null);
      if(this.bridge.status().pid!==report.pid||!this.bridge.status().connected)throw new Error('changed');
      report.status='observed';report.message='已读取该会话的 MCP 工具目录；未运行工具或发送模型请求。';
      const confirmation=randomBytes(24).toString('hex');
      for(const [key,value] of this.tickets)if(value.until<Date.now())this.tickets.delete(key);
      if(this.tickets.size>=100)this.tickets.delete(this.tickets.keys().next().value);
      this.tickets.set(confirmation,{threadId,pid:report.pid,until:Date.now()+120000});report.confirmation=confirmation;
    }catch{report.status='unavailable';report.servers=[];report.message='无法读取此会话的工具状态：可能尚未加载、接口不兼容或连接超时。请打开会话后重试；未自动加载会话。';}
    return report;
  }
  async recover({threadId,confirmation,scope}){
    const ticket=this.tickets.get(confirmation);this.tickets.delete(confirmation);
    if(!validThreadId(threadId)||scope!=='all-loaded-threads'||!ticket||ticket.threadId!==threadId||ticket.until<Date.now())throw new Error('请重新诊断，并确认影响所有已加载会话后重试');
    const runtime=await this.bridge.connect();
    if(!runtime.connected||runtime.pid!==ticket.pid)throw new Error('身份后端已变化，请重新诊断');
    try{await this.bridge.call('config/mcpServer/reload',{},20000,runtime.pid);}
    catch{throw new Error('MCP 刷新未能确认完成；可能部分会话已收到刷新请求，请先重新诊断，不要连续重试');}
    return {threadId,status:'queued',scope:'all-loaded-threads',message:'后端已接受全局 MCP 配置重新加载。配置变化在后续轮次应用；配置未变化的连接不保证重建，尚未验证工具恢复或调用成功。',report:await this.diagnose(threadId)};
  }
}

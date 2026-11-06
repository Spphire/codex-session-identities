import {randomBytes} from 'node:crypto';
import {validThreadId} from './identity-contract.cjs';

export class BrowserHealth {
  constructor(bridge,{desktopHealth}={}){this.bridge=bridge;this.desktopHealth=desktopHealth;this.tickets=new Map();this.reconnecting=new Map();}
  async diagnose(threadId){
    if(!validThreadId(threadId))throw new Error('会话 ID 无效');
    const runtime=await this.bridge.connect();
    const report={threadId,status:'unavailable',message:'身份后端未连接，请先正常打开 Codex。',pid:runtime.pid??null};
    if(this.desktopHealth){
      try{report.desktopBrowser=await this.desktopHealth()}catch{report.desktopBrowser={state:'unknown'}}
      if(report.desktopBrowser?.state==='unavailable'){
        report.status='desktopUnavailable';report.pageAccessVerified=false;
        report.message=report.desktopBrowser.reason==='featureBootstrapTimeout'?'Codex 官方功能配置加载超时，桌面浏览器控制服务尚未启动。仅重连此会话无效；请在保存正在运行的任务后彻底退出并重新打开 Codex，再实际读取页面验证。':'Codex 官方功能配置尚未就绪，桌面浏览器控制服务未启动。仅重连工具宿主无法恢复浏览器，请先恢复 Desktop 功能配置。';
        return report;
      }
    }
    if(!runtime.connected)return report;
    try{
      const result=await this.bridge.call('thread/browser/read',{threadId},5000);
      if(result?.revision!==1||result.threadId!==threadId||!['ready','busy','unloaded','unconfigured'].includes(result.status))throw new Error('schema');
      if(!this.bridge.status().connected||this.bridge.status().pid!==report.pid)throw new Error('changed');
      report.status=result.status;
      report.message={ready:'此会话已有侧边浏览器配置，可以请求重新连接工具宿主。',busy:'此会话正在回复，请结束当前回复后重试。',unloaded:'此会话尚未加载，请在 Codex 中打开此会话后重试。',unconfigured:'此会话没有启用侧边浏览器配置。请在 Codex 浏览器设置中启用，再重新打开会话。'}[result.status];
      if(result.status==='ready'){
        const pending=this.reconnecting.get(threadId);
        const page=await this.bridge.call('mcpServerStatus/list',{threadId,detail:'toolsAndAuthOnly',limit:100,cursor:null},5000);
        if(!Array.isArray(page?.data)||page.nextCursor)throw new Error('browser inventory unavailable');
        if(!this.bridge.status().connected||this.bridge.status().pid!==report.pid)throw new Error('changed');
        const servers=page.data.filter(server=>['node_repl','cua_repl'].includes(server.name)&&server.runtimeStatus!=='disabled');
        const failed=servers.some(server=>['failed','cancelled','authenticationRequired'].includes(server.runtimeStatus)||server.toolsError);
        const connected=servers.length>0&&servers.every(server=>server.runtimeStatus==='connected'&&Object.keys(server.tools??{}).length>0&&!server.toolsError);
        report.browserInstructionsAvailable=servers.some(server=>Object.values(server.tools??{}).some(tool=>typeof tool.description==='string'&&tool.description.includes('cua.getTab')&&tool.description.includes('iab')));
        report.pageAccessVerified=false;
        report.connectionState=failed?'failed':connected?'connected':'starting';
        if(pending?.pid===report.pid&&pending.until-Date.now()>8000){report.status='reconnecting';report.message='重连请求已接受，正在等待工具宿主返回状态。';return report;}
        if(failed){this.reconnecting.delete(threadId);report.message='浏览器工具宿主启动失败，重连未成功。请检查运行时路径及授权后重试。';}
        else if(connected){this.reconnecting.delete(threadId);report.message=report.browserInstructionsAvailable?'浏览器工具宿主已连接，初始化说明已就绪。仍需下一轮实际读取页面验证。':'JavaScript 工具宿主已连接，但未返回浏览器初始化说明。仅重连尚不能确认浏览器操作恢复。';}
        else{report.status='reconnecting';report.message='浏览器工具宿主正在连接，尚未返回可用工具。';return report;}
        for(const [key,value] of this.tickets)if(value.until<Date.now())this.tickets.delete(key);
        if(this.tickets.size>=100)this.tickets.delete(this.tickets.keys().next().value);
        report.confirmation=randomBytes(24).toString('hex');this.tickets.set(report.confirmation,{threadId,pid:report.pid,until:Date.now()+120000});
      }
    }catch(error){
      const unsupported=/unknown (?:method|variant)|method not found|not allowed/i.test(error.message??'');
      report.status=unsupported?'unsupported':'unavailable';
      report.message=unsupported?'当前后端不支持侧边浏览器重连，请更新身份后端。':'未能读取浏览器状态：后端可能连接中断、响应超时或接口不兼容。请先检查身份后端连接；重连尚未确认。';
    }
    return report;
  }
  async recover({threadId,confirmation}){
    const ticket=this.tickets.get(confirmation);this.tickets.delete(confirmation);
    if(this.desktopHealth&&(await this.desktopHealth())?.state==='unavailable')throw new Error('桌面浏览器控制服务未启动，不能通过重连此会话恢复；请先恢复 Codex 官方功能配置。');
    const runtime=await this.bridge.connect();
    if(!validThreadId(threadId)||!ticket||ticket.threadId!==threadId||ticket.until<Date.now()||!runtime.connected||runtime.pid!==ticket.pid)throw new Error('状态已变化，请重新检查侧边浏览器');
    const pending=this.reconnecting.get(threadId);
    if(pending?.pid===runtime.pid&&pending.until>Date.now())throw new Error('此会话正在后台刷新，请稍候再试');
    for(const [key,value] of this.reconnecting)if(value.until<Date.now())this.reconnecting.delete(key);
    if(this.reconnecting.size>=100)this.reconnecting.delete(this.reconnecting.keys().next().value);
    this.reconnecting.set(threadId,{pid:runtime.pid,until:Date.now()+10000});
    let result;
    try{result=await this.bridge.call('thread/browser/reload',{threadId},10000,runtime.pid);}catch{throw new Error('未能确认浏览器重连请求，请重新检查；未重启 Codex。');}
    if(result?.revision===1&&result.threadId===threadId&&['busy','unloaded','unconfigured'].includes(result.status))this.reconnecting.delete(threadId);
    if(result?.revision!==1||result.threadId!==threadId||result.status!=='queued')throw new Error('会话正在使用工具或浏览器配置不可用，请重新检查后重试');
    return {threadId,status:'queued',message:'已提交重连，工具宿主正在后台刷新。请稍候，再在下一轮让它读取侧边浏览器页面验证。其他会话不受影响，网站授权保持原样。'};
  }
}

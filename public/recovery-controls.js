// Controllers own recovery state, polling and stale-response fences. They read
// the current selection through a callback and never own identity queue state.
export function createBrowserControl({$,apiFetch,getSelected}){
let browserReport=null;let browserBusy=false;let browserGeneration=0;let browserRecovering=false;
let browserPoll=null;let browserPollUntil=0;
function renderBrowser(){
  const report=browserReport?.threadId===getSelected()?browserReport:null;
  $('diagnose-browser').disabled=browserBusy||!getSelected();
  $('recover-browser').disabled=browserBusy||report?.status!=='ready'||!report.confirmation;
  $('browser-message').textContent=browserBusy?(browserRecovering?'正在提交浏览器重连请求…':'正在检查侧边浏览器…'):report?.message||(getSelected()?'已选择会话，可检查侧边浏览器工具。':'先在左侧选择一个会话。');
}
async function browserAction(recover){
  const id=getSelected();const report=browserReport;if(browserBusy||!id)return;
  clearTimeout(browserPoll);
  if(recover)browserPollUntil=Date.now()+30000;
  const generation=++browserGeneration;browserBusy=true;browserRecovering=recover;renderBrowser();
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await apiFetch('/api/browser/'+(recover?'recover':'diagnose'),{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({threadId:id,...recover?{confirmation:report?.confirmation}:{}})});
    const value=await response.json();if(!response.ok)throw new Error(value.error||'侧边浏览器操作失败');
    if(getSelected()===id&&generation===browserGeneration)browserReport=value;
  }catch(error){if(getSelected()===id&&generation===browserGeneration)browserReport={threadId:id,status:'unavailable',message:controller.signal.aborted?(recover?'重连请求等待超时，是否已提交尚未确认。请先重新检查，勿连续重连。':'检查超时，请确认身份后端已连接后再试。'):error.message};}
  finally{clearTimeout(timeout);if(generation===browserGeneration){browserBusy=false;renderBrowser();
    if(getSelected()===id&&['queued','reconnecting'].includes(browserReport?.status)){
      if(!browserPollUntil)browserPollUntil=Date.now()+30000;
      if(Date.now()<browserPollUntil)browserPoll=setTimeout(()=>{if(getSelected()===id&&generation===browserGeneration)void browserAction(false);},2500);
      else{browserReport={...browserReport,status:'unavailable',confirmation:null,message:'等待工具宿主超过 30 秒，尚未确认恢复。可重新检查状态，无需重复提交重连。'};browserPollUntil=0;renderBrowser();}
    }else browserPollUntil=0;
  }}
}
$('diagnose-browser').addEventListener('click',()=>void browserAction(false));
$('recover-browser').addEventListener('click',()=>void browserAction(true));
return {render:renderBrowser,reset(){
  clearTimeout(browserPoll);browserPollUntil=0;browserReport=null;
  browserBusy=false;browserRecovering=false;browserGeneration++;
}};
}

export function createToolControl({$,apiFetch,getSelected,element}){
let toolReport=null;let toolsBusy=false;let toolsGeneration=0;
function renderTools(){
  const report=toolReport?.threadId===getSelected()?toolReport:null;
  $('diagnose-tools').disabled=toolsBusy||!getSelected();
  $('recover-tools').disabled=toolsBusy||report?.status!=='observed'||!report.confirmation||!$('tool-global-consent').checked;
  $('tool-message').textContent=toolsBusy?'正在检查，请稍候…':report?.message||'读取 MCP 目录，不执行工具。';
  $('tool-servers').replaceChildren();
  const names={notStarted:'未启动',starting:'连接中',connected:'已连接',authenticationRequired:'需要授权',failed:'连接失败',cancelled:'已取消',disabled:'已禁用',unknown:'连接状态未返回'};
  for(const server of report?.servers||[])$('tool-servers').append(element('li',`${server.name}：${names[server.runtimeStatus]||'状态未知'} · ${server.toolCount} 个工具${server.authStatus==='notLoggedIn'?' · 未登录':''}${server.discoveryFailed?' · 工具发现失败':''}`));
  if(report?.status==='observed'&&!report.servers.length)$('tool-servers').append(element('li','当前返回的 MCP 目录为空；不能据此判断桌面工具是否缺失。'));
}
async function toolsAction(recover){
  const id=getSelected();const report=toolReport;
  if(toolsBusy||!id)return;
  const generation=++toolsGeneration;
  toolsBusy=true;renderTools();
  try{
    const response=await apiFetch('/api/tools/'+(recover?'recover':'diagnose'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(recover?{threadId:id,confirmation:report?.confirmation,scope:'all-loaded-threads'}:{threadId:id})});
    const value=await response.json();if(!response.ok)throw new Error(value.error||'工具操作失败');
    if(getSelected()!==id||generation!==toolsGeneration)return;
    toolReport=recover?{...value.report,message:value.message,confirmation:null}:value;
  }catch(error){if(getSelected()===id&&generation===toolsGeneration)toolReport={threadId:id,status:'unavailable',message:error.message};}
  finally{if(generation===toolsGeneration){toolsBusy=false;$('tool-global-consent').checked=false;renderTools();}}
}
$('diagnose-tools').addEventListener('click',()=>void toolsAction(false));
$('recover-tools').addEventListener('click',()=>void toolsAction(true));
$('tool-global-consent').addEventListener('change',renderTools);
return {render:renderTools,reset(){
  toolReport=null;toolsBusy=false;toolsGeneration++;
  $('tool-global-consent').checked=false;
}};
}

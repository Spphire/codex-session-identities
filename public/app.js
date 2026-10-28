const $ = id => document.getElementById(id);
function acceptAccess(){const suppliedAccess=new URLSearchParams(location.hash.slice(1)).get('access');if(suppliedAccess&&/^[a-f0-9]{64}$/.test(suppliedAccess)){sessionStorage.setItem('identity-panel-access',suppliedAccess);history.replaceState(null,'',location.pathname+location.search);}}
acceptAccess();
const apiFetch=(url,options={})=>fetch(url,{...options,headers:{...options.headers,'X-Codex-Identity-Access':sessionStorage.getItem('identity-panel-access')||''}});
let state = null;
let selected = null;
let browserReport=null;let browserBusy=false;let browserGeneration=0;let browserRecovering=false;
let forceBusy=false,forceExecuting=false;const forceOffered=new Set();
async function offerForceSwitch(value,manual=false){
  const id=selected,q=value?.queue;
  if(forceBusy||!id||!q?.pending||!['background_terminals','loaded_subagent','reply_running','thread_became_busy'].includes(q.wait?.reason)||(q.wait.reason!=='loaded_subagent'&&q.wait.threadId!==id))return;
  const key=`${id}:${q.desiredRevision}:${q.runtimeId}`;
  if(!manual&&forceOffered.has(key))return;
  forceOffered.add(key);forceBusy=true;
  try{
    const post=async(action,body)=>{const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),action==='confirm'?165000:15000);try{const r=await apiFetch('/api/switch-terminals/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});const v=await r.json();if(!r.ok)throw new Error(v.error);return v;}catch(error){if(controller.signal.aborted)throw new Error('操作等待超时，结果尚未核实。请刷新状态，不要连续重复强制操作。');throw error}finally{clearTimeout(timer)}};
    const prepared=await post('prepare',{threadId:id,expectedDesiredRevision:q.desiredRevision});
    if(selected!==id)return;
    const row=state.sessions.find(r=>r.id===id);
    $('force-title').textContent=prepared.allOwned?`是否强制停止“${row?.title||id}”的任务并切换身份？`:`是否关闭“${row?.title||id}”的后台终端并切换身份？`;
    $('force-summary').textContent=`切换到 ${identityName(q.desiredIdentityId)}。${prepared.warning}`;
    $('force-terminals').textContent=(prepared.reason==='loaded_subagent'?`阻塞子代理：${prepared.relatedThreadId}\n`:'')+prepared.terminals.map(t=>`终端 ${t.processId}${t.osPid?` · 系统 PID ${t.osPid}`:''}${Number.isFinite(t.cpuPercent)?` · CPU ${t.cpuPercent}%`:''}`).join('\n');
    const dialog=$('force-dialog');dialog.returnValue='wait';dialog.showModal();
    await new Promise(resolve=>dialog.addEventListener('close',resolve,{once:true}));
    if(dialog.returnValue!=='force'||selected!==id)return;
    forceExecuting=true;renderDetail();
    const result=await post('confirm',{threadId:id,confirmation:prepared.confirmation});
    $('switch-reason').textContent=result.status==='applied'&&result.verified?'新身份已核验生效。':result.status==='retrying'?'后台终端已处理，正在重新验证身份切换。':'仍有阻塞，身份尚未确认切换。';
    await loadIdentity();
  }catch(error){$('error').textContent=error.message;$('error').hidden=false;}
  finally{forceBusy=false;forceExecuting=false;renderDetail();}
}
let browserPoll=null;let browserPollUntil=0;
function renderBrowser(){
  const report=browserReport?.threadId===selected?browserReport:null;
  $('diagnose-browser').disabled=browserBusy||!selected;
  $('recover-browser').disabled=browserBusy||report?.status!=='ready'||!report.confirmation;
  $('browser-message').textContent=browserBusy?(browserRecovering?'正在提交浏览器重连请求…':'正在检查侧边浏览器…'):report?.message||(selected?'已选择会话，可检查侧边浏览器工具。':'先在左侧选择一个会话。');
}
async function browserAction(recover){
  const id=selected;const report=browserReport;if(browserBusy||!id)return;
  clearTimeout(browserPoll);
  if(recover)browserPollUntil=Date.now()+30000;
  const generation=++browserGeneration;browserBusy=true;browserRecovering=recover;renderBrowser();
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await apiFetch('/api/browser/'+(recover?'recover':'diagnose'),{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({threadId:id,...recover?{confirmation:report?.confirmation}:{}})});
    const value=await response.json();if(!response.ok)throw new Error(value.error||'侧边浏览器操作失败');
    if(selected===id&&generation===browserGeneration)browserReport=value;
  }catch(error){if(selected===id&&generation===browserGeneration)browserReport={threadId:id,status:'unavailable',message:controller.signal.aborted?(recover?'重连请求等待超时，是否已提交尚未确认。请先重新检查，勿连续重连。':'检查超时，请确认身份后端已连接后再试。'):error.message};}
  finally{clearTimeout(timeout);if(generation===browserGeneration){browserBusy=false;renderBrowser();
    if(selected===id&&['queued','reconnecting'].includes(browserReport?.status)){
      if(!browserPollUntil)browserPollUntil=Date.now()+30000;
      if(Date.now()<browserPollUntil)browserPoll=setTimeout(()=>{if(selected===id&&generation===browserGeneration)void browserAction(false);},2500);
      else{browserReport={...browserReport,status:'unavailable',confirmation:null,message:'等待工具宿主超过 30 秒，尚未确认恢复。可重新检查状态，无需重复提交重连。'};browserPollUntil=0;renderBrowser();}
    }else browserPollUntil=0;
  }}
}
$('diagnose-browser').addEventListener('click',()=>void browserAction(false));
$('recover-browser').addEventListener('click',()=>void browserAction(true));
let toolReport=null;let toolsBusy=false;let toolsGeneration=0;
function renderTools(){
  const report=toolReport?.threadId===selected?toolReport:null;
  $('diagnose-tools').disabled=toolsBusy||!selected;
  $('recover-tools').disabled=toolsBusy||report?.status!=='observed'||!report.confirmation||!$('tool-global-consent').checked;
  $('tool-message').textContent=toolsBusy?'正在检查，请稍候…':report?.message||'读取 MCP 目录，不执行工具。';
  $('tool-servers').replaceChildren();
  const names={notStarted:'未启动',starting:'连接中',connected:'已连接',authenticationRequired:'需要授权',failed:'连接失败',cancelled:'已取消',disabled:'已禁用',unknown:'连接状态未返回'};
  for(const server of report?.servers||[])$('tool-servers').append(element('li',`${server.name}：${names[server.runtimeStatus]||'状态未知'} · ${server.toolCount} 个工具${server.authStatus==='notLoggedIn'?' · 未登录':''}${server.discoveryFailed?' · 工具发现失败':''}`));
  if(report?.status==='observed'&&!report.servers.length)$('tool-servers').append(element('li','当前返回的 MCP 目录为空；不能据此判断桌面工具是否缺失。'));
}
async function toolsAction(recover){
  const id=selected;const report=toolReport;
  if(toolsBusy||!id)return;
  const generation=++toolsGeneration;
  toolsBusy=true;renderTools();
  try{
    const response=await apiFetch('/api/tools/'+(recover?'recover':'diagnose'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(recover?{threadId:id,confirmation:report?.confirmation,scope:'all-loaded-threads'}:{threadId:id})});
    const value=await response.json();if(!response.ok)throw new Error(value.error||'工具操作失败');
    if(selected!==id||generation!==toolsGeneration)return;
    toolReport=recover?{...value.report,message:value.message,confirmation:null}:value;
  }catch(error){if(selected===id&&generation===toolsGeneration)toolReport={threadId:id,status:'unavailable',message:error.message};}
  finally{if(generation===toolsGeneration){toolsBusy=false;$('tool-global-consent').checked=false;renderTools();}}
}
$('diagnose-tools').addEventListener('click',()=>void toolsAction(false));
$('recover-tools').addEventListener('click',()=>void toolsAction(true));
$('tool-global-consent').addEventListener('change',renderTools);
let refreshing = false;
let identityDetail = null;
let submitting = false;
let deleting=false;
let permissions=null;let savingPermissions=false;
function renderPermissions(){
  if(!permissions){$('yolo').disabled=true;return;}
  if(!savingPermissions)$('yolo').checked=permissions.mode==='yolo';$('yolo').disabled=savingPermissions;
  $('permission-summary').textContent=permissions.mode==='yolo'?'完整文件与网络访问 · 免命令审批':'工作区访问 · 按需审批';
  $('permission-status').textContent=permissions.runtimeSupported?'所有本机会话及侧边聊天，下一轮生效；当前回复和已启动命令保持原权限。':'已保存；重启 Codex 后启用权限控制。';
}
async function refreshPermissions(){
  if(savingPermissions)return;
  const response=await apiFetch('/api/permissions');const value=await response.json();if(!response.ok)throw new Error(value.error);
  if(!savingPermissions&&(!permissions||value.revision>=permissions.revision)){permissions=value;renderPermissions();}
}
$('yolo').addEventListener('change',async()=>{
  if(!permissions||savingPermissions)return;
  const mode=$('yolo').checked?'yolo':'standard';savingPermissions=true;renderPermissions();
  try{
    const response=await apiFetch('/api/permissions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode,expectedRevision:permissions.revision})});
    const value=await response.json();if(!response.ok)throw new Error(value.error);
    permissions=value;
  }catch(error){$('error').textContent=error.message;$('error').hidden=false;}
  finally{savingPermissions=false;renderPermissions();}
});
let identityPollTimer=null;
let loginPollTimer=null;
const rowCache=new Map();
let officialUsage={};let usageRefreshing=false;let usageNextAt=0;let usageTimer=null;
const dateFormatter=new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const identityName=id=>state?.identities.find(x=>x.runtimeIds?.includes(id)||x.runtimeId===id)?.name || id || '未固定身份';
const rowIdentity=row=>row.identityState==='verified'?identityName(row.identityId):row.identityId?identityName(row.identityId)+'（待核验）':'未固定身份';
const date = seconds => dateFormatter.format(new Date(seconds * 1000));
function element(tag, text, className) { const e=document.createElement(tag); e.textContent=text; if(className)e.className=className; return e; }
function quotaDuration(minutes){
  if(minutes===10080)return '每周额度';
  if(!minutes)return '周期额度';
  return `${minutes>=1440?`${Number((minutes/1440).toFixed(1))} 天`:minutes>=60?`${Number((minutes/60).toFixed(1))} 小时`:`${minutes} 分钟`}额度`;
}
function renderUsage(){
  for(const li of $('identities').children){
    const container=li.querySelector('.official-usage');if(!container)continue;
    container.replaceChildren();const identity=state.identities.find(x=>x.id===li.dataset.identityId);
    const value=!identity?.available?{status:'unavailable',message:'登录不匹配或已失效'}:officialUsage[li.dataset.identityId];
    if(!value){container.append(element('small','正在查询额度…'));continue;}
    for(const limit of value.limits||[]){
      if(limit.id!=='codex')container.append(element('small',limit.name,'quota-name'));
      for(const window of [limit.primary,limit.secondary].filter(Boolean)){
        const elapsed=window.resetsAt&&window.resetsAt*1000<=Date.now();
        const label=element('div','','quota-label');label.append(element('span',quotaDuration(window.windowDurationMins)),element('span',elapsed?'待更新':`${Number(window.remainingPercent.toFixed(1))}% 剩余`));container.append(label);
        const meter=document.createElement('meter');meter.min=0;meter.max=100;meter.low=10;meter.high=30;meter.optimum=100;meter.value=window.remainingPercent;meter.setAttribute('aria-label',`${limit.name} ${quotaDuration(window.windowDurationMins)}剩余`);container.append(meter);
        if(window.resetsAt)container.append(element('small',`重置 ${date(window.resetsAt)}`));
      }
    }
    if(value.credits){
      const credits=value.credits;
      container.append(element('div',`Credits 余额：${credits.unlimited?'不限额':credits.balance!==null?credits.balance:credits.hasCredits?'有余额（数值未返回）':'未返回'}`,'credits-balance'));
    }
    if(value.message)container.append(element('small',value.message,'quota-error'));
    else if(value.status==='loading')container.append(element('small','正在查询额度…'));
    if(value.updatedAt){const time=element('small',`${value.stale?'上次数据 · ':''}${value.loading?'更新中 · ':''}${new Date(value.updatedAt).toLocaleTimeString('zh-CN')} 更新`,'quota-time');time.title=new Date(value.updatedAt).toLocaleString('zh-CN');container.append(time);}
  }
}
async function refreshUsage(manual=false){
  if(usageRefreshing||document.hidden||!state||!manual&&Date.now()<usageNextAt)return;
  usageRefreshing=true;$('refresh-usage').disabled=true;clearTimeout(usageTimer);
  try{
    const response=await apiFetch(manual?'/api/official-usage?refresh=1':'/api/official-usage');const value=await response.json();if(!response.ok)throw new Error('额度服务暂不可用');
    officialUsage=value.identities;renderUsage();
    const loading=Object.values(officialUsage).some(x=>x.loading);
    usageNextAt=Date.now()+(loading?1000:30000);
    if(loading)usageTimer=setTimeout(()=>void refreshUsage(),1100);
  }catch{
    for(const identity of state.identities)if(identity.kind==='chatgpt')officialUsage[identity.id]={...officialUsage[identity.id],status:'error',message:'额度服务暂不可用',stale:true};
    renderUsage();usageNextAt=Date.now()+30000;
  }finally{usageRefreshing=false;$('refresh-usage').disabled=false;}
}
function renderDetail() {
  const row = state?.sessions.find(x => x.id === selected);
  $('detail').hidden = !row; $('no-selection').hidden = Boolean(row);
  renderTools();renderBrowser();
  if (!row) return;
  $('detail-title').textContent=row.title; $('detail-id').textContent=row.id;
  $('detail-cwd').textContent=row.cwd; $('detail-model').textContent=row.model || '未记录';
  const current=identityDetail?.threadId===row.id?identityDetail:null;
  $('detail-identity').textContent=current?`${identityName(current.identityId)}${current.identityId&&!current.verified?(current.status==='unloaded'?'（未加载）':'（待核验）'):''}`:rowIdentity(row);
  const pending=current?.queue?.pending&&!current.queue.errorCode;
  const wait=pending?current.queue.wait:null;
  $('switch').disabled=submitting||!state.runtime.connected||!current||!$('identity').value||Boolean(pending);
  $('cancel-switch').hidden=!pending;$('cancel-switch').disabled=submitting||forceExecuting||Boolean(current?.queue?.inflight);
  $('force-switch').hidden=!(pending&&['background_terminals','loaded_subagent','reply_running','thread_became_busy'].includes(wait?.reason)&&(wait.reason==='loaded_subagent'||wait.threadId===row.id));$('force-switch').disabled=forceBusy||submitting;
  const reasons={
    reply_running:'当前会话仍在回复，结束后自动重试。',
    background_terminals:`当前会话有${wait?.terminalCount?' '+wait.terminalCount+' 个':''}后台命令仍在运行。暂停目标不会结束后台命令；请检查该会话的后台终端。`,
    side_chat_running:'旧版后端仍将分叉身份联动，因此正在等待分叉回复结束。新版已改为独立身份；请正常重启 Codex 加载修复。',
    side_chat_background_terminals:`侧边聊天有${wait?.terminalCount?' '+wait.terminalCount+' 个':''}后台命令仍在运行。旧版后端会连带等待；新版已改为独立身份，请正常重启 Codex 加载修复。`,
    loaded_subagent:'子智能体仍加载在后端中；请先结束或关闭该子任务。',
    thread_became_busy:'准备切换时会话重新变忙，空闲后自动重试。',
    backend_busy:'后端报告忙碌，但未提供具体原因。可检查后台终端、侧边聊天和子任务；更新后端并重启一次可显示详细原因。',
  };
  const waitingText=wait?`等待切换到 ${identityName(current.queue.desiredIdentityId)}。${reasons[wait.reason]||reasons.backend_busy}`:`正在检查并切换到 ${identityName(current?.queue?.desiredIdentityId)}`;
  $('switch-reason').textContent=forceExecuting?'正在停止所选会话的任务、清理阻塞并核验新身份，请等待结果…':!state.runtime.connected?state.runtime.reason:pending?waitingText:current?.queue?.errorCode==='cancelled'?'已取消等待':current?.queue?.errorCode?'上次切换失败，当前身份未确认改变':current?.verified?'已生效':current?.identityId&&current?.status==='unloaded'?'已设置，打开会话后生效':'';
  const related=$('switch-related');related.hidden=!wait?.threadId||wait.threadId===row.id;
  if(!related.hidden)related.href=`codex://threads/${wait.threadId}`;
}
function renderRows() {
  if (!state) return;
  const query=$('search').value.trim().toLowerCase();
  const rows=state.sessions.filter(x => ($('archived').checked || !x.archived) && (!$('provider').value || x.provider===$('provider').value) && `${x.title} ${x.id} ${x.cwd}`.toLowerCase().includes(query));
  const body=$('rows');const existing=new Set(state.sessions.map(x=>x.id));
  for(const [id,entry] of rowCache)if(!existing.has(id)){entry.tr.remove();rowCache.delete(id);}
  $('count').textContent=String(rows.length); $('empty').hidden=rows.length>0;
  let position=body.firstElementChild;
  const visible=new Set();
  for(const row of rows){
    visible.add(row.id);
    let entry=rowCache.get(row.id);
    if(!entry){
      const tr=document.createElement('tr');tr.tabIndex=0;tr.dataset.threadId=row.id;
      const title=element('div',row.title,'session-title');const first=document.createElement('td');
      first.append(title,element('div',row.id.slice(0,18),'session-id'));
      entry={tr,title,provider:element('td',row.provider,'provider'),identity:element('td','','unknown'),date:element('td','','date')};
      tr.append(first,entry.provider,entry.identity,entry.date);
      const id=row.id;
      const choose=()=>{selected=id;identityDetail=null;browserReport=null;browserBusy=false;browserGeneration++;toolReport=null;toolsBusy=false;toolsGeneration++;$('tool-global-consent').checked=false;clearTimeout(identityPollTimer);renderRows();renderDetail();void loadIdentity();};
      tr.addEventListener('click',choose);tr.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}});
      rowCache.set(id,entry);
    }
    const name=rowIdentity(row);
    if(entry.title.textContent!==row.title)entry.title.textContent=row.title;
    if(entry.provider.textContent!==row.provider)entry.provider.textContent=row.provider;
    if(entry.identity.textContent!==name)entry.identity.textContent=name;
    if(entry.updatedAt!==row.updatedAt){entry.date.textContent=date(row.updatedAt);entry.updatedAt=row.updatedAt;}
    const active=selected===row.id;
    if(entry.selected!==active){entry.tr.setAttribute('aria-selected',String(active));entry.tr.classList.toggle('selected',active);entry.selected=active;}
    if(entry.tr===position)position=position.nextElementSibling;
    else body.insertBefore(entry.tr,position);
  }
  for(const child of [...body.children])if(!visible.has(child.dataset.threadId))child.remove();
}
async function refresh(){
  if(refreshing||deleting)return; refreshing=true; $('refresh').disabled=true;
  try{
    const response=await apiFetch('/api/state'); const next=await response.json(); if(!response.ok)throw new Error(next.error);
    state=next; $('error').hidden=true; $('connection').textContent=state.runtime.connected?'身份后端已连接':state.runtime.reason;
    const old=$('provider').value; $('provider').replaceChildren(new Option('全部',''));
    for(const provider of [...new Set(state.sessions.map(x=>x.provider))].sort())$('provider').add(new Option(provider,provider)); $('provider').value=old;
    const oldIdentity=$('identity').value; $('identity').replaceChildren(); $('identities').replaceChildren();
    for(const identity of state.identities){
      if(identity.removed)continue;
      const option=new Option(identity.name+(!identity.runtimeId?'（待导入）':!identity.available?'（登录不匹配或已失效）':''),identity.runtimeId||'');option.disabled=!identity.available;$('identity').add(option);
      const li=element('li','');const text=element('div','');text.append(element('span',identity.name));
      li.dataset.identityId=identity.id;
      const sources=(identity.sources||[]).map(x=>x==='system'?'本体登录':'独立登录').join(' / ');
      text.append(element('small',identity.kind==='chatgpt'?`${sources||'ChatGPT 官方账号'}${identity.runtimeIds?.length>1?` · ${identity.runtimeIds.length} 份档案`:''}${identity.runtimeId&&!identity.available?' · 登录不匹配或已失效':''}`:`API · ${identity.provider}`));
      if(identity.kind==='chatgpt')text.append(element('div','','official-usage'));
      if(identity.kind==='chatgpt'&&identity.reauthRuntimeId){
        const reauth=element('button','重新登录','reauth-identity');reauth.type='button';reauth.dataset.runtimeId=identity.reauthRuntimeId;reauth.title='令牌被撤销或失效时，重新授权此官方账号';reauth.addEventListener('click',()=>reauthIdentity(identity));text.append(reauth);
      }
      const used=state.sessions.some(x=>identity.runtimeIds.includes(x.identityId)||x.queue?.pending&&identity.runtimeIds.includes(x.queue.desiredIdentityId));
      const remove=element('button','\u2212','remove-identity');remove.type='button';remove.setAttribute('aria-label',`移除 ${identity.name}`);
      remove.title=used?'仍有会话使用，请先切换这些会话':'从面板移除（保留登录凭据）';remove.disabled=used;
      remove.addEventListener('click',()=>removeIdentity(identity));li.append(text,remove);$('identities').append(li);
    }
    const previous=state.identities.find(x=>!x.removed&&x.available&&x.runtimeIds.includes(oldIdentity));
    if(previous)$('identity').value=previous.runtimeId;
    else $('identity').value=state.identities.find(x=>!x.removed&&x.available)?.runtimeId||'';
    $('updated').textContent=`更新于 ${new Date(state.observedAt).toLocaleTimeString('zh-CN')}`;
    // Discard quota data immediately if a system login no longer matches its profile.
    for(const identity of state.identities)if(identity.kind==='chatgpt'&&!identity.available)officialUsage[identity.id]={status:'unavailable',message:'登录不匹配或已失效'};
    renderUsage();void refreshUsage();
    renderRows();renderDetail();await loadIdentity();await loginStatus();await refreshPermissions();
  }catch(error){$('error').textContent=error.message; $('error').hidden=false; $('connection').textContent='连接失败';}
  finally{refreshing=false;$('refresh').disabled=false;}
}
async function loginStatus(reloadOnComplete=false){
  const response=await apiFetch('/api/official-login');const value=await response.json();if(!response.ok)throw new Error(value.error);
  const busy=['starting','waiting'].includes(value.status);$('add-official').disabled=busy;
  $('official-login').hidden=value.status==='idle';$('cancel-login').hidden=!busy;
  $('login-code').textContent=value.userCode||'';$('login-code').hidden=!value.userCode;
  $('login-url').hidden=!value.verificationUrl;
  if(value.verificationUrl)$('login-url').href=value.verificationUrl;
  $('login-status').textContent=value.status==='waiting'?(value.kind==='refresh'?'使用原账号授权以恢复此身份':'使用要添加的官方账号授权'):value.status==='completed'?(value.kind==='refresh'?`已恢复 ${value.name}，原会话绑定保留`:`已添加 ${value.name}`):value.error||({starting:'正在申请设备码',cancelled:'已取消登录',expired:'设备码已过期，请重试',account_mismatch:'登录账号不匹配，凭据未替换'}[value.status]||'');
  for(const button of document.querySelectorAll('.reauth-identity')){const active=busy&&button.dataset.runtimeId===value.targetRuntimeId;button.disabled=busy;button.textContent=active?'登录中…':'重新登录';}
  clearTimeout(loginPollTimer);if(busy)loginPollTimer=setTimeout(()=>void loginStatus(reloadOnComplete).catch(()=>{}),1000);else if(reloadOnComplete&&value.status==='completed')void refresh();
}
async function officialLogin(cancel=false){
  $('add-official').disabled=true;$('cancel-login').disabled=true;
  try{
    const response=await apiFetch(cancel?'/api/official-login/cancel':'/api/official-login/start',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const value=await response.json();if(!response.ok)throw new Error(value.error);await loginStatus(true);
  }catch(error){$('error').textContent=error.message;$('error').hidden=false;$('add-official').disabled=false;}
  finally{$('cancel-login').disabled=false;}
}
$('add-official').addEventListener('click',()=>officialLogin());$('cancel-login').addEventListener('click',()=>officialLogin(true));
async function reauthIdentity(identity){
  if(!identity.reauthRuntimeId)return;
  try{$('error').hidden=true;const response=await apiFetch('/api/official-login/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runtimeId:identity.reauthRuntimeId})});const value=await response.json();if(!response.ok)throw new Error(value.error);await loginStatus(true);}
  catch(error){$('error').textContent=error.message;$('error').hidden=false;}
}
async function removeIdentity(identity){
  if(deleting||!confirm(`从面板移除“${identity.name}”${identity.memberIds.length>1?`的 ${identity.memberIds.length} 份档案`:''}？\n登录凭据会保留，不会注销账号。`))return;
  deleting=true;
  try{
    const response=await apiFetch('/api/identities/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identityId:identity.id,expectedMemberIds:identity.memberIds})});
    const value=await response.json();if(!response.ok)throw new Error(value.error);
  }catch(error){$('error').textContent=error.message;$('error').hidden=false;return;}
  finally{deleting=false;}
  await refresh();
}
async function loadIdentity(){
  clearTimeout(identityPollTimer);
  const id=selected;if(!id||!state?.runtime.connected)return;
  try {
    const response=await apiFetch(`/api/identity?threadId=${encodeURIComponent(id)}`);const value=await response.json();if(!response.ok)throw new Error(value.error);
    if(selected!==id)return;identityDetail=value;
    const row=state.sessions.find(x=>x.id===id);if(row){row.identityId=value.identityId;row.identityState=value.verified?'verified':'unverified';}
    renderRows();renderDetail();void offerForceSwitch(value);
    if(!document.hidden&&value.queue?.pending&&!value.queue.errorCode)identityPollTimer=setTimeout(()=>void loadIdentity(),400);
  }catch(error){if(selected===id){identityDetail=null;renderDetail();$('switch-reason').textContent=error.message;}}
}
async function mutate(cancel=false){
  if(submitting||!identityDetail)return;submitting=true;renderDetail();
  try{
    const response=await apiFetch(cancel?'/api/cancel':'/api/switch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({threadId:selected,identityId:$('identity').value,expectedRevision:identityDetail.revision,expectedDesiredRevision:identityDetail.queue?.desiredRevision||0})});
    const value=await response.json();if(!response.ok)throw new Error(value.error);
    await loadIdentity();
  }catch(error){$('error').textContent=error.message;$('error').hidden=false;}
  finally{submitting=false;renderDetail();}
}
$('identity').addEventListener('change',renderDetail);$('switch').addEventListener('click',()=>mutate());$('cancel-switch').addEventListener('click',()=>mutate(true));
$('force-switch').addEventListener('click',()=>offerForceSwitch(identityDetail,true));
$('refresh-usage').addEventListener('click',()=>refreshUsage(true));
let apiAdding=false;
$('api-form').addEventListener('submit',async event=>{
  event.preventDefault();if(apiAdding)return;apiAdding=true;$('add-api').disabled=true;
  const input={name:$('api-name').value,baseUrl:$('api-base-url').value,model:$('api-model').value,apiKey:$('api-key').value};
  $('api-key').value='';$('api-status').textContent='正在保存 API 身份…';
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{
    const response=await apiFetch('/api/identities/add-api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:controller.signal});
    input.apiKey='';const value=await response.json();if(!response.ok)throw new Error(value.error||'添加失败。');
    $('api-form').reset();await refresh();
    if(selected&&[...$('identity').options].some(o=>o.value===value.identityId)){$('identity').value=value.identityId;renderDetail()}
    $('api-status').textContent=`已添加 ${value.name}。请选择会话并切换；尚未验证服务连接。`;
  }catch(error){$('api-status').textContent=controller.signal.aborted?'保存等待超时，请刷新身份列表核对后再重试。':error.message}
  finally{input.apiKey='';clearTimeout(timer);apiAdding=false;$('add-api').disabled=false}
});
$('search').addEventListener('input',renderRows); $('provider').addEventListener('change',renderRows); $('archived').addEventListener('change',renderRows); $('refresh').addEventListener('click',refresh);
setInterval(()=>{if(!document.hidden)void refresh();},5000);refresh();
document.addEventListener('visibilitychange',()=>{clearTimeout(identityPollTimer);clearTimeout(usageTimer);if(!document.hidden){usageNextAt=0;void refresh();}});
addEventListener('hashchange',()=>{acceptAccess();void refresh();});

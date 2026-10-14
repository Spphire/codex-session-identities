const $ = id => document.getElementById(id);
function acceptAccess(){const suppliedAccess=new URLSearchParams(location.hash.slice(1)).get('access');if(suppliedAccess&&/^[a-f0-9]{64}$/.test(suppliedAccess)){sessionStorage.setItem('identity-panel-access',suppliedAccess);history.replaceState(null,'',location.pathname+location.search);}}
acceptAccess();
const apiFetch=(url,options={})=>fetch(url,{...options,headers:{...options.headers,'X-Codex-Identity-Access':sessionStorage.getItem('identity-panel-access')||''}});
let state = null;
let selected = null;
let refreshing = false;
let identityDetail = null;
let submitting = false;
let deleting=false;
let identityPollTimer=null;
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
  if (!row) return;
  $('detail-title').textContent=row.title; $('detail-id').textContent=row.id;
  $('detail-cwd').textContent=row.cwd; $('detail-model').textContent=row.model || '未记录';
  const current=identityDetail?.threadId===row.id?identityDetail:null;
  $('detail-identity').textContent=current?`${identityName(current.identityId)}${current.identityId&&!current.verified?(current.status==='unloaded'?'（未加载）':'（待核验）'):''}`:rowIdentity(row);
  const pending=current?.queue?.pending&&!current.queue.errorCode;
  $('switch').disabled=submitting||!state.runtime.connected||!current||!$('identity').value||Boolean(pending);
  $('cancel-switch').hidden=!pending;$('cancel-switch').disabled=submitting||Boolean(current?.queue?.inflight);
  $('switch-reason').textContent=!state.runtime.connected?state.runtime.reason:pending?`等待切换到 ${identityName(current.queue.desiredIdentityId)}`:current?.queue?.errorCode==='cancelled'?'已取消等待':current?.queue?.errorCode?'上次切换失败，当前身份未确认改变':current?.verified?'已生效':current?.identityId&&current?.status==='unloaded'?'已设置，打开会话后生效':'';
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
      const choose=()=>{selected=id;identityDetail=null;clearTimeout(identityPollTimer);renderRows();renderDetail();void loadIdentity();};
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
    renderRows();renderDetail();await loadIdentity();await loginStatus();
  }catch(error){$('error').textContent=error.message; $('error').hidden=false; $('connection').textContent='连接失败';}
  finally{refreshing=false;$('refresh').disabled=false;}
}
async function loginStatus(){
  const response=await apiFetch('/api/official-login');const value=await response.json();if(!response.ok)throw new Error(value.error);
  const busy=['starting','waiting'].includes(value.status);$('add-official').disabled=busy;
  $('official-login').hidden=value.status==='idle';$('cancel-login').hidden=!busy;
  $('login-code').textContent=value.userCode||'';$('login-code').hidden=!value.userCode;
  $('login-url').hidden=!value.verificationUrl;
  if(value.verificationUrl)$('login-url').href=value.verificationUrl;
  $('login-status').textContent=value.status==='waiting'?'使用要添加的官方账号授权':value.status==='completed'?`已添加 ${value.name}`:value.error||({starting:'正在申请设备码',cancelled:'已取消登录',expired:'设备码已过期，请重试'}[value.status]||'');
}
async function officialLogin(cancel=false){
  $('add-official').disabled=true;$('cancel-login').disabled=true;
  try{
    const response=await apiFetch(cancel?'/api/official-login/cancel':'/api/official-login/start',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const value=await response.json();if(!response.ok)throw new Error(value.error);await loginStatus();
  }catch(error){$('error').textContent=error.message;$('error').hidden=false;$('add-official').disabled=false;}
  finally{$('cancel-login').disabled=false;}
}
$('add-official').addEventListener('click',()=>officialLogin());$('cancel-login').addEventListener('click',()=>officialLogin(true));
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
    renderRows();renderDetail();
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
$('refresh-usage').addEventListener('click',()=>refreshUsage(true));
$('search').addEventListener('input',renderRows); $('provider').addEventListener('change',renderRows); $('archived').addEventListener('change',renderRows); $('refresh').addEventListener('click',refresh);
setInterval(()=>{if(!document.hidden)void refresh();},5000);refresh();
document.addEventListener('visibilitychange',()=>{clearTimeout(identityPollTimer);clearTimeout(usageTimer);if(!document.hidden){usageNextAt=0;void refresh();}});
addEventListener('hashchange',()=>{acceptAccess();void refresh();});

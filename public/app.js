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
const identityName=id=>state?.identities.find(x=>x.runtimeIds?.includes(id)||x.runtimeId===id)?.name || id || '未固定身份';
const rowIdentity=row=>row.identityState==='verified'?identityName(row.identityId):row.identityId?identityName(row.identityId)+'（待核验）':'未固定身份';
const date = seconds => new Date(seconds * 1000).toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
function element(tag, text, className) { const e=document.createElement(tag); e.textContent=text; if(className)e.className=className; return e; }
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
  $('rows').replaceChildren(); $('count').textContent=String(rows.length); $('empty').hidden=rows.length>0;
  for(const row of rows){
    const tr=document.createElement('tr'); tr.tabIndex=0; tr.setAttribute('aria-selected',String(selected===row.id)); if(selected===row.id)tr.classList.add('selected');
    const title=document.createElement('td'); title.append(element('div',row.title,'session-title'),element('div',row.id.slice(0,18),'session-id'));
    tr.append(title,element('td',row.provider,'provider'),element('td',rowIdentity(row),'unknown'),element('td',date(row.updatedAt),'date'));
    const choose=()=>{selected=row.id;identityDetail=null;renderRows();renderDetail();void loadIdentity();}; tr.addEventListener('click',choose); tr.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}});
    $('rows').append(tr);
  }
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
      const sources=(identity.sources||[]).map(x=>x==='system'?'本体登录':'独立登录').join(' / ');
      text.append(element('small',identity.kind==='chatgpt'?`${sources||'ChatGPT 官方账号'}${identity.runtimeIds?.length>1?` · ${identity.runtimeIds.length} 份档案`:''}${identity.runtimeId&&!identity.available?' · 登录不匹配或已失效':''}`:`API · ${identity.provider}`));
      const used=state.sessions.some(x=>identity.runtimeIds.includes(x.identityId)||x.queue?.pending&&identity.runtimeIds.includes(x.queue.desiredIdentityId));
      const remove=element('button','\u2212','remove-identity');remove.type='button';remove.setAttribute('aria-label',`移除 ${identity.name}`);
      remove.title=used?'仍有会话使用，请先切换这些会话':'从面板移除（保留登录凭据）';remove.disabled=used;
      remove.addEventListener('click',()=>removeIdentity(identity));li.append(text,remove);$('identities').append(li);
    }
    const previous=state.identities.find(x=>!x.removed&&x.available&&x.runtimeIds.includes(oldIdentity));
    if(previous)$('identity').value=previous.runtimeId;
    else $('identity').value=state.identities.find(x=>!x.removed&&x.available)?.runtimeId||'';
    $('updated').textContent=`更新于 ${new Date(state.observedAt).toLocaleTimeString('zh-CN')}`;
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
  const id=selected;if(!id||!state?.runtime.connected)return;
  try {
    const response=await apiFetch(`/api/identity?threadId=${encodeURIComponent(id)}`);const value=await response.json();if(!response.ok)throw new Error(value.error);
    if(selected!==id)return;identityDetail=value;
    const row=state.sessions.find(x=>x.id===id);if(row){row.identityId=value.identityId;row.identityState=value.verified?'verified':'unverified';}
    renderRows();renderDetail();
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
$('search').addEventListener('input',renderRows); $('provider').addEventListener('change',renderRows); $('archived').addEventListener('change',renderRows); $('refresh').addEventListener('click',refresh);
setInterval(refresh,5000);refresh();
addEventListener('hashchange',()=>{acceptAccess();void refresh();});

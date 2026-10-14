const $ = id => document.getElementById(id);
function acceptAccess(){const suppliedAccess=new URLSearchParams(location.hash.slice(1)).get('access');if(suppliedAccess&&/^[a-f0-9]{64}$/.test(suppliedAccess)){sessionStorage.setItem('identity-panel-access',suppliedAccess);history.replaceState(null,'',location.pathname+location.search);}}
acceptAccess();
const apiFetch=(url,options={})=>fetch(url,{...options,headers:{...options.headers,'X-Codex-Identity-Access':sessionStorage.getItem('identity-panel-access')||''}});
let state = null;
let selected = null;
let refreshing = false;
let identityDetail = null;
let submitting = false;
const identityName=id=>state?.identities.find(x=>x.runtimeId===id)?.name || id || '未固定身份';
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
  if(refreshing)return; refreshing=true; $('refresh').disabled=true;
  try{
    const response=await apiFetch('/api/state'); const next=await response.json(); if(!response.ok)throw new Error(next.error);
    state=next; $('error').hidden=true; $('connection').textContent=state.runtime.connected?'身份后端已连接':state.runtime.reason;
    const old=$('provider').value; $('provider').replaceChildren(new Option('全部',''));
    for(const provider of [...new Set(state.sessions.map(x=>x.provider))].sort())$('provider').add(new Option(provider,provider)); $('provider').value=old;
    const oldIdentity=$('identity').value; $('identity').replaceChildren(); $('identities').replaceChildren();
    for(const identity of state.identities){
      const option=new Option(identity.name+(identity.runtimeId?'':'（待导入）'),identity.runtimeId||'');option.disabled=!identity.runtimeId;$('identity').add(option);
      const li=element('li',identity.name); li.append(element('small',identity.kind==='chatgpt'?'ChatGPT 官方账号':`API · ${identity.provider}`)); $('identities').append(li);
    }
    if(oldIdentity && state.identities.some(x=>x.runtimeId===oldIdentity))$('identity').value=oldIdentity;
    $('updated').textContent=`更新于 ${new Date(state.observedAt).toLocaleTimeString('zh-CN')}`;
    renderRows();renderDetail();await loadIdentity();
  }catch(error){$('error').textContent=error.message; $('error').hidden=false; $('connection').textContent='连接失败';}
  finally{refreshing=false;$('refresh').disabled=false;}
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

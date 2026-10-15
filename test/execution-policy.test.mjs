import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {EventEmitter} from 'node:events';
import control from '../execution-policy.cjs';
import {panelServer} from '../server.mjs';

test('permissions default to YOLO, persist across readers and fence stale concurrent writes',()=>{
  const home=mkdtempSync(join(tmpdir(),'execution-policy-'));let a,b;
  try{
    a=new control.ExecutionPolicy(home);b=new control.ExecutionPolicy(home);
    assert.equal(a.read().mode,'yolo');assert.equal(a.read().approvalPolicy,'never');
    a.set({mode:'standard',expectedRevision:0});assert.equal(b.read().mode,'standard');
    assert.throws(()=>b.set({mode:'yolo',expectedRevision:0}),/已变化/);
    assert.equal(b.read().mode,'standard');
    b.set({mode:'yolo',expectedRevision:1});assert.equal(a.read().sandboxMode,'danger-full-access');
  }finally{a?.close();b?.close();rmSync(home,{recursive:true,force:true});}
});
test('permission control preserves non-permission data and native managed requirements',()=>{
  const request={id:4,method:'turn/start',params:{threadId:'test',model:'keep-model',input:[{type:'text',text:'keep-input'}],permissions:':workspace',sandboxPolicy:{type:'readOnly'}}};
  const result=control.applyPolicy(request,{mode:'yolo',sandboxMode:'danger-full-access',approvalPolicy:'never'});
  assert.equal(result.params.approvalPolicy,'never');assert.deepEqual(result.params.sandboxPolicy,{type:'dangerFullAccess'});
  assert.equal(result.params.permissions,undefined);assert.equal(result.params.model,'keep-model');assert.deepEqual(result.params.input,request.params.input);
  assert.equal(request.params.permissions,':workspace');
  assert.equal(control.applyPolicy({method:'thread/identity/set',params:{identityId:'unchanged'}},{}).params.identityId,'unchanged');
  assert.throws(()=>control.assertAllowed('yolo',{allowedSandboxModes:['workspace-write']}),/组织策略/);
  assert.throws(()=>control.assertAllowed('yolo',{allowedApprovalPolicies:['on-request']}),/组织策略/);
});
test('permissions API authenticates writes, persists offline settings and refuses managed or stale changes',async()=>{
  const home=mkdtempSync(join(tmpdir(),'execution-policy-http-'));let server,reader;
  const bridge=new EventEmitter();let connected=false,deny=false;
  bridge.connect=async()=>({connected});bridge.status=()=>({connected});bridge.close=()=>{};
  bridge.call=async method=>method==='bridge/permissions/read'?{supported:true,...reader.read()}:{requirements:deny?{allowedSandboxModes:['workspace-write']}:null};
  try{
    reader=new control.ExecutionPolicy(home);
    server=panelServer({codexDirectory:home,switcherDirectory:join(home,'identity-switcher'),bridge});server.listen(0,'127.0.0.1');await once(server,'listening');
    const base=`http://127.0.0.1:${server.address().port}`;const headers={'X-Codex-Identity-Access':server.identityAccessToken};
    const post=(body,extra={})=>fetch(base+'/api/permissions',{method:'POST',headers:{...headers,'Content-Type':'application/json',Origin:base,...extra},body:JSON.stringify(body)});
    assert.equal((await fetch(base+'/api/permissions')).status,401);
    assert.equal((await post({mode:'standard',expectedRevision:0},{Origin:'http://evil.invalid'})).status,403);
    const initial=await(await fetch(base+'/api/permissions',{headers})).json();assert.equal(initial.mode,'yolo');assert.equal(initial.runtimeSupported,false);
    assert.equal((await post({mode:'standard',expectedRevision:0})).status,200);assert.equal(reader.read().mode,'standard');
    assert.equal((await post({mode:'yolo',expectedRevision:0})).status,409);
    connected=true;deny=true;assert.equal((await post({mode:'yolo',expectedRevision:1})).status,409);assert.equal(reader.read().mode,'standard');
    deny=false;const enabled=await(await post({mode:'yolo',expectedRevision:1})).json();assert.equal(enabled.mode,'yolo');assert.equal(enabled.runtimeSupported,true);assert.equal(enabled.effectiveFrom,'next-turn');
  }finally{if(server)await new Promise(r=>server.close(r));reader?.close();rmSync(home,{recursive:true,force:true});}
});

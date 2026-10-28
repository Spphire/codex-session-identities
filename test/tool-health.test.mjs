import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ToolHealth,BrowserHealth} from '../tool-health.mjs';
import {panelServer} from '../server.mjs';
const id='01a16269-6419-7f33-9843-93c35da768cb';
test('Desktop bootstrap failure prevents misleading per-chat browser reloads',async()=>{
  const bridge=fixture();const health=new BrowserHealth(bridge,{desktopHealth:async()=>({state:'unavailable',reason:'featureBootstrapTimeout',restartRequired:true})});
  const report=await health.diagnose(id);assert.equal(report.status,'desktopUnavailable');assert.equal(report.confirmation,undefined);assert.equal(report.pageAccessVerified,false);assert.equal(bridge.calls.length,0);
  await assert.rejects(()=>health.recover({threadId:id,confirmation:'old-ticket'}),/桌面浏览器控制服务未启动/);assert.equal(bridge.calls.length,0);
});
function fixture(){
  const bridge=new EventEmitter();bridge.pid=10;bridge.calls=[];bridge.close=()=>{};
  bridge.status=()=>({connected:true,pid:bridge.pid});bridge.connect=async()=>bridge.status();
  bridge.call=async(method,params)=>{bridge.calls.push({method,params});if(method==='bridge/tools/capabilities')return{revision:1};if(method==='mcpServerStatus/list')return{data:[{name:'browser',runtimeStatus:'failed',authStatus:'notLoggedIn',tools:{navigate:{description:'secret'}},toolsError:'Bearer secret',httpOrigin:'https://secret.invalid'}],nextCursor:null};return{};};return bridge;
}
test('diagnostic targets the thread, filters sensitive payload and never executes tools',async()=>{
  const bridge=fixture();const result=await new ToolHealth(bridge).diagnose(id);
  assert.equal(result.status,'observed');assert.equal(result.servers[0].toolCount,1);assert.equal(result.servers[0].discoveryFailed,true);
  assert.doesNotMatch(JSON.stringify(result),/secret/);assert.equal(bridge.calls[1].params.threadId,id);
  assert.deepEqual(bridge.calls.map(x=>x.method),['bridge/tools/capabilities','mcpServerStatus/list']);
});
test('recovery requires a fresh one-use confirmation and global scope, and only reports queued',async()=>{
  const bridge=fixture();const health=new ToolHealth(bridge);
  let report=await health.diagnose(id);
  await assert.rejects(()=>health.recover({threadId:id,confirmation:report.confirmation,scope:'thread'}));
  assert.equal(bridge.calls.filter(x=>x.method==='config/mcpServer/reload').length,0);
  report=await health.diagnose(id);bridge.pid++;
  await assert.rejects(()=>health.recover({threadId:id,confirmation:report.confirmation,scope:'all-loaded-threads'}),/后端已变化/);
  report=await health.diagnose(id);
  const input={threadId:id,confirmation:report.confirmation,scope:'all-loaded-threads'};
  const result=await health.recover(input);assert.equal(result.status,'queued');assert.match(result.message,/尚未验证/);
  await assert.rejects(()=>health.recover(input));assert.equal(bridge.calls.filter(x=>x.method==='config/mcpServer/reload').length,1);
});
test('unknown bridge, malformed inventory and backend errors fail closed without leaking messages',async()=>{
  const bridge=fixture();const health=new ToolHealth(bridge);
  bridge.call=async()=>{throw new Error('Bearer secret');};
  assert.equal((await health.diagnose(id)).status,'unsupported');
  bridge.call=async method=>method==='bridge/tools/capabilities'?{revision:1}:{data:null};
  const result=await health.diagnose(id);assert.equal(result.status,'unavailable');assert.equal(result.confirmation,undefined);assert.doesNotMatch(JSON.stringify(result),/secret/);
  await assert.rejects(()=>health.diagnose('../invalid'));
});
test('tool HTTP endpoints require panel token, origin and explicit recovery confirmation',async()=>{
  const home=await mkdtemp(join(tmpdir(),'tools-http-'));const bridge=fixture();let server;
  try{
    server=panelServer({codexDirectory:home,switcherDirectory:join(home,'switcher'),bridge});server.listen(0,'127.0.0.1');await once(server,'listening');
    const base=`http://127.0.0.1:${server.address().port}`;
    const post=(route,body,headers={})=>fetch(base+'/api/tools/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Codex-Identity-Access':server.identityAccessToken,Origin:base,...headers},body:JSON.stringify(body)});
    assert.equal((await post('diagnose',{threadId:id},{'X-Codex-Identity-Access':''})).status,401);
    assert.equal((await post('diagnose',{threadId:id},{Origin:'http://evil.invalid'})).status,403);
    assert.equal((await post('recover',{threadId:id,scope:'all-loaded-threads'})).status,409);
    const report=await(await post('diagnose',{threadId:id})).json();assert.equal(report.status,'observed');
    const response=await post('recover',{threadId:id,confirmation:report.confirmation,scope:'all-loaded-threads'});assert.equal(response.status,200);assert.equal((await response.json()).status,'queued');
  }finally{if(server)await new Promise(r=>server.close(r));await rm(home,{recursive:true,force:true});}
});

test('sidebar browser recovery targets one loaded idle thread, uses existing authorization and fences replay/backend changes',async()=>{
  const bridge=fixture();let status='ready';
  bridge.call=async(method,params)=>{bridge.calls.push({method,params});if(method==='mcpServerStatus/list')return {data:[{name:'node_repl',runtimeStatus:'connected',tools:{browser:{}}}],nextCursor:null};return{threadId:params.threadId,revision:1,status:method==='thread/browser/reload'&&status==='ready'?'queued':status};};
  const health=new BrowserHealth(bridge);let report=await health.diagnose(id);
  assert.equal(report.status,'ready');
  const result=await health.recover({threadId:id,confirmation:report.confirmation});assert.equal(result.status,'queued');
  assert.deepEqual(bridge.calls.at(-1),{method:'thread/browser/reload',params:{threadId:id}});
  assert.equal((await health.diagnose(id)).status,'reconnecting');
  await assert.rejects(()=>health.recover({threadId:id,confirmation:report.confirmation}));
  for(const value of ['busy','unloaded','unconfigured']){status=value;report=await health.diagnose(id);assert.equal(report.status,value);assert.equal(report.confirmation,undefined);}
  status='ready';bridge.pid++;report=await health.diagnose(id);bridge.pid++;
  await assert.rejects(()=>health.recover({threadId:id,confirmation:report.confirmation}));
  assert.equal(bridge.calls.filter(x=>x.method==='config/mcpServer/reload').length,0);
});
test('failed browser diagnostics distinguish unavailable transport from unsupported API without exposing backend details',async()=>{
  const bridge=fixture();bridge.call=async()=>{throw new Error('secret Browser Use token');};
  const result=await new BrowserHealth(bridge).diagnose(id);assert.equal(result.status,'unavailable');assert.equal(result.confirmation,undefined);assert.doesNotMatch(JSON.stringify(result),/secret|token/);
  bridge.call=async()=>{throw new Error('unknown method thread/browser/read');};
  assert.equal((await new BrowserHealth(bridge).diagnose(id)).status,'unsupported');
});

test('browser health observes host failure, disabled legacy host, recovery and pending discovery without exposing errors',async()=>{
  const bridge=fixture();let node={name:'node_repl',runtimeStatus:'failed',tools:{},toolsError:'secret token'};
  bridge.call=async(method,params)=>method==='thread/browser/read'?{revision:1,threadId:params.threadId,status:'ready'}:{data:[node,{name:'cua_repl',runtimeStatus:'disabled',toolsError:'legacy'}],nextCursor:null};
  const health=new BrowserHealth(bridge);let result=await health.diagnose(id);
  assert.equal(result.connectionState,'failed');assert.match(result.message,/启动失败/);assert.ok(result.confirmation);assert.doesNotMatch(JSON.stringify(result),/secret|token|legacy/);
  node={name:'node_repl',runtimeStatus:'connected',tools:{one:{}}};result=await health.diagnose(id);
  assert.equal(result.connectionState,'connected');assert.match(result.message,/已连接/);
  assert.equal(result.browserInstructionsAvailable,false);assert.equal(result.pageAccessVerified,false);assert.match(result.message,/未返回浏览器初始化说明/);
  node.tools={js:{description:'Use cua.getTab for iab'}};result=await health.diagnose(id);assert.equal(result.browserInstructionsAvailable,true);assert.match(result.message,/初始化说明已就绪/);assert.equal(result.pageAccessVerified,false);
  node={name:'node_repl',runtimeStatus:'starting',tools:{}};result=await health.diagnose(id);
  assert.equal(result.status,'reconnecting');assert.equal(result.confirmation,undefined);
});

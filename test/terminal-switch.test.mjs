import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalSwitch} from '../terminal-switch.mjs';
const id='01a12537-493b-7542-b502-d487829730f1';
function fixture(){
  const calls=[],queue={pending:true,desiredRevision:3,desiredIdentityId:'new',wait:{reason:'background_terminals',threadId:id}},rows=[{processId:'10',itemId:'a',osPid:100,command:'Bearer secret'},{processId:'11',itemId:'b',osPid:101}];
  const bridge={pid:1,status(){return{connected:true,pid:this.pid}},async connect(){return this.status()},async call(method,p){calls.push({method,p});if(method==='bridge/terminals/capabilities')return{revision:1};if(method.endsWith('/list'))return{data:rows.map(x=>({...x})),nextCursor:null};if(method==='thread/identity/set')return{status:'busy',blocker:{reason:'background_terminals',threadId:id}};if(method.endsWith('/terminate')){rows.splice(rows.findIndex(x=>x.processId===p.processId),1);return{terminated:true}}throw Error('unexpected')}};
  const c={inflight:new Set(),view:()=>queue,store:{pendingRequests:()=>[{threadId:id,desiredRevision:3,nativeRevision:7}]},ticks:0,tick(){this.ticks++}};
  return {service:new TerminalSwitch(bridge,()=>c),bridge,c,rows,calls,queue};
}
test('force switch requires explicit one-use confirmation and terminates only the selected inventory',async()=>{
  const f=fixture(),p=await f.service.prepare({threadId:id,expectedDesiredRevision:3});
  assert.equal(p.count,2);assert.doesNotMatch(JSON.stringify(p),/Bearer|secret/);assert.equal(f.calls.some(x=>x.method.endsWith('/terminate')),false);
  const result=await f.service.confirm({threadId:id,confirmation:p.confirmation});assert.equal(result.status,'retrying');assert.equal(result.terminated,2);assert.equal(f.c.ticks,1);assert.equal(f.c.inflight.size,0);
  assert.deepEqual(f.calls.filter(x=>x.method.endsWith('/terminate')).map(x=>x.p),[{threadId:id,processId:'10'},{threadId:id,processId:'11'}]);
  await assert.rejects(()=>f.service.confirm({threadId:id,confirmation:p.confirmation}));
});
for(const change of ['revision','identity','backend','inventory','expiry','reply'])test(`force switch rejects stale ${change} without terminating`,async()=>{
  const f=fixture(),p=await f.service.prepare({threadId:id,expectedDesiredRevision:3});
  if(change==='revision')f.queue.desiredRevision++;
  if(change==='identity')f.queue.desiredIdentityId='different';
  if(change==='backend')f.bridge.pid++;
  if(change==='inventory')f.rows.push({processId:'12',itemId:'new',osPid:102});
  if(change==='expiry')f.service.tickets.get(p.confirmation).until=0;
  if(change==='reply'){const call=f.bridge.call.bind(f.bridge);f.bridge.call=(m,p)=>m==='thread/identity/set'?{status:'busy',blocker:{reason:'reply_running',threadId:id}}:call(m,p)}
  await assert.rejects(()=>f.service.confirm({threadId:id,confirmation:p.confirmation}));assert.equal(f.calls.some(x=>x.method.endsWith('/terminate')),false);
});
test('sibling and old bridge blockers cannot offer destructive confirmation',async()=>{
  const f=fixture();f.queue.wait.threadId='01a16269-6419-7f33-9843-93c35da768cb';await assert.rejects(()=>f.service.prepare({threadId:id,expectedDesiredRevision:3}));assert.equal(f.calls.length,0);
  f.queue.wait.threadId=id;f.bridge.call=async()=>{throw Error('Method not allowed')};await assert.rejects(()=>f.service.prepare({threadId:id,expectedDesiredRevision:3}),/正常重启/);
});
test('full force pauses active goal and awaits verified identity, with no legacy queued success',async()=>{
  const f=fixture();f.queue.wait={reason:'loaded_subagent',threadId:'01a180e2-7db4-7740-a684-26b2ba1b9e91'};
  f.c.waiting=new Map();let acknowledged;
  f.c.store.acknowledge=(...args)=>{acknowledged=args};
  const call=f.bridge.call.bind(f.bridge);
  f.bridge.call=async(method,p)=>{
    if(method==='bridge/terminals/capabilities')return{revision:1,forceSwitchRevision:1};
    if(method==='thread/goal/get')return{goal:{status:'active'}};
    if(method==='thread/goal/set'){f.calls.push({method,p});return{goal:{status:'paused'}}}
    if(method==='thread/identity/forceSet'){f.calls.push({method,p});return{status:'applied',verified:true,identityId:'new'}}
    return call(method,p);
  };
  const p=await f.service.prepare({threadId:id,expectedDesiredRevision:3});assert.equal(p.allOwned,true);assert.equal(f.calls.some(x=>x.method==='thread/identity/forceSet'),false);
  const result=await f.service.confirm({threadId:id,confirmation:p.confirmation});assert.equal(result.status,'applied');assert.equal(result.verified,true);
  assert.deepEqual(f.calls.find(x=>x.method==='thread/goal/set').p,{threadId:id,origin:'user',status:'paused'});
  assert.deepEqual(acknowledged,[id,'runtime-1',3,'new']);
});
test('full force failure stops automatic queue and does not leak upstream credentials',async()=>{
  const f=fixture();f.c.waiting=new Map();let rejected;
  f.c.store.reject=(...args)=>{rejected=args};
  const call=f.bridge.call.bind(f.bridge);
  f.bridge.call=async(method,p)=>{
    if(method==='bridge/terminals/capabilities')return{revision:1,forceSwitchRevision:1};
    if(method==='thread/goal/get')return{goal:null};
    if(method==='thread/identity/forceSet')throw Error('Bearer private-secret');
    return call(method,p);
  };
  const p=await f.service.prepare({threadId:id,expectedDesiredRevision:3});
  await assert.rejects(()=>f.service.confirm({threadId:id,confirmation:p.confirmation}),error=>!error.message.includes('private-secret')&&error.message.includes('停止自动排队'));
  assert.equal(rejected[3],'force_unverified');assert.equal(f.c.inflight.size,0);
});

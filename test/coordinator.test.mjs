import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SwitchCoordinator } from '../switch-coordinator.mjs';
import {EventEmitter} from 'node:events';

function setup(t){
  const directory=mkdtempSync(join(tmpdir(),'identity-coordinator-'));
  const states=new Map();const busy=new Set();const blockers=new Map();const writes=[];const coordinators=[];
  let runtimePid=42,connected=true;
  const events=new EventEmitter();
  const bridge={on:events.on.bind(events),removeListener:events.removeListener.bind(events),status:()=>({connected,pid:runtimePid}),connect:async()=>({connected,pid:runtimePid}),call:async(method,params)=>{
    const state=states.get(params.threadId)||{threadId:params.threadId,identityId:null,revision:0,verified:false,status:'unbound'};
    if(method==='thread/identity/read')return {...state};
    if(method==='thread/resume'){
      if(state.identityId==='missing')throw new Error('Old identity is unavailable');
      states.set(params.threadId,{...state,status:'applied',verified:true});return {};
    }
    if(method==='thread/identity/set'){
      if(busy.has(params.threadId))return {...state,status:'busy',blocker:blockers.get(params.threadId)};
      assert.equal(params.expectedRevision,state.revision);writes.push(params);
      const next={...state,identityId:params.identityId,revision:state.revision+1,verified:state.status!=='unloaded',status:state.status==='unloaded'?'unloaded':'applied'};states.set(params.threadId,next);return next;
    }
    throw new Error('Unexpected RPC');
  }};
  t.after(async()=>{for(const item of coordinators)item.close();await new Promise(r=>setImmediate(r));rmSync(directory,{recursive:true,force:true});});
  return {states,busy,blockers,writes,events,replaceRuntime(pid){runtimePid=pid;},disconnect(){connected=false;},create(){const coordinator=new SwitchCoordinator(directory,bridge);clearInterval(coordinator.timer);coordinators.push(coordinator);return coordinator;}};
}
async function settled(coordinator){for(let i=0;i<20;i++){await new Promise(r=>setImmediate(r));if(!coordinator.inflight.size)return;}throw new Error('Coordinator did not settle');}

test('busy identity change stays pending while a sibling switches, then applies at idle',async t=>{
  const fixture=setup(t);const coordinator=fixture.create();fixture.busy.add('one');
  await coordinator.submit('one','api_a',0,0);await settled(coordinator);
  assert.equal(coordinator.store.read('one').appliedIdentityId,null);
  await coordinator.submit('two','api_b',0,0);await settled(coordinator);
  assert.equal(coordinator.store.read('two').appliedIdentityId,'api_b');
  fixture.busy.delete('one');await coordinator.tick();
  assert.equal(coordinator.store.read('one').appliedIdentityId,'api_a');
  assert.equal(fixture.writes.length,2);
});

test('idle lifecycle retries a busy switch without waiting for the fallback interval',async t=>{
  const fixture=setup(t);fixture.busy.add('one');const coordinator=fixture.create();
  await coordinator.submit('one','api_a',0,0);await settled(coordinator);
  assert.equal(coordinator.view('one').pending,true);
  fixture.busy.clear();fixture.events.emit('lifecycle',{method:'turn/completed'});
  for(const deadline=Date.now()+1000;coordinator.view('one').pending;){
    assert.ok(Date.now()<deadline,'Lifecycle retry did not apply');await new Promise(r=>setTimeout(r,10));
  }
  assert.equal(coordinator.view('one').verified,true);assert.equal(fixture.writes.length,1);
  coordinator.close();assert.equal(fixture.events.listenerCount('lifecycle'),0);
});

test('pending switch survives panel restart without changing its target or expected native revision',async t=>{
  const fixture=setup(t);fixture.busy.add('one');let coordinator=fixture.create();
  await coordinator.submit('one','api_a',0,0);await settled(coordinator);coordinator.close();
  coordinator=fixture.create();fixture.busy.clear();await coordinator.tick();
  assert.equal(coordinator.store.read('one').appliedIdentityId,'api_a');assert.equal(fixture.writes.length,1);
});

test('external native change fails the pending request instead of overwriting another choice',async t=>{
  const fixture=setup(t);fixture.busy.add('one');const coordinator=fixture.create();
  await coordinator.submit('one','api_a',0,0);await settled(coordinator);
  fixture.states.set('one',{threadId:'one',identityId:'other',revision:1,status:'applied',verified:true});
  fixture.busy.clear();await coordinator.tick();
  assert.equal(fixture.writes.length,0);assert.ok(coordinator.store.read('one').errorCode);
});

test('cancelling a waiting switch prevents subsequent dispatch',async t=>{
  const fixture=setup(t);fixture.busy.add('one');const coordinator=fixture.create();
  await coordinator.submit('one','api_a',0,0);await settled(coordinator);
  coordinator.cancel('one',1);fixture.busy.clear();await coordinator.tick();
  assert.equal(fixture.writes.length,0);assert.equal(coordinator.store.read('one').errorCode,'cancelled');
});

test('a cancellation arriving after confirmation cannot report a completed change as cancelled',async t=>{
  const fixture=setup(t);const coordinator=fixture.create();
  await coordinator.submit('one','api_a',0,0);await settled(coordinator);
  assert.throws(()=>coordinator.cancel('one',1),/already finished/);
  assert.equal(coordinator.store.read('one').errorCode,null);
});

test('an unloaded session replaces an unavailable identity without resuming its work',async t=>{
  const fixture=setup(t);const coordinator=fixture.create();
  fixture.states.set('one',{threadId:'one',identityId:'missing',revision:4,status:'unloaded',verified:false});
  await coordinator.submit('one','api_a',4,0);await settled(coordinator);
  assert.equal(coordinator.store.read('one').appliedIdentityId,'api_a');
  assert.equal(fixture.states.get('one').revision,5);
  assert.equal(coordinator.store.read('one').confirmationPhase,'configured');
  assert.equal(coordinator.store.read('one').verified,false);
  assert.equal(fixture.states.get('one').status,'unloaded');
});

test('busy reasons are runtime-scoped metadata and clear after success or cancellation',async t=>{
  const f=setup(t),c=f.create();f.busy.add('one');
  f.blockers.set('one',{reason:'background_terminals',threadId:'11111111-1111-4111-8111-111111111111',terminalCount:2,command:'SECRET_TOKEN',output:'PRIVATE_OUTPUT'});
  await c.submit('one','api_a',0,0);await settled(c);
  const first=c.view('one').wait;assert.equal(first.reason,'background_terminals');assert.equal(first.terminalCount,2);
  assert.doesNotMatch(JSON.stringify(first),/SECRET_TOKEN|PRIVATE_OUTPUT|command|output/);
  await c.tick();assert.equal(c.view('one').wait.since,first.since);
  f.replaceRuntime(43);assert.equal(c.view('one').wait,null);
  await c.tick();assert.equal(c.view('one').wait.runtimeId,'runtime-43');
  c.cancel('one',1);assert.equal(c.view('one').wait,null);
  await c.submit('one','api_a',0,1);await settled(c);assert.equal(c.view('one').wait.revision,2);
  f.busy.clear();await c.tick();assert.equal(c.view('one').wait,null);assert.equal(c.view('one').verified,true);
});

test('old or unknown backend blockers stay generic and never claim a guessed cause',async t=>{
  const f=setup(t),c=f.create();f.busy.add('one');
  await c.submit('one','api_a',0,0);await settled(c);assert.equal(c.view('one').wait.reason,'backend_busy');
  f.blockers.set('one',{reason:'PRIVATE_BACKEND_TEXT',threadId:'javascript:secret',terminalCount:-2});
  await c.tick();assert.equal(c.view('one').wait.reason,'backend_busy');assert.equal(c.view('one').wait.threadId,null);assert.equal(c.view('one').wait.terminalCount,0);
  f.disconnect();assert.equal(c.view('one').wait,null);
});

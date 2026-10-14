import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SwitchCoordinator } from '../switch-coordinator.mjs';

function setup(t){
  const directory=mkdtempSync(join(tmpdir(),'identity-coordinator-'));
  const states=new Map();const busy=new Set();const writes=[];const coordinators=[];
  const bridge={status:()=>({connected:true,pid:42}),connect:async()=>({connected:true,pid:42}),call:async(method,params)=>{
    const state=states.get(params.threadId)||{threadId:params.threadId,identityId:null,revision:0,verified:false,status:'unbound'};
    if(method==='thread/identity/read')return {...state};
    if(method==='thread/resume'){
      if(state.identityId==='missing')throw new Error('Old identity is unavailable');
      states.set(params.threadId,{...state,status:'applied',verified:true});return {};
    }
    if(method==='thread/identity/set'){
      if(busy.has(params.threadId))return {...state,status:'busy'};
      assert.equal(params.expectedRevision,state.revision);writes.push(params);
      const next={...state,identityId:params.identityId,revision:state.revision+1,verified:state.status!=='unloaded',status:state.status==='unloaded'?'unloaded':'applied'};states.set(params.threadId,next);return next;
    }
    throw new Error('Unexpected RPC');
  }};
  t.after(async()=>{for(const item of coordinators)item.close();await new Promise(r=>setImmediate(r));rmSync(directory,{recursive:true,force:true});});
  return {states,busy,writes,create(){const coordinator=new SwitchCoordinator(directory,bridge);clearInterval(coordinator.timer);coordinators.push(coordinator);return coordinator;}};
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BindingStore, BindingConflict } from '../bindings.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(),'codex-bindings-'));
  const path = join(root, 'bindings.sqlite');
  const stores = [];
  t.after(() => { for (const store of stores) store.close(); rmSync(root,{recursive:true,force:true}); });
  return () => { const store = new BindingStore(path); stores.push(store); return store; };
}

test('sessions switch independently and requesting a change never claims it is applied', t => {
  const store = fixture(t)();
  store.attachRuntime('one', 'worker-one');
  store.attachRuntime('two', 'worker-two');
  const pending = store.requestSwitch('one', 'chatgpt:first', 0);
  assert.equal(pending.pending, true); assert.equal(pending.appliedIdentityId, null);
  store.requestSwitch('two','api:second',0);
  store.acknowledge('one','worker-one',1,'chatgpt:first');
  assert.equal(store.read('one').pending,false);
  assert.equal(store.read('two').appliedIdentityId,null);
});

test('a captured older turn can acknowledge while a newer identity remains pending', t => {
  const store=fixture(t)(); store.attachRuntime('one','worker');
  store.requestSwitch('one','api:first',0); store.requestSwitch('one','api:second',1);
  const state=store.acknowledge('one','worker',1,'api:first');
  assert.equal(state.appliedIdentityId,'api:first'); assert.equal(state.desiredIdentityId,'api:second'); assert.equal(state.pending,true);
  store.acknowledge('one','worker',2,'api:second');
  assert.throws(()=>store.acknowledge('one','worker',1,'api:first'),BindingConflict);
});

test('durability and compare-and-set prevent competing panel windows overwriting choices', t => {
  const connect=fixture(t); const a=connect(); const b=connect();
  a.requestSwitch('one','api:first',0);
  assert.equal(b.read('one').desiredIdentityId,'api:first');
  assert.throws(()=>b.requestSwitch('one','chatgpt:other',0),BindingConflict);
  assert.equal(a.read('one').desiredRevision,1);
});

test('runtime replacement rejects stale acknowledgements and target failure keeps old identity', t => {
  const store=fixture(t)(); store.attachRuntime('one','old');
  store.requestSwitch('one','api:first',0); store.acknowledge('one','old',1,'api:first');
  store.requestSwitch('one','chatgpt:missing',1); store.attachRuntime('one','new','old');
  assert.equal(store.read('one').verified, false);
  assert.throws(()=>store.acknowledge('one','old',2,'chatgpt:missing'),BindingConflict);
  store.reject('one','new',2,'credentials_unavailable');
  const state=store.read('one'); assert.equal(state.appliedIdentityId,'api:first');assert.equal(state.errorCode,'credentials_unavailable');
  assert.throws(()=>store.acknowledge('one','new',2,'api:unrequested'),BindingConflict);
});

test('replacement runtime must re-confirm even a previously acknowledged revision', t => {
  const store=fixture(t)();store.attachRuntime('one','first');store.requestSwitch('one','api:target',0);
  store.acknowledge('one','first',1,'api:target');assert.equal(store.read('one').verified,true);
  store.attachRuntime('one','second','first');assert.equal(store.read('one').verified,false);
  store.acknowledge('one','second',1,'api:target');assert.equal(store.read('one').verified,true);
});

test('a Codex or unrelated SQLite database is rejected before schema or journal changes', t => {
  const root=mkdtempSync(join(tmpdir(),'codex-foreign-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const path=join(root,'state.sqlite');const db=new DatabaseSync(path);
  db.exec('CREATE TABLE threads(id TEXT);');db.close();const before=readFileSync(path);
  assert.throws(()=>new BindingStore(path),/not owned/);
  assert.deepEqual(readFileSync(path),before);
});

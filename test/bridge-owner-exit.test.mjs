import {copyBridgeFixture} from './support/bridge-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,copyFile,writeFile,readdir,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';

test('desktop EOF reaps an unresponsive backend and removes runtime registration', {timeout:18000}, async t=>{
  const directory=await mkdtemp(join(tmpdir(),'identity-owner-exit-'));
  await copyBridgeFixture(directory,[]);
  // Deliberately ignore stdin EOF, reproducing the orphan native backend.
  await writeFile(join(directory,'app-server'),`process.stdin.resume(); setInterval(()=>{},1000);`);
  const bridge=spawn(process.execPath,[join(directory,'runtime-bridge.cjs'),'app-server','--analytics-default-enabled'],{
    cwd:directory,env:{...process.env,CODEX_HOME:directory,IDENTITY_PATCHED_CODEX:process.execPath},windowsHide:true,stdio:['pipe','pipe','pipe'],
  });
  bridge.stdout.resume();bridge.stderr.resume();
  let nativePid;
  t.after(async()=>{
    if(nativePid)try{process.kill(nativePid);}catch{}
    if(bridge.exitCode===null){bridge.kill();await once(bridge,'exit').catch(()=>{});}
    await rm(directory,{recursive:true,force:true});
  });
  const registry=join(directory,'session-identities','runtimes');
  const deadline=Date.now()+5000;
  let file;
  while(Date.now()<deadline){file=(await readdir(registry).catch(()=>[]))[0];if(file)break;await new Promise(r=>setTimeout(r,25));}
  assert.ok(file,'bridge registration created');
  nativePid=JSON.parse(await readFile(join(registry,file),'utf8')).runtimePid;
  // Keep a pending request as well: route timeout timers must be cleared.
  bridge.stdin.write(JSON.stringify({id:1,method:'initialize',params:{}})+'\n');
  const exited=once(bridge,'exit');
  bridge.stdin.end();
  await exited;
  assert.deepEqual(await readdir(registry),[]);
  assert.throws(()=>process.kill(nativePid,0));
  const events=(await readFile(join(directory,'session-identities','logs',`${bridge.pid}.jsonl`),'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(events.some(e=>e.event==='desktop_input_closed'));
  assert.ok(events.some(e=>e.event==='desktop_shutdown_timeout'));
});

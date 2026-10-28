import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {inspectDesktopBrowser} from '../desktop-browser-health.mjs';
test('official startup evidence distinguishes a failed live Desktop from stale logs and actual readiness',async()=>{
  const root=await mkdtemp(join(tmpdir(),'desktop-browser-health-'));
  try{
    const directory=join(root,'2026','10','26');await mkdir(directory,{recursive:true});
    const file=join(directory,'codex-desktop-aaaaaaaa-100-t0-i1-000000-0.log');
    const options={logsRoot:root,now:new Date('2026-10-26T04:00:00Z'),isAlive:pid=>pid===100};
    assert.equal((await inspectDesktopBrowser(options)).state,'unknown');
    await writeFile(file,'Timed out while fetching post-login Statsig bootstrap\nBearer never-return-this\nbundled_plugins_reconcile_skipped_features_unavailable');
    const failed=await inspectDesktopBrowser(options);assert.equal(failed.state,'unavailable');assert.equal(failed.reason,'featureBootstrapTimeout');assert.equal(failed.restartRequired,true);assert.doesNotMatch(JSON.stringify(failed),/Bearer|never-return/);
    assert.equal((await inspectDesktopBrowser({...options,isAlive:()=>false})).state,'unknown');
    await writeFile(join(directory,'codex-desktop-aaaaaaaa-100-t2-i1-000000-0.log'),'browser-use native pipe listening pipePath=private-pipe');
    const ready=await inspectDesktopBrowser(options);assert.equal(ready.state,'available');assert.doesNotMatch(JSON.stringify(ready),/private-pipe/);
  }finally{await rm(root,{recursive:true,force:true})}
});

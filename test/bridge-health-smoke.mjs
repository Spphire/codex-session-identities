import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('bridge health reports duplicate desktop bridges and stale descriptors',async()=>{
  const home=await mkdtemp(join(tmpdir(),'bridge-health-'));
  try{
    const dir=join(home,'session-identities','runtimes');await mkdir(dir,{recursive:true});
    await writeFile(join(dir,'1.json'),JSON.stringify({protocol:1,pipe:'\\\\.\\pipe\\missing',token:'a',bridgePid:999999,role:'desktop'}));
    await writeFile(join(dir,'2.json'),JSON.stringify({protocol:1,pipe:'\\\\.\\pipe\\missing',token:'b',bridgePid:999998,role:'desktop'}));
    const script=join(process.cwd(),'bridge-health.mjs');
    const child=spawn(process.execPath,[script],{env:{...process.env,CODEX_HOME:home},stdio:['ignore','pipe','pipe']});
    let out='';child.stdout.on('data',x=>out+=x);await once(child.stdout,'end');await once(child,'exit');const report=JSON.parse(out);
    assert.equal(report.descriptors.length,2);assert.equal(report.live.length,0);assert.equal(report.duplicateDesktopBridges,false);
  }finally{await rm(home,{recursive:true,force:true});}
});

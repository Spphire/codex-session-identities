import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import runtime from '../runtime-companions.cjs';
const names=['codex-code-mode-host.exe','codex-command-runner.exe','codex-windows-sandbox-setup.exe'];
test('paired runtime rejects a different backend, replaced host, and corrupted package',async()=>{
  const root=await mkdtemp(join(tmpdir(),'paired-runtime-test-'));
  try{
    const bundle=join(root,'bundle');const paired=join(root,'paired');await mkdir(bundle);await mkdir(paired);
    const manifest={};
    for(const name of ['codex-app-server.exe',...names]){
      const bytes=Buffer.from('compatible-'+name);manifest[name]=createHash('sha256').update(bytes).digest('hex');
      await writeFile(join(bundle,name),bytes);if(names.includes(name))await writeFile(join(paired,name),bytes);
    }
    const config={appServerExe:join(bundle,'codex-app-server.exe'),backendRuntimeManifest:join(paired,'manifest.json')};
    await writeFile(config.backendRuntimeManifest,JSON.stringify(manifest));
    assert.deepEqual(runtime.verifyBackendRuntime(config),manifest);
    await writeFile(join(bundle,names[0]),'newer-incompatible-host');
    assert.throws(()=>runtime.verifyBackendRuntime(config),/companion does not match/);
    assert.equal(await readFile(join(bundle,names[0]),'utf8'),'newer-incompatible-host','validation never overwrites binaries');
    await writeFile(join(bundle,names[0]),'compatible-'+names[0]);
    await writeFile(join(paired,names[0]),'corrupt');
    assert.throws(()=>runtime.verifyBackendRuntime(config),/hash mismatch/);
    await writeFile(join(paired,names[0]),'compatible-'+names[0]);
    await writeFile(config.appServerExe,'different-backend');
    assert.throws(()=>runtime.verifyBackendRuntime(config),/hash mismatch/);
    assert.throws(()=>runtime.verifyBackendRuntime({}),/manifest is required/);
  }finally{await rm(root,{recursive:true,force:true})}
});

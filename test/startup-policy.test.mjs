import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

for(const signOut of [false,true])test(`startup policy delegates unchanged to official CLI (sign out: ${signOut})`,async()=>{
  const root=await mkdtemp(join(tmpdir(),'identity-startup-policy-'));
  try{
    for(const file of ['runtime-bridge.cjs','model-catalog-compat.cjs','client-version-compat.cjs','feature-config-compat.cjs'])await copyFile(resolve(file),join(root,file));
    await writeFile(join(root,'runtime-config.json'),JSON.stringify({originalCodexExe:process.execPath,appServerExe:join(root,'must-not-run.exe')}));
    // Node treats app-server as its script: emulate the official command without
    // using credentials, signing out a real account, or starting a real Desktop.
    await writeFile(join(root,'app-server'),`process.stdout.write(JSON.stringify({args:process.argv.slice(2),home:process.env.CODEX_HOME}));process.exitCode=17;`);
    const args=['app-server','-c','features.code_mode_host=true','--print-startup-config','--startup-client-info',JSON.stringify({name:'codex_desktop',title:'Codex Desktop',version:'test'}),...(signOut?['--startup-sign-out']:[])];
    const child=spawnSync(process.execPath,[join(root,'runtime-bridge.cjs'),...args],{cwd:root,env:{...process.env,CODEX_HOME:root},encoding:'utf8',windowsHide:true,timeout:10000});
    assert.equal(child.status,17,child.stderr);
    assert.deepEqual(JSON.parse(child.stdout),{args:args.slice(1),home:root});
    await assert.rejects(readFile(join(root,'session-identities','runtimes')), {code:'ENOENT'});
  }finally{await rm(root,{recursive:true,force:true})}
});

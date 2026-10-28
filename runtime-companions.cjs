'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const names=['codex-code-mode-host.exe','codex-command-runner.exe','codex-windows-sandbox-setup.exe'];
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
function verifyBackendRuntime(config){
  if(!config.backendRuntimeManifest)throw new Error('A paired backend runtime manifest is required; reinstall the identity runtime before launching.');
  const manifest=JSON.parse(fs.readFileSync(config.backendRuntimeManifest,'utf8').replace(/^\uFEFF/,''));
  const directory=path.dirname(config.backendRuntimeManifest);
  for(const name of ['codex-app-server.exe',...names]){
    if(typeof manifest[name]!=='string'||!/^[A-Fa-f0-9]{64}$/.test(manifest[name]))throw new Error('Invalid paired backend runtime manifest');
    const source=name==='codex-app-server.exe'?config.appServerExe:path.join(directory,name);
    if(hash(source)!==manifest[name].toUpperCase())throw new Error(`Paired backend runtime hash mismatch: ${name}`);
    if(name!=='codex-app-server.exe'&&hash(path.join(path.dirname(config.appServerExe),name))!==manifest[name].toUpperCase())throw new Error(`Backend companion does not match its runtime: ${name}`);
  }
  return manifest;
}
module.exports={verifyBackendRuntime};

import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile,link,cp,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

const [release,update,output]=process.argv.slice(2).map(value=>resolve(value));
if(!release||!update||!output)throw new Error('Pass full release, small update and new output directory');
const repo=fileURLToPath(new URL('../',import.meta.url));
const payload=join(release,'payload'),installation=join(output,'installation'),home=join(output,'home');
await mkdir(installation,{recursive:true});await mkdir(home,{recursive:true});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex').toUpperCase();
const psRoot=join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0');
const run=(script,args=[])=>spawnSync(join(psRoot,'powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,...args],{env:{...process.env,PSModulePath:join(psRoot,'Modules')},windowsHide:true,encoding:'utf8',timeout:45000});
const files=JSON.parse(await readFile(join(payload,'payload-files.json'),'utf8')).files;
for(const entry of JSON.parse(await readFile(join(release,'manifest.json'),'utf8')).files){
  assert.equal(digest(await readFile(join(release,entry.path))),entry.sha256.toUpperCase());
}
const small=JSON.parse(await readFile(join(update,'panel-update-manifest.json'),'utf8'));
assert.deepEqual(small.files.map(e=>e.name).sort(),files.filter(e=>e.panelUpdate).map(e=>e.path).sort());
for(const entry of small.files)assert.equal(digest(await readFile(join(update,'payload',entry.name))),entry.sha256.toUpperCase());

// Reconstruct the previous published source, plus unchanged native launchers.
const before=new Map();
for(const entry of files){
  let bytes;
  if(entry.path.endsWith('.exe'))bytes=await readFile(join(payload,entry.path));
  else{
    const previous=spawnSync('git',['show','d9727e7:'+entry.path],{cwd:repo,windowsHide:true});
    if(previous.status!==0)continue;
    bytes=previous.stdout;
  }
  await mkdir(dirname(join(installation,entry.path)),{recursive:true});
  await writeFile(join(installation,entry.path),bytes);before.set(entry.path,digest(bytes));
}
await link(join(payload,'node.exe'),join(installation,'node.exe'));
const db=new DatabaseSync(join(home,'state_5.sqlite'));
db.exec('CREATE TABLE threads(id TEXT,title TEXT,model_provider TEXT,model TEXT,cwd TEXT,updated_at INTEGER,archived INTEGER)');db.close();
const auth='{"auth_mode":"api_key","fixture":"UNCHANGED_SYNTHETIC_AUTH"}';
await writeFile(join(home,'auth.json'),auth);
await writeFile(join(installation,'backend.bin'),'UNCHANGED_SYNTHETIC_BACKEND');
const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(r=>reservation.close(r));
const config=JSON.stringify({codexHome:home,panelPort:port,appServerExe:join(installation,'backend.bin')});
await writeFile(join(installation,'runtime-config.json'),config);
const accessFile=join(home,'session-identities',`panel-access-${port}.json`);
const old=spawn(join(installation,'node.exe'),[join(installation,'server.mjs')],{env:{...process.env,CODEX_HOME:home,IDENTITY_PANEL_PORT:String(port)},windowsHide:true,stdio:'ignore'});
async function state(){
  const access=JSON.parse(await readFile(accessFile,'utf8'));
  const response=await fetch(`http://127.0.0.1:${port}/api/state`,{headers:{'X-Codex-Identity-Access':access.token},signal:AbortSignal.timeout(2000)});
  assert.equal(response.status,200);return response.json();
}
let passed=false;
try{
  const deadline=Date.now()+10000;
  while(true){try{await state();break}catch(error){if(Date.now()>deadline)throw error;await new Promise(r=>setTimeout(r,100))}}
  const broken=join(output,'broken-update');await cp(join(update,'payload'),broken,{recursive:true});
  await writeFile(join(broken,'open-panel.mjs'),'process.exit(9);');
  const failed=run(join(broken,'Update-Panel.ps1'),['-Installation',installation,'-Source',broken]);
  assert.notEqual(failed.status,0,'bad candidate must roll back');
  for(const [name,hash] of before)assert.equal(digest(await readFile(join(installation,name))),hash,`${name} restored`);
  for(const entry of files.filter(e=>e.panelUpdate&&!before.has(e.path)))await assert.rejects(stat(join(installation,entry.path)),{code:'ENOENT'});
  await state();
  const resultPath=join(output,'update-result.json');
  const applied=run(join(update,'Apply-PanelUpdate.ps1'),['-Installation',installation,'-ResultPath',resultPath]);
  assert.equal(applied.status,0,applied.stderr);
  for(const entry of small.files)assert.equal(digest(await readFile(join(installation,entry.name))),entry.sha256.toUpperCase());
  assert.equal(await readFile(join(home,'auth.json'),'utf8'),auth);
  assert.equal(await readFile(join(installation,'runtime-config.json'),'utf8'),config);
  assert.equal(await readFile(join(installation,'backend.bin'),'utf8'),'UNCHANGED_SYNTHETIC_BACKEND');
  const result=await state();assert.deepEqual(result.identities,[]);
  passed=true;
}finally{
  // Kill only the fixture server, with executable, arguments and creation-time
  // checks. This test never enumerates or restarts production Codex processes.
  const cleanup=join(output,'stop-fixture.ps1');
  await writeFile(cleanup,`param($Installation)\n$exe=Join-Path $Installation 'node.exe'\n$server=Join-Path $Installation 'server.mjs'\nGet-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -eq $exe -and $_.CommandLine -match [regex]::Escape($server)} | ForEach-Object { $current=Get-CimInstance Win32_Process -Filter ('ProcessId='+$_.ProcessId); if($current.CreationDate -eq $_.CreationDate -and $current.ExecutablePath -eq $exe){Stop-Process -Id $_.ProcessId} }\n`);
  const stopped=run(cleanup,['-Installation',installation]);assert.equal(stopped.status,0,stopped.stderr);
  if(old.exitCode===null&&old.signalCode===null)await once(old,'exit');
  await writeFile(join(output,'result.json'),JSON.stringify({passed,releaseHashesVerified:true,smallUpdateInventoryVerified:true,oldVersionUpdated:passed,failedUpdateRolledBack:passed,newFilesRemovedOnRollback:passed,authConfigBackendPreserved:passed,productionRestarted:false},null,2));
}
console.log(JSON.stringify({passed,rollbackVerified:passed,updateVerified:passed,productionRestarted:false}));

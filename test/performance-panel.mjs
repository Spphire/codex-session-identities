// Read-only timings. Never emit the access token or the returned chat/account data.
import {readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const installation=resolve(process.argv[2]||'.');
const config=JSON.parse(await readFile(join(installation,'runtime-config.json'),'utf8'));
const access=JSON.parse(await readFile(join(config.codexHome,'session-identities',`panel-access-${config.panelPort}.json`),'utf8'));
const url=`http://127.0.0.1:${config.panelPort}/api/state`;
const cpu=()=>JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',`Get-Process -Id ${Number(access.pid)} | ForEach-Object { [pscustomobject]@{cpuSeconds=$_.CPU;privateMiB=$_.PrivateMemorySize64/1MB;workingSetMiB=$_.WorkingSet64/1MB} } | ConvertTo-Json -Compress`],{encoding:'utf8',windowsHide:true}).trim());
async function read(){
  const start=performance.now();const response=await fetch(url,{headers:{'X-Codex-Identity-Access':access.token},signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,200);const raw=await response.text();const data=JSON.parse(raw);
  return {ms:performance.now()-start,bytes:Buffer.byteLength(raw),sessions:data.sessions.length,identities:data.identities.length,connected:data.runtime.connected};
}
const first=await read();const before=cpu();const times=[];
for(let i=0;i<30;i++)times.push((await read()).ms);
const after=cpu();times.sort((a,b)=>a-b);
const idleBefore=cpu();const start=performance.now();await new Promise(r=>setTimeout(r,10000));const idleAfter=cpu();
const result={date:new Date().toISOString(),passed:true,readOnly:true,sessions:first.sessions,identities:first.identities,connected:first.connected,
  stateBytes:first.bytes,firstMs:+first.ms.toFixed(3),n:times.length,medianMs:+times[15].toFixed(3),p95Ms:+times[28].toFixed(3),
  cpuMsPerRequest:+((after.cpuSeconds-before.cpuSeconds)*1000/30).toFixed(3),estimatedOneTabPollingCorePercent:+((after.cpuSeconds-before.cpuSeconds)*1000/30/5000*100).toFixed(3),
  idleWallMs:+(performance.now()-start).toFixed(0),idleCpuSeconds:+(idleAfter.cpuSeconds-idleBefore.cpuSeconds).toFixed(6),
  privateMiB:+idleAfter.privateMiB.toFixed(2),workingSetMiB:+idleAfter.workingSetMiB.toFixed(2)};
await writeFile(resolve(process.argv[3]||'performance-panel-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));

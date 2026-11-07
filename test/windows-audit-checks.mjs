import {spawnSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Run each PowerShell fixture in a separate process: their mocks intentionally
// shadow native cmdlets and must not leak between checks.
const repo=fileURLToPath(new URL('../',import.meta.url));
const [installation,output]=process.argv.slice(2).map(value=>resolve(value));
if(!installation||!output)throw new Error('Pass staged installation and new fixture output directory');
await mkdir(output,{recursive:true});
const cases=[
  ['launch-error-check',[]],['package-launch-check',[]],['launcher-permissions-check',[]],
  ['launcher-update-ownership-check',['-Installation',installation]],
  ...['installer-config-check','panel-elevation-check','panel-update-ownership-check','installation-discovery-check','runtime-bundle-check'].map(name=>[name,['-FixtureDirectory',join(output,name)]]),
  ['launcher-restart-integration',['-Installation',installation,'-FixtureDirectory',join(output,'restart')]],
  ['launcher-restart-integration',['-Installation',installation,'-FixtureDirectory',join(output,'rejection'),'-RejectCompatibility']],
];
const results=[];
for(const [name,args] of cases){
  const shellRoot=join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0');
  const result=spawnSync(join(shellRoot,'powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(repo,'test',name+'.ps1'),...args],{env:{...process.env,PSModulePath:join(shellRoot,'Modules')},encoding:'utf8',windowsHide:true,timeout:90000});
  const record={name,args,passed:result.status===0,stdout:result.stdout,stderr:result.stderr,error:result.error?.message};
  results.push(record);console.log(JSON.stringify({name,passed:record.passed}));
}
await writeFile(join(output,'results.json'),JSON.stringify(results,null,2));
if(results.some(r=>!r.passed))process.exitCode=1;

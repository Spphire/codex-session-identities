import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo=fileURLToPath(new URL('../',import.meta.url));
const [backend,output]=process.argv.slice(2,4).map(value=>resolve(value));
const selected=process.argv.slice(4);
if(!backend||!output)throw new Error('Pass paired backend executable and report output directory');
await mkdir(output,{recursive:true});
const installation=join(output,'installation');await mkdir(installation,{recursive:true});
await writeFile(join(installation,'runtime-config.json'),JSON.stringify({appServerExe:backend}));
// Only synthetic loopback fixtures. Real-account routing/usage tests are excluded.
const cases=[
  ['runtime-smoke',['legacy']],['runtime-smoke',['paginated']],
  ['ephemeral-fork-identity-smoke',['legacy']],['ephemeral-fork-identity-smoke',['paginated']],
  ['fork-independent-identity-smoke',[]],['switch-blocker-smoke',[]],
  ['completed-subagent-switch-smoke',[]],['force-owned-work-native-smoke',[]],
  ['sidebar-browser-native-smoke',[]],['tool-health-native-smoke',[]],
  ['feature-config-native-smoke',[]],['execution-policy-smoke',[]],
  ['appshot-smoke',[]],['api-identity-native-smoke',[]],
  ['paired-execution-bridge-smoke',[]],
];
const results=[];
for(const [name,args] of cases){
  if(selected.length&&!selected.includes(name))continue;
  const health=name==='sidebar-browser-native-smoke'||name==='tool-health-native-smoke';
  const cwd=health?join(output,name):repo;await mkdir(cwd,{recursive:true});
  const result=await new Promise(resolve=>{
    const child=spawn(process.execPath,[join(repo,'test',name+'.mjs'),health?installation:backend,...args],{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);
    child.on('error',error=>resolve({passed:false,error:error.message}));
    child.on('close',code=>resolve({passed:code===0,code,stdout,stderr}));
  });
  results.push({name,args,...result});console.log(JSON.stringify({name,args,passed:result.passed}));
  await writeFile(join(output,'results.json'),JSON.stringify(results,null,2));
}
if(results.some(r=>!r.passed))process.exitCode=1;

// Explicit opt-in: real official catalog networking, no model inference.
// Short-lived credential copies are private and removed after the isolated run.
import {readFile, writeFile, mkdir, mkdtemp, readdir, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {StdioClient} from '../stdio-client.mjs';
const installation=resolve(process.argv[2]);const output=resolve(process.argv[3]);
const config=JSON.parse(await readFile(join(installation,'runtime-config.json'),'utf8'));
const profileRoot=join(config.codexHome,'session-identities','profiles');
const hostBytes=await readFile(join(config.codexHome,'auth.json'));const host=JSON.parse(hostBytes);
const profiles=[];
for(const id of await readdir(profileRoot))profiles.push({id,...JSON.parse(await readFile(join(profileRoot,id,'profile.json'),'utf8'))});
const a=profiles.find(p=>p.kind==='chatgpt-system'&&p.accountId===host.tokens.account_id);
const b=profiles.find(p=>p.kind==='chatgpt'&&p.accountId!==a?.accountId);
assert.ok(a&&b,'Two distinct official accounts are required');
const privatePath=join(profileRoot,b.id,'auth.json');const privateBytes=await readFile(privatePath);
const home=await mkdtemp(join(process.env.PERF_TMP||tmpdir(),'official-perf-'));
const short=auth=>({...auth,tokens:{...auth.tokens,refresh_token:''}});
const hash=b=>createHash('sha256').update(b).digest('hex');
const report={date:new Date().toISOString(),isolated:true,modelInference:false,distinctOfficialAccounts:true,checks:[]};
let client;
function summary(values){const s=[...values].sort((a,b)=>a-b);return {n:s.length,medianMs:+s[Math.floor(s.length/2)].toFixed(3),p95Ms:+s[Math.ceil(s.length*.95)-1].toFixed(3),maxMs:+s.at(-1).toFixed(3)};}
try{
  await writeFile(join(home,'auth.json'),JSON.stringify(short(host)),{mode:0o600});
  await writeFile(join(home,'config.toml'),'model_provider="openai"\nmodel="gpt-6-luna"\n');
  for(const profile of [a,b]){
    const directory=join(home,'session-identities','profiles',profile.id);await mkdir(directory,{recursive:true});
    const copy={...profile};delete copy.id;await writeFile(join(directory,'profile.json'),JSON.stringify(copy));
    if(profile===b)await writeFile(join(directory,'auth.json'),JSON.stringify(short(JSON.parse(privateBytes))),{mode:0o600});
  }
  client=new StdioClient(join(installation,'node.exe'),[join(installation,'runtime-bridge.cjs'),'app-server'],{cwd:home,env:{...process.env,CODEX_HOME:home,RUST_MIN_STACK:'33554432'}});
  await client.initialize('official_performance_probe');
  const options={cwd:home,model:'gpt-6-luna',historyMode:'paginated',approvalPolicy:'never',sandbox:'danger-full-access'};
  const threadId=(await client.call('thread/start',options)).thread.id;
  const sibling=(await client.call('thread/start',options)).thread.id;
  let revision=(await client.call('thread/identity/set',{threadId,identityId:a.id,expectedRevision:0})).revision;
  const methods={accountRead:['account/read',{}],threadList:['thread/list',{limit:10}],siblingRename:['thread/name/set',{threadId:sibling,name:'Isolated performance fixture'}],commandExec:['command/exec',{command:['cmd.exe','/d','/c','echo PERF_OK'],cwd:home,sandboxPolicy:{type:'dangerFullAccess'}}]};
  const measured=async(name,times)=>{
    const start=performance.now();const [method,params]=methods[name];const result=await client.call(method,params);
    if(name==='commandExec'){assert.equal(result.exitCode,0);assert.match(result.stdout,/PERF_OK/);}
    times.push(performance.now()-start);
  };
  report.baseline={};
  for(const name of Object.keys(methods)){const times=[];for(let i=0;i<5;i++)await measured(name,times);report.baseline[name]=summary(times);}
  for(const [label,profile] of [['A-to-B',b],['B-to-A',a]]){
    const times=Object.fromEntries(Object.keys(methods).map(k=>[k,[]]));let done=false;
    const start=performance.now();
    const switching=client.call('thread/identity/set',{threadId,identityId:profile.id,expectedRevision:revision}).then(result=>{done=true;assert.equal(result.verified,true);assert.equal(result.identityId,profile.id);revision=result.revision;return performance.now()-start;},error=>{done=true;throw error;});
    // Observe independent operations throughout preparation and teardown/reload.
    const probe=async()=>{do{await Promise.all(Object.keys(methods).map(name=>measured(name,times[name])));if(!done)await new Promise(r=>setTimeout(r,25));}while(!done);};
    const [switchMs]=await Promise.all([switching,probe()]);
    report.checks.push({transition:label,switchMs:+switchMs.toFixed(3),duringSwitch:Object.fromEntries(Object.entries(times).map(([k,v])=>[k,summary(v)]))});
    await writeFile(output,JSON.stringify(report,null,2));
  }
  assert.equal(hash(await readFile(join(config.codexHome,'auth.json'))),hash(hostBytes));
  assert.equal(hash(await readFile(privatePath)),hash(privateBytes));report.originalAuthUnchanged=true;report.passed=true;
}catch(error){report.passed=false;report.error=error.message;process.exitCode=1;}
finally{await client?.close();await rm(home,{recursive:true,force:true});await writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}

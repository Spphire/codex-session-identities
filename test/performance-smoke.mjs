// Explicit, isolated benchmark. No real credentials or paid model requests.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp, mkdir, readFile, writeFile, copyFile, readdir} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir, cpus} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {StdioClient} from '../stdio-client.mjs';
import {BridgeClient} from '../bridge-client.mjs';
import {SwitchCoordinator} from '../switch-coordinator.mjs';

const installation=resolve(process.argv[2]||'.');
const output=resolve(process.argv[3]||'performance-result.json');
const config=JSON.parse(await readFile(join(installation,'runtime-config.json'),'utf8'));
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const directory=await mkdtemp(join(process.env.PERF_TMP||tmpdir(),'codex-perf-'));
const samples=Number(process.env.PERF_SAMPLES||5);
assert.ok(Number.isInteger(samples)&&samples>=2&&samples<=10);
let requestCount=0,expectedBearer=null,hold=null;
const server=createServer(async(req,res)=>{
  if(req.method!=='POST'||!req.url.endsWith('/responses')){res.writeHead(404);res.end('{}');return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const body=JSON.parse(Buffer.concat(chunks));requestCount++;
  if(expectedBearer)assert.equal(req.headers.authorization,expectedBearer);
  const current=JSON.stringify(body.input.filter(item=>item.role==='user').at(-1));
  const burst=current.includes('perf_burst');
  const id=`resp_${requestCount}`;
  const item={id:`msg_${requestCount}`,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:burst?'x'.repeat(1000):'OK'}]};
  const events=[{type:'response.created',response:{id,status:'in_progress'}},
    {type:'response.output_item.added',output_index:0,item:{...item,status:'in_progress',content:[]}},
    {type:'response.content_part.added',item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:''}}];
  for(let n=0;n<(burst?1000:1);n++)events.push({type:'response.output_text.delta',item_id:item.id,output_index:0,content_index:0,delta:burst?'x':'OK'});
  events.push({type:'response.output_item.done',output_index:0,item},
    {type:'response.completed',response:{id,status:'completed',output:[item],usage:{input_tokens:12,output_tokens:2,total_tokens:14}}});
  const finish=()=>{res.writeHead(200,{'content-type':'text/event-stream'});res.end(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));};
  if(current.includes('perf_hold'))hold=finish;else finish();
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}/v1`;
const bridgeDirectory=join(directory,'adapter');await mkdir(bridgeDirectory);
for(const name of ['runtime-bridge.cjs','client-version-compat.cjs','model-catalog-compat.cjs','stdio-client.mjs'])await copyFile(join(root,name),join(bridgeDirectory,name));
await writeFile(join(bridgeDirectory,'runtime-config.json'),JSON.stringify({appServerExe:config.appServerExe,originalCodexExe:config.originalCodexExe}));
const env={...process.env,CODEX_IDENTITY_CLIENT_VERSION:'0.162.0-alpha.17.2',NO_PROXY:'127.0.0.1,localhost,::1',no_proxy:'127.0.0.1,localhost,::1',RUST_MIN_STACK:'33554432'};
for(const key of ['CODEX_ACCESS_TOKEN','CODEX_API_KEY','OPENAI_API_KEY','OPENAI_BASE_URL','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])delete env[key];
const homes=new Map();
async function homeFor(mode){
  if(homes.has(mode))return homes.get(mode);
  const home=join(directory,mode);await mkdir(home);
  await writeFile(join(home,'config.toml'),`model="gpt-5.1-codex"\nmodel_provider="perf"\n[model_providers.perf]\nname="Synthetic"\nbase_url="${base}"\nwire_api="responses"\nexperimental_bearer_token="synthetic-default"\nrequires_openai_auth=false\nsupports_websockets=false\n`);
  for(const id of ['a','b']){
    const profile=join(home,'session-identities','profiles',id);await mkdir(profile,{recursive:true});
    await writeFile(join(profile,'profile.json'),JSON.stringify({kind:'api',providerId:`perf_${id}`,provider:{name:id,base_url:base,wire_api:'responses',experimental_bearer_token:`synthetic-${id}`,requires_openai_auth:false,supports_websockets:false}}));
  }
  homes.set(mode,home);return home;
}
function summary(values){const sorted=[...values].sort((a,b)=>a-b);return {n:values.length,medianMs:+sorted[Math.floor(sorted.length/2)].toFixed(3),p95Ms:+sorted[Math.ceil(sorted.length*.95)-1].toFixed(3),minMs:+sorted[0].toFixed(3),maxMs:+sorted.at(-1).toFixed(3)};}
async function measured(fn,n){const times=[];for(let i=0;i<n;i++){const start=performance.now();await fn(i);times.push(performance.now()-start);}return summary(times);}
async function connect(mode){
  const home=await homeFor(mode);const start=performance.now();
  const client=new StdioClient(mode==='bridge'?process.execPath:mode==='original'?config.originalCodexExe:config.appServerExe,
    mode==='bridge'?[join(bridgeDirectory,'runtime-bridge.cjs'),'app-server','--analytics-default-enabled']:mode==='original'?['app-server']:[],{env:{...env,CODEX_HOME:home},cwd:home});
  const initialized=await client.call('initialize',{clientInfo:{name:'performance_probe',version:'0.1.0'},capabilities:{experimentalApi:true}});
  client.child.stdin.write('{"method":"initialized","params":{}}\n');
  return {client,startupMs:performance.now()-start,initialized,home};
}
async function until(fn,timeout=60000){const deadline=performance.now()+timeout;while(!fn()){if(performance.now()>deadline)throw new Error('Benchmark completion timeout');await new Promise(r=>setTimeout(r,2));}}
async function turn(client,threadId,text){
  const result=await client.call('turn/start',{threadId,input:[{type:'text',text}]});
  await until(()=>client.events.some(x=>x.method==='turn/completed'&&x.params?.turn?.id===result.turn.id));
  const completed=client.events.find(x=>x.method==='turn/completed'&&x.params?.turn?.id===result.turn.id);
  assert.equal(completed.params.turn.status,'completed');return result;
}
function processes(pids){
  const script=`$ErrorActionPreference='Stop'; @(Get-Process -Id ${pids.join(',')} | ForEach-Object { [pscustomobject]@{pid=$_.Id;cpuSeconds=$_.CPU;workingSetMiB=$_.WorkingSet64/1MB;privateMiB=$_.PrivateMemorySize64/1MB} }) | ConvertTo-Json -Compress`;
  return [JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',script],{encoding:'utf8',windowsHide:true}).trim())].flat();
}
const report={date:new Date().toISOString(),node:process.version,cpu:cpus()[0].model,logicalProcessors:cpus().length,
  originalVersion:execFileSync(config.originalCodexExe,['--version'],{encoding:'utf8',windowsHide:true}).trim(),
  backendSha256:createHash('sha256').update(await readFile(config.appServerExe)).digest('hex'),samples,isolated:true,synthetic:true,modes:{}};
try{
  report.installedVersionProbe=await measured(()=>execFileSync(config.originalCodexExe,['--version'],{encoding:'utf8',windowsHide:true}),5);
  report.companionHashCheck=await measured(()=>{
    for(const name of ['codex-code-mode-host.exe','codex-command-runner.exe','codex-windows-sandbox-setup.exe']){
      const digest=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
      assert.equal(digest(join(dirname(config.originalCodexExe),name)),digest(join(dirname(config.appServerExe),name)));
    }
  },5);
  // Rotate order to reduce a systematic first-process/file-cache bias.
  const starts={original:[],patched:[],bridge:[]};
  for(let round=0;round<samples;round++)for(const mode of ['original','patched','bridge'].slice(round%3).concat(['original','patched','bridge'].slice(0,round%3))){
    const run=await connect(mode);starts[mode].push(run.startupMs);await run.client.close();
  }
  for(const mode of ['original','patched','bridge']){
    const {client,home,initialized}=await connect(mode);const data=report.modes[mode]={startup:summary(starts[mode]),installedVersionReported:initialized.userAgent.includes('/0.162.0-alpha.17.2 ')};
    try{
      const threadId=(await client.call('thread/start',{cwd:home,approvalPolicy:'never',sandbox:'danger-full-access',historyMode:'paginated'})).thread.id;
      await client.call('account/read',{});
      data.accountRead=await measured(()=>client.call('account/read',{}),100);
      data.threadList=await measured(()=>client.call('thread/list',{limit:10}),30);
      data.modelListFirst=await measured(()=>client.call('model/list',{}),1);
      data.modelListCached=await measured(()=>client.call('model/list',{}),10);
      data.commandExec=await measured(async()=>{const r=await client.call('command/exec',{command:['cmd.exe','/d','/c','echo PERF_OK'],cwd:home,sandboxPolicy:{type:'dangerFullAccess'}});assert.equal(r.exitCode,0);assert.match(r.stdout,/PERF_OK/);},15);
      data.powershellExec=await measured(async()=>{const r=await client.call('command/exec',{command:['powershell.exe','-NoProfile','-Command','Write-Output PERF_OK'],cwd:home,sandboxPolicy:{type:'dangerFullAccess'}});assert.equal(r.exitCode,0);assert.match(r.stdout,/PERF_OK/);},5);
      data.syntheticTurns=await measured(()=>turn(client,threadId,'perf_short'),10);
      data.streaming1000Deltas=await measured(()=>turn(client,threadId,'perf_burst'),3);
      data.streamingNotifications=client.events.filter(e=>/output.*delta|agentMessage\/delta/.test(e.method||'')).length;
      if(mode!=='original'){
        let revision=0;
        data.idleSwitch=await measured(async i=>{
          const id=i%2?'b':'a';const result=await client.call('thread/identity/set',{threadId,identityId:id,expectedRevision:revision});
          assert.equal(result.status,'applied');assert.equal(result.verified,true);assert.equal(result.identityId,id);revision=result.revision;
        },20);
        data.switchAndRoutedReply=await measured(async i=>{
          const id=i%2?'b':'a';const result=await client.call('thread/identity/set',{threadId,identityId:id,expectedRevision:revision});revision=result.revision;
          expectedBearer=`Bearer synthetic-${id}`;await turn(client,threadId,'perf_short');expectedBearer=null;
        },6);
        if(mode==='bridge'){
          const bridge=new BridgeClient(home);const coordinator=new SwitchCoordinator(home,bridge);
          try{
            await until(()=>!!client.child.pid);assert.equal((await bridge.connect()).connected,true);
            data.panelIdleSwitch=await measured(async i=>{
              const id=i%2?'b':'a';const desired=coordinator.view(threadId).desiredRevision;
              await coordinator.submit(threadId,id,revision,desired);
              await until(()=>coordinator.view(threadId).verified&&!coordinator.view(threadId).pending);
              const result=await bridge.call('thread/identity/read',{threadId});assert.equal(result.identityId,id);revision=result.revision;
            },10);
            const held=turn(client,threadId,'perf_hold');await until(()=>Boolean(hold));
            const queuedAt=performance.now();await coordinator.submit(threadId,'a',revision,coordinator.view(threadId).desiredRevision);
            await new Promise(r=>setTimeout(r,100));assert.equal(coordinator.view(threadId).pending,true);
            const releaseAt=performance.now();hold();hold=null;await held;
            await until(()=>coordinator.view(threadId).verified&&!coordinator.view(threadId).pending);
            data.busySwitch={heldMs:+(releaseAt-queuedAt).toFixed(3),afterReleaseMs:+(performance.now()-releaseAt).toFixed(3)};
          }finally{coordinator.close();bridge.close();}
        }
      }
      const pids=[client.child.pid];
      if(mode==='bridge'){
        const registry=join(home,'session-identities','runtimes');
        const descriptor=JSON.parse(await readFile(join(registry,(await readdir(registry))[0]),'utf8'));pids.push(descriptor.runtimePid);
      }
      await new Promise(r=>setTimeout(r,2000));
      const before=processes(pids);const idleStart=performance.now();
      await new Promise(r=>setTimeout(r,10000));const after=processes(pids);
      data.idleResources={wallMs:+(performance.now()-idleStart).toFixed(0),processes:after.map(p=>({role:mode==='bridge'&&p.pid===client.child.pid?'bridge':'backend',workingSetMiB:+p.workingSetMiB.toFixed(2),privateMiB:+p.privateMiB.toFixed(2),cpuSeconds:+(p.cpuSeconds-before.find(b=>b.pid===p.pid).cpuSeconds).toFixed(6)}))};
    }finally{expectedBearer=null;await client.close();}
    console.log(JSON.stringify({mode,complete:true}));
  }
  report.passed=true;
}catch(error){report.passed=false;report.error=error.message;process.exitCode=1;}
finally{
  hold?.();server.closeAllConnections();await new Promise(r=>server.close(r));
  await writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}

import {spawn,spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,writeFile,mkdir,mkdtemp,rename,rm} from 'node:fs/promises';
import {join,resolve,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {executionProbe} from './execution-probe.mjs';
const machineJson=value=>JSON.stringify(value).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));

export async function protocolProbe(executable,home,version,args=['--listen','stdio://'],desktopOverrides=false) {
  const env={...process.env,CODEX_HOME:home,CODEX_SQLITE_HOME:home,RUST_MIN_STACK:'33554432',CODEX_IDENTITY_CLIENT_VERSION:version};
  for(const key of Object.keys(env))if(/(?:TOKEN|API_KEY|PASSWORD|SECRET)/i.test(key))delete env[key];
  const child=spawn(executable,args,{cwd:home,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  const pending=new Map();let sequence=0;let stderr='';let closed=false;
  child.stderr.on('data',chunk=>stderr=(stderr+chunk).slice(-2000));
  const rejectAll=error=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(error)}pending.clear()};
  child.on('error',rejectAll);
  const exited=new Promise(resolve=>child.on('close',()=>{closed=true;rejectAll(new Error('Probe backend exited before completing protocol checks'));resolve()}));
  child.stdin.on('error',rejectAll);
  const lines=createInterface({input:child.stdout});
  lines.on('line',line=>{let msg;try{msg=JSON.parse(line)}catch{return}const item=pending.get(msg.id);if(!item)return;pending.delete(msg.id);clearTimeout(item.timer);msg.error?item.reject(new Error(`${item.method}: ${msg.error.message}`)):item.resolve(msg.result)});
  const call=(method,params)=>new Promise((resolve,reject)=>{
    const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Compatibility timeout: ${method}`))},8000);
    pending.set(id,{resolve,reject,timer,method});child.stdin.write(JSON.stringify({id,method,params})+'\n');
  });
  try {
    await call('initialize',{clientInfo:{name:'identity_compatibility_probe',version:'1.0.0'},capabilities:{experimentalApi:true}});
    child.stdin.write('{"method":"initialized","params":{}}\n');
    const listed=await call('thread/list',{limit:1});
    if(!Array.isArray(listed.data))throw new Error('thread/list returned an unsupported shape');
    for(const historyMode of ['legacy','paginated']){
      const overrides=desktopOverrides?{config:{'features.async_compaction':{enabled:false},'features.guardianv2':{enabled:false},'features.multi_agent_v2.preserve_fork_prefix':true}}:{};
      const {thread}=await call('thread/start',{cwd:home,approvalPolicy:'never',sandbox:'read-only',historyMode,ephemeral:true,...overrides});
      if(!thread?.id||thread.ephemeral!==true)throw new Error('Backend did not preserve temporary thread semantics');
      const identity=await call('thread/identity/read',{threadId:thread.id});
      if(identity.identityId!==null)throw new Error('Isolated probe unexpectedly loaded an identity');
      await call('thread/unsubscribe',{threadId:thread.id});
    }
    return {passed:true,checks:['initialize','thread-list','identity-interface','temporary-thread','legacy-history','paginated-history',...(desktopOverrides?['desktop-structured-feature-overrides']:[])],inferenceRequests:0};
  }finally{
    rejectAll(new Error('Compatibility probe closed'));lines.close();child.stdin.end();
    if(!closed){child.kill();await exited}
  }
}

async function digest(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex')}
export function startupPolicyProbe(originalCli,adapter,home){
  const env={...process.env,CODEX_HOME:home,CODEX_SQLITE_HOME:home};
  for(const key of Object.keys(env))if(/(?:TOKEN|API_KEY|PASSWORD|SECRET)/i.test(key))delete env[key];
  const options={cwd:home,env,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1024*1024};
  const help=spawnSync(originalCli,['app-server','--help'],options);
  if(help.status!==0)throw new Error('Installed CLI app-server help is unavailable');
  if(!help.stdout.includes('--print-startup-config'))return {supported:false,checks:[]};
  const result=spawnSync(adapter,['app-server','-c','features.code_mode_host=true','--print-startup-config','--startup-client-info',JSON.stringify({name:'codex_desktop',title:'Codex Desktop',version:'compatibility-probe'})],options);
  let value;try{value=JSON.parse(result.stdout)}catch{}
  if(result.status!==0||typeof value?.appServerVersion!=='string'||!value.configRequirements||!Object.hasOwn(value.configRequirements,'requirements')){
    // Never persist startup configuration, policy details, or authentication data.
    throw new Error('Desktop startup policy command failed through the identity adapter; the current Desktop was not stopped');
  }
  return {supported:true,checks:['desktop-startup-policy']};
}
export async function installationFingerprint(root,config){
  const paths=[config.desktopExe,config.originalCodexExe,config.appServerExe,...(config.backendRuntimeManifest?[config.backendRuntimeManifest]:[]),...['node.exe','codex-identity.exe','runtime-bridge.cjs','runtime-companions.cjs','execution-probe.mjs','repair-browser-runtime.mjs','stdio-client.mjs','client-version-compat.cjs','feature-config-compat.cjs','ensure-provider-aliases.mjs','official-profile-credential.mjs','model-catalog-compat.cjs','execution-policy.cjs','bridge-client.mjs','runtime-status.mjs','Launch-Codex.ps1','launcher-permissions.ps1','launch-process.ps1','package-launch-helper.ps1','resolve-installation.ps1','runtime-bundle.ps1','compatibility-probe.mjs','Test-DesktopCompatibility.ps1',...['codex-code-mode-host.exe','codex-command-runner.exe','codex-windows-sandbox-setup.exe'].map(name=>join(dirname(config.appServerExe),name))].map(name=>resolve(root,name))];
  const hash=createHash('sha256');for(const path of paths)hash.update(JSON.stringify([resolve(path),await digest(path)]));return hash.digest('hex');
}

async function main(){
  const root=resolve(process.argv[2]||dirname(fileURLToPath(import.meta.url)));
  const config=JSON.parse(await readFile(join(root,'runtime-config.json'),'utf8'));
  const fingerprint=await installationFingerprint(root,config);
  const statusPath=join(root,'compatibility-status.json');let cached;
  try{cached=JSON.parse(await readFile(statusPath,'utf8'))}catch{}
  if(!process.argv.includes('--force')&&cached?.passed===true&&cached.fingerprint===fingerprint){console.log(machineJson({...cached,cached:true}));return}
  const diagnostics=join(root,'diagnostics');await mkdir(diagnostics,{recursive:true});
  const home=await mkdtemp(join(diagnostics,'protocol-'));
  let report;
  try{
    const cli=spawnSync(config.originalCodexExe,['--version'],{encoding:'utf8',windowsHide:true,timeout:10000});
    const match=cli.status===0&&/^codex-cli (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s*$/.exec(cli.stdout.trim());
    if(!match)throw new Error('Installed original CLI did not report a valid version');
    await writeFile(join(home,'config.toml'),'model="gpt-5.1-codex"\nmodel_provider="compatibility_probe"\n[model_providers.compatibility_probe]\nname="Isolated probe"\nbase_url="http://127.0.0.1:1/v1"\nwire_api="responses"\nrequires_openai_auth=false\nsupports_websockets=false\n');
    const backend=await protocolProbe(config.appServerExe,home,match[1]);
    const adapter=await protocolProbe(join(root,'codex-identity.exe'),home,match[1],['app-server','--listen','stdio://'],true);
    const startup=startupPolicyProbe(config.originalCodexExe,join(root,'codex-identity.exe'),home);
    const execution=await executionProbe(join(root,'codex-identity.exe'),home);
    report={...backend,inferenceRequests:execution.modelRequests,adapterChecks:[...adapter.checks,...startup.checks,...execution.checks],executionModelRequests:execution.modelRequests,externalModelRequests:0,startupPolicySupported:startup.supported,fingerprint,cliVersion:match[1],scope:'backend-adapter-startup-and-real-execution',testedAt:new Date().toISOString(),cached:false};
  }catch(error){report={passed:false,fingerprint,testedAt:new Date().toISOString(),error:error.message};process.exitCode=1}
  finally{if(!resolve(home).startsWith(resolve(diagnostics)+sep))throw new Error('Probe cleanup escaped diagnostics directory');await rm(home,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
  const temporary=statusPath+'.'+process.pid+'.tmp';await writeFile(temporary,JSON.stringify(report,null,2));await rename(temporary,statusPath);
  console.log(machineJson(report));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1});

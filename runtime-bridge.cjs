'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { createInterface } = require('node:readline');
const { InstalledModelCatalog, mergePage, validParams } = require('./model-catalog-compat.cjs');
const {initializeResult} = require('./client-version-compat.cjs');
const {compatibleFeatureConfig}=require('./feature-config-compat.cjs');
const {panelRequestPolicy}=require('./bridge-policy.cjs');

const originalArgs = process.argv.slice(2);
let config={};
try { config=JSON.parse(fs.readFileSync(path.join(__dirname,'runtime-config.json'),'utf8')); }
catch(error){if(error.code!=='ENOENT')throw error;}
const executable = process.env.IDENTITY_PATCHED_CODEX || config.originalCodexExe || path.join(__dirname, 'bin', 'codex-patched.exe');
// Desktop startup policy is a one-shot official CLI command, not a JSON-RPC
// server. Preserve its policy/authentication behavior and output unchanged.
const isServer = originalArgs.includes('app-server') && !originalArgs.some(x => ['proxy', 'daemon', 'generate-ts', 'generate-json-schema', '--print-startup-config'].includes(x));
if (!isServer) {
  const child = spawn(executable, originalArgs, { stdio:'inherit', windowsHide:true });
  child.on('error', () => { console.error('Patched Codex executable is unavailable'); process.exitCode=1; });
  child.on('exit', code => { process.exitCode=code ?? 1; });
} else {
  startBridge();
}

function startBridge() {
  const permissionControl=config.managePermissions===true
    ? require('./execution-policy.cjs') : null;
  const executionPolicy=permissionControl
    ? new permissionControl.ExecutionPolicy(process.env.CODEX_HOME || path.join(os.homedir(),'.codex')) : null;
  // The desktop-only adapter delegates ordinary CLI commands to the installed CLI.
  // Standalone app-server accepts the same -c overrides but has no CLI subcommand.
  const serverExecutable=config.appServerExe || executable;
  if(config.backendRuntimeManifest)require('./runtime-companions.cjs').verifyBackendRuntime(config);
  const serverArgs=config.appServerExe ? originalArgs.filter(x=>x!=='app-server' && x!=='--analytics-default-enabled') : originalArgs;
  const backendEnv={...process.env};
  if(config.appServerExe && config.originalCodexExe){
    const version=spawnSync(config.originalCodexExe,['--version'],{encoding:'utf8',windowsHide:true,timeout:10000});
    const match=version.status===0 && /^codex-cli (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s*$/.exec(version.stdout.trim());
    if(match){
      backendEnv.CODEX_IDENTITY_CLIENT_VERSION=match[1];
      // Native IPC companions belong to the pinned backend release. Never
      // overwrite them with binaries from an independently updated Desktop.
    }
    else console.error('Cannot determine installed Codex version; using compiled backend version');
  }
  const child = spawn(serverExecutable, serverArgs, { env:backendEnv,stdio:['pipe','pipe','pipe'], windowsHide:true });
  const modelCatalog=config.appServerExe && config.originalCodexExe
    ? new InstalledModelCatalog(config.originalCodexExe,originalArgs,process.env.CODEX_HOME || path.join(os.homedir(),'.codex')) : null;
  const token = crypto.randomBytes(32).toString('hex');
  const nonce = crypto.randomBytes(12).toString('hex');
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\codex-identity-${nonce}` : path.join(os.tmpdir(),`codex-identity-${nonce}.sock`);
  const registryDirectory = path.join(process.env.CODEX_HOME || path.join(os.homedir(),'.codex'), 'session-identities', 'runtimes');
  const descriptorPath = path.join(registryDirectory,`${process.pid}.json`);
  const routes = new Map(); const clients = new Set(); const sockets = new Set();
  const logDirectory=path.join(process.env.CODEX_HOME || path.join(os.homedir(),'.codex'),'session-identities','logs');
  const logPath=path.join(logDirectory,`${process.pid}.jsonl`);
  fs.mkdirSync(logDirectory,{recursive:true});
  const log=(event,details={})=>{try{fs.appendFileSync(logPath,JSON.stringify({time:new Date().toISOString(),pid:process.pid,childPid:child.pid,event,...details})+'\n')}catch{}};
  const routeTimers=new Map();
  const requestTimeoutMs=Number(process.env.IDENTITY_BRIDGE_REQUEST_TIMEOUT_MS||180000);
  log('bridge_started',{serverExecutable,serverArgs,role:originalArgs.includes('--analytics-default-enabled')?'desktop':'auxiliary',requestTimeoutMs});
  child.stderr?.on('data',chunk=>log('backend_stderr',{text:String(chunk).slice(-4000)}));
  let sequence=0; let ready=false; let closing=false; let desktopCloseTimer=null;
  const send = (stream, value) => { if (!stream.destroyed && !stream.writableEnded) stream.write(JSON.stringify(value)+'\n'); };
  const responseError = (stream, id, message) => send(stream,{id,error:{code:-32001,message}});
  function forward(value, destination) {
    if (value.method && value.id != null) {
      const featureConfig=compatibleFeatureConfig(value);
      value=featureConfig.message;
      if(featureConfig.adapted.length)log('feature_config_adapted',{method:value.method,keys:featureConfig.adapted});
      if(executionPolicy&&permissionControl.managedMethods.has(value.method)){
        try{value=permissionControl.applyPolicy(value,executionPolicy.read());}
        catch{responseError(destination,value.id,'Execution permission configuration is unavailable; request was not sent');return;}
      }
      if(value.method==='model/list' && modelCatalog && validParams(value.params)){
        void forwardModels(value,destination);return;
      }
      forwardRequest(value,destination);
    } else send(child.stdin,value);
  }
  function forwardRequest(value,destination,modelParams,originalModels){
      const id=`identity-bridge:${++sequence}`;
      routes.set(id,{destination,id:value.id,initialize:value.method==='initialize',modelParams,originalModels});
      log('request_forwarded',{bridgeRequestId:id,clientRequestId:value.id,method:value.method,pending:routes.size});
      routeTimers.set(id,setTimeout(()=>{const route=routes.get(id);if(!route)return;log('request_timeout',{bridgeRequestId:id,clientRequestId:route.id,method:value.method,timeoutMs:requestTimeoutMs,pending:routes.size});routes.delete(id);routeTimers.delete(id);responseError(route.destination,route.id,'身份桥接后端响应超时；详见 session-identities/logs');},requestTimeoutMs));
      send(child.stdin,{...value,id});
  }
  async function forwardModels(value,destination){
    const original=await modelCatalog.get();
    if(closing || destination.destroyed)return;
    if(original)forwardRequest({...value,params:{...value.params,includeHidden:true,cursor:null,limit:null}},destination,value.params??{},original);
    else forwardRequest(value,destination);
  }
  createInterface({input:process.stdin}).on('line',line=>{
    try { forward(JSON.parse(line), process.stdout); }
    catch { process.stderr.write('Invalid desktop RPC frame\n'); }
  }).on('close',()=>{
    // Desktop owns this stdio server. A stuck backend must not keep publishing
    // an orphan runtime after its owner has closed the input pipe.
    if(closing)return;
    log('desktop_input_closed');
    child.stdin.end();
    desktopCloseTimer=setTimeout(()=>{
      log('desktop_shutdown_timeout');
      child.kill();
    },5000);
    desktopCloseTimer.unref();
  });
  createInterface({input:child.stdout}).on('line',line=>{
    let value;try{value=JSON.parse(line);}catch{process.stderr.write('Invalid backend RPC frame\n');return;}
    if (!value.method && value.id != null && routes.has(value.id)) {
      const route=routes.get(value.id);routes.delete(value.id);clearTimeout(routeTimers.get(value.id));routeTimers.delete(value.id);
      log('request_completed',{bridgeRequestId:value.id,clientRequestId:route.id,error:value.error?.message||null,pending:routes.size});
      if(route.initialize && !value.error){value.result=initializeResult(value.result,backendEnv.CODEX_IDENTITY_CLIENT_VERSION);ready=true;for(const client of clients)send(client,{ready,pid:child.pid,protocol:1});}
      if(route.originalModels && !value.error){
        const page=mergePage(value.result,route.originalModels,route.modelParams);
        if(page)send(route.destination,{...page,id:route.id});
        else forwardRequest({id:route.id,method:'model/list',params:route.modelParams},route.destination);
      }else send(route.destination,{...value,id:route.id});
    } else {
      send(process.stdout,value);
      // Model/tool requests remain owned by Desktop. The panel receives only lifecycle events.
      if(value.id == null && ['thread/started','turn/completed','thread/status/changed'].includes(value.method)) {
        for(const client of clients)send(client,value);
      }
    }
  });
  const server=net.createServer(socket=>{
    sockets.add(socket);
    socket.setEncoding('utf8');
    let authenticated=false; let buffer='';
    const deadline=setTimeout(()=>socket.destroy(),5000);
    socket.on('error',()=>socket.destroy());
    socket.on('data',chunk=>{
      buffer+=chunk;
      if(Buffer.byteLength(buffer)>1024*1024){socket.destroy();return;}
      let index;
      while((index=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,index);buffer=buffer.slice(index+1);
        let value;try{value=JSON.parse(line);}catch{socket.destroy();return;}
        if(!authenticated){
          const candidate=Buffer.from(typeof value?.token==='string'?value.token:'');
          const expected=Buffer.from(token);
          if(candidate.length!==expected.length || !crypto.timingSafeEqual(candidate,expected)){socket.destroy();return;}
          authenticated=true;clearTimeout(deadline);clients.add(socket);send(socket,{ready,pid:child.pid,protocol:1});continue;
        }
        const decision=panelRequestPolicy(value,{ready,integrationTests:config.integrationTests,identityForceRevision:config.identityForceRevision});
        if(decision.action==='reject'){responseError(socket,value?.id??null,decision.error);continue;}
        if(decision.action==='shutdown'){send(socket,{id:value.id,result:{stopping:true}});child.stdin.end();continue;}
        if(decision.action==='reply'){send(socket,{id:value.id,result:decision.result});continue;}
        if(decision.action==='permissions'){
          send(socket,{id:value.id,result:{supported:Boolean(executionPolicy),...(executionPolicy?executionPolicy.read():{})}});continue;
        }
        forward(value,socket);
      }
    });
    socket.on('close',()=>{clearTimeout(deadline);clients.delete(socket);sockets.delete(socket);});
  });
  server.on('error',error=>{log('control_pipe_error',{message:error.message,code:error.code});process.stderr.write('Identity control pipe unavailable\n');});
  server.listen(pipe,()=>{
    fs.mkdirSync(registryDirectory,{recursive:true});
    const role=originalArgs.includes('--analytics-default-enabled')?'desktop':'auxiliary';
    fs.writeFileSync(descriptorPath,JSON.stringify({protocol:1,pipe,token,bridgePid:process.pid,runtimePid:child.pid,role}),{mode:0o600});
    log('control_pipe_ready',{pipe,descriptorPath});
  });
  const heartbeat=setInterval(()=>log('heartbeat',{ready,closing,clients:clients.size,sockets:sockets.size,pending:routes.size,childAlive:child.exitCode===null}),10000);
  function cleanup(code){
    if(closing)return;closing=true;clearInterval(heartbeat);clearTimeout(desktopCloseTimer);log('bridge_stopping',{code,pending:routes.size,clients:clients.size});
    modelCatalog?.close();
    executionPolicy?.close();
    for(const route of routes.values())responseError(route.destination,route.id,'Backend stopped');
    for(const timer of routeTimers.values())clearTimeout(timer);
    routeTimers.clear();routes.clear();
    for(const socket of sockets)socket.destroy();
    server.close();
    process.stdin.destroy();
    try{fs.unlinkSync(descriptorPath);}catch{}
    process.exitCode=code??1;
  }
  child.on('error',error=>{log('backend_error',{message:error.message,code:error.code});cleanup(1);});child.on('exit',(code,signal)=>{log('backend_exit',{code,signal});cleanup(code??1);});
  process.on('SIGTERM',()=>child.kill());process.on('SIGINT',()=>child.kill());
}

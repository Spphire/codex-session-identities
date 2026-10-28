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
  let sequence=0; let ready=false; let closing=false;
  const permitted = new Set(['thread/list','thread/resume','thread/identity/read','thread/identity/set','model/list','configRequirements/read','bridge/permissions/read']);
  if(config.integrationTests===true){for(const method of ['thread/start','thread/read','turn/start','thread/name/set','model/list'])permitted.add(method);}
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
  }).on('close',()=>child.stdin.end());
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
          const candidate=Buffer.from(typeof value.token==='string'?value.token:'');
          const expected=Buffer.from(token);
          if(candidate.length!==expected.length || !crypto.timingSafeEqual(candidate,expected)){socket.destroy();return;}
          authenticated=true;clearTimeout(deadline);clients.add(socket);send(socket,{ready,pid:child.pid,protocol:1});continue;
        }
        if(config.integrationTests===true && value.method==='bridge/shutdown' && value.id!=null){send(socket,{id:value.id,result:{stopping:true}});child.stdin.end();continue;}
        const toolMethod=['bridge/tools/capabilities','mcpServerStatus/list','config/mcpServer/reload','thread/browser/read','thread/browser/reload','bridge/terminals/capabilities','thread/backgroundTerminals/list','thread/backgroundTerminals/terminate','thread/identity/forceSet','thread/goal/get','thread/goal/set'].includes(value.method);
        if(!value.method || value.id==null || (!permitted.has(value.method)&&!toolMethod)){responseError(socket,value.id??null,'Method not allowed by identity bridge');continue;}
        if(!ready){responseError(socket,value.id,'Desktop has not initialized the backend');continue;}
        if(toolMethod){
          const p=value.params;
          if(['thread/browser/read','thread/browser/reload'].includes(value.method)&&p&&Object.keys(p).length===1&&typeof p.threadId==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(p.threadId)){forward(value,socket);continue;}
          const empty=p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).length===0;
          if(value.method==='bridge/terminals/capabilities'&&empty){send(socket,{id:value.id,result:{revision:1,scope:'selected-thread',forceSwitchRevision:config.identityForceRevision===1?1:0}});continue;}
          const terminalThread=p&&typeof p.threadId==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(p.threadId);
          if(config.identityForceRevision===1&&terminalThread){
            if(value.method==='thread/identity/forceSet'&&Object.keys(p).length===3&&typeof p.identityId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(p.identityId)&&Number.isSafeInteger(p.expectedRevision)&&p.expectedRevision>=0){forward(value,socket);continue;}
            if(value.method==='thread/goal/get'&&Object.keys(p).length===1){forward(value,socket);continue;}
            if(value.method==='thread/goal/set'&&Object.keys(p).length===3&&p.origin==='user'&&p.status==='paused'){forward(value,socket);continue;}
          }
          if(value.method==='thread/backgroundTerminals/list'&&terminalThread&&Object.keys(p).every(k=>['threadId','cursor','limit'].includes(k))&&p.limit===100&&(p.cursor===null||typeof p.cursor==='string'&&p.cursor.length<=8192)){forward(value,socket);continue;}
          if(value.method==='thread/backgroundTerminals/terminate'&&terminalThread&&Object.keys(p).length===2&&typeof p.processId==='string'&&/^\d{1,10}$/.test(p.processId)){forward(value,socket);continue;}
          if(value.method==='bridge/tools/capabilities'&&empty){send(socket,{id:value.id,result:{revision:1,reloadScope:'all-loaded-threads'}});continue;}
          if(value.method==='config/mcpServer/reload'&&empty){forward(value,socket);continue;}
          if(value.method==='mcpServerStatus/list'&&p&&Object.keys(p).every(k=>['threadId','detail','limit','cursor'].includes(k))&&typeof p.threadId==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(p.threadId)&&p.detail==='toolsAndAuthOnly'&&p.limit===100&&(p.cursor===null||typeof p.cursor==='string'&&p.cursor.length<=8192)){forward(value,socket);continue;}
          responseError(socket,value.id,'Invalid tool diagnostic parameters');continue;
        }
        if(value.method==='bridge/permissions/read'){
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
    if(closing)return;closing=true;clearInterval(heartbeat);log('bridge_stopping',{code,pending:routes.size,clients:clients.size});
    modelCatalog?.close();
    executionPolicy?.close();
    for(const route of routes.values())responseError(route.destination,route.id,'Backend stopped');
    for(const socket of sockets)socket.destroy();
    server.close();
    process.stdin.destroy();
    try{fs.unlinkSync(descriptorPath);}catch{}
    process.exitCode=code??1;
  }
  child.on('error',error=>{log('backend_error',{message:error.message,code:error.code});cleanup(1);});child.on('exit',(code,signal)=>{log('backend_exit',{code,signal});cleanup(code??1);});
  process.on('SIGTERM',()=>child.kill());process.on('SIGINT',()=>child.kill());
}

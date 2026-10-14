'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { createInterface } = require('node:readline');
const { InstalledModelCatalog, mergePage, validParams } = require('./model-catalog-compat.cjs');

const originalArgs = process.argv.slice(2);
let config={};
try { config=JSON.parse(fs.readFileSync(path.join(__dirname,'runtime-config.json'),'utf8')); }
catch(error){if(error.code!=='ENOENT')throw error;}
const executable = process.env.IDENTITY_PATCHED_CODEX || config.originalCodexExe || path.join(__dirname, 'bin', 'codex-patched.exe');
const isServer = originalArgs.includes('app-server') && !originalArgs.some(x => ['proxy', 'daemon', 'generate-ts', 'generate-json-schema'].includes(x));
if (!isServer) {
  const child = spawn(executable, originalArgs, { stdio:'inherit', windowsHide:true });
  child.on('error', () => { console.error('Patched Codex executable is unavailable'); process.exitCode=1; });
  child.on('exit', code => { process.exitCode=code ?? 1; });
} else {
  startBridge();
}

function startBridge() {
  // The desktop-only adapter delegates ordinary CLI commands to the installed CLI.
  // Standalone app-server accepts the same -c overrides but has no CLI subcommand.
  const serverExecutable=config.appServerExe || executable;
  const serverArgs=config.appServerExe ? originalArgs.filter(x=>x!=='app-server' && x!=='--analytics-default-enabled') : originalArgs;
  const backendEnv={...process.env};
  if(config.appServerExe && config.originalCodexExe){
    const version=spawnSync(config.originalCodexExe,['--version'],{encoding:'utf8',windowsHide:true,timeout:10000});
    const match=version.status===0 && /^codex-cli (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s*$/.exec(version.stdout.trim());
    if(match){
      backendEnv.CODEX_IDENTITY_CLIENT_VERSION=match[1];
      if(process.platform==='win32'){
        const originalDirectory=path.dirname(config.originalCodexExe);
        const backendDirectory=path.dirname(serverExecutable);
        for(const name of ['codex-code-mode-host.exe','codex-command-runner.exe','codex-windows-sandbox-setup.exe']){
          const source=path.join(originalDirectory,name);const target=path.join(backendDirectory,name);
          if(!fs.existsSync(source))throw new Error(`Installed Codex companion is missing: ${source}`);
          if(path.resolve(source).toLowerCase()===path.resolve(target).toLowerCase())continue;
          const bytes=fs.readFileSync(source);
          const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
          if(!fs.existsSync(target) || digest(bytes)!==digest(fs.readFileSync(target)))fs.copyFileSync(source,target);
        }
      }
    }
    else console.error('Cannot determine installed Codex version; using compiled backend version');
  }
  const child = spawn(serverExecutable, serverArgs, { env:backendEnv,stdio:['pipe','pipe','inherit'], windowsHide:true });
  const modelCatalog=config.appServerExe && config.originalCodexExe
    ? new InstalledModelCatalog(config.originalCodexExe,originalArgs,process.env.CODEX_HOME || path.join(os.homedir(),'.codex')) : null;
  const token = crypto.randomBytes(32).toString('hex');
  const nonce = crypto.randomBytes(12).toString('hex');
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\codex-identity-${nonce}` : path.join(os.tmpdir(),`codex-identity-${nonce}.sock`);
  const registryDirectory = path.join(process.env.CODEX_HOME || path.join(os.homedir(),'.codex'), 'session-identities', 'runtimes');
  const descriptorPath = path.join(registryDirectory,`${process.pid}.json`);
  const routes = new Map(); const clients = new Set(); const sockets = new Set();
  let sequence=0; let ready=false; let closing=false;
  const permitted = new Set(['thread/list','thread/resume','thread/identity/read','thread/identity/set','model/list']);
  if(config.integrationTests===true){for(const method of ['thread/start','thread/read','turn/start','thread/name/set','model/list'])permitted.add(method);}
  const send = (stream, value) => { if (!stream.destroyed && !stream.writableEnded) stream.write(JSON.stringify(value)+'\n'); };
  const responseError = (stream, id, message) => send(stream,{id,error:{code:-32001,message}});
  function forward(value, destination) {
    if (value.method && value.id != null) {
      if(value.method==='model/list' && modelCatalog && validParams(value.params)){
        void forwardModels(value,destination);return;
      }
      forwardRequest(value,destination);
    } else send(child.stdin,value);
  }
  function forwardRequest(value,destination,modelParams,originalModels){
      const id=`identity-bridge:${++sequence}`;
      routes.set(id,{destination,id:value.id,initialize:value.method==='initialize',modelParams,originalModels});
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
      const route=routes.get(value.id);routes.delete(value.id);
      if(route.initialize && !value.error){ready=true;for(const client of clients)send(client,{ready,pid:child.pid,protocol:1});}
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
        if(!value.method || value.id==null || !permitted.has(value.method)){responseError(socket,value.id??null,'Method not allowed by identity bridge');continue;}
        if(!ready){responseError(socket,value.id,'Desktop has not initialized the backend');continue;}
        forward(value,socket);
      }
    });
    socket.on('close',()=>{clearTimeout(deadline);clients.delete(socket);sockets.delete(socket);});
  });
  server.on('error',()=>{process.stderr.write('Identity control pipe unavailable\n');});
  server.listen(pipe,()=>{
    fs.mkdirSync(registryDirectory,{recursive:true});
    const role=originalArgs.includes('--analytics-default-enabled')?'desktop':'auxiliary';
    fs.writeFileSync(descriptorPath,JSON.stringify({protocol:1,pipe,token,bridgePid:process.pid,runtimePid:child.pid,role}),{mode:0o600});
  });
  function cleanup(code){
    if(closing)return;closing=true;
    modelCatalog?.close();
    for(const route of routes.values())responseError(route.destination,route.id,'Backend stopped');
    for(const socket of sockets)socket.destroy();
    server.close();
    process.stdin.destroy();
    try{fs.unlinkSync(descriptorPath);}catch{}
    process.exitCode=code??1;
  }
  child.on('error',()=>cleanup(1));child.on('exit',cleanup);
  process.on('SIGTERM',()=>child.kill());process.on('SIGINT',()=>child.kill());
}

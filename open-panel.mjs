import {readFile,open,mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join,dirname} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=dirname(fileURLToPath(import.meta.url));
let configuration={};try{configuration=JSON.parse(await readFile(join(root,'runtime-config.json'),'utf8'));}catch{}
const home=process.env.CODEX_HOME||configuration.codexHome||join(homedir(),'.codex');
const port=Number(process.env.IDENTITY_PANEL_PORT||configuration.panelPort||18189);
const directory=join(home,'session-identities');await mkdir(directory,{recursive:true});
async function available(){
  try{
    const value=JSON.parse(await readFile(join(directory,`panel-access-${port}.json`),'utf8'));
    const response=await fetch(`http://127.0.0.1:${port}/api/state`,{headers:{'X-Codex-Identity-Access':value.token},signal:AbortSignal.timeout(1500)});
    return response.ok?value:null;
  }catch{return null;}
}
try{
  let descriptor=await available();
  if(!descriptor){
    const log=await open(join(directory,'panel-service.log'),'a');
    const child=spawn(process.execPath,[join(root,'server.mjs')],{cwd:root,env:{...process.env,CODEX_HOME:home,IDENTITY_PANEL_PORT:String(port)},detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd]});
    child.unref();await log.close();
    const deadline=Date.now()+10000;
    while(!descriptor&&Date.now()<deadline){await new Promise(r=>setTimeout(r,200));descriptor=await available();}
  }
  if(!descriptor)throw new Error('Panel service unavailable');
  if(process.argv.includes('--check')){console.log(JSON.stringify({ready:true,port}));process.exit(0);}
  const uiHash=createHash('sha256');
  for(const contents of await Promise.all(['index.html','app.js','style.css'].map(name=>readFile(join(root,'public',name)))))uiHash.update(contents);
  const uiVersion=uiHash.digest('hex');
  let previous={};try{previous=JSON.parse(await readFile(join(directory,'panel-window-status.json'),'utf8'));}catch{}
  const reload=process.argv.includes('--reload')||previous.uiVersion!==uiVersion||previous.panelPid!==descriptor.pid||previous.port!==port;
  const url=`http://127.0.0.1:${port}/#access=${descriptor.token}`;
  const browser=spawn(join(process.env.WINDIR||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(root,'Open-PanelWindow.ps1'),...(reload?['-Reload']:[])],{windowsHide:true,stdio:['ignore','pipe','ignore'],env:{...process.env,IDENTITY_PANEL_OPEN_URL:url,IDENTITY_PANEL_BROWSER_PROFILE:join(directory,`panel-browser-${port}`)}});
  let activation='';browser.stdout.on('data',chunk=>{activation+=chunk;});
  await new Promise((resolve,reject)=>{
    browser.once('error',reject);
    browser.once('exit',code=>code===0?resolve():reject(new Error('Panel window activation failed')));
  });
  const result=JSON.parse(activation.trim());
  await writeFile(join(directory,'panel-window-status.json'),JSON.stringify({...result,port,uiVersion,panelPid:descriptor.pid,time:new Date().toISOString()}));
}catch(error){
  await writeFile(join(directory,'panel-launch-error.json'),JSON.stringify({code:error.code||'PANEL_UNAVAILABLE',port}));
  process.exitCode=1;
}

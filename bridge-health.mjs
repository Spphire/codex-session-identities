import {readdir,readFile,stat} from 'node:fs/promises';
import {createConnection} from 'node:net';
import {join} from 'node:path';
import {homedir} from 'node:os';

const home=process.env.CODEX_HOME||join(homedir(),'.codex');
const directory=join(home,'session-identities','runtimes');
const logs=join(home,'session-identities','logs');
const result={checkedAt:new Date().toISOString(),descriptors:[],logsDirectory:logs};
for(const file of await readdir(directory).catch(()=>[])){
  if(!/^\d+\.json$/.test(file))continue;
  const descriptor=JSON.parse(await readFile(join(directory,file),'utf8'));
  const entry={file,...descriptor,bridgeAlive:false,pipeReachable:false};
  try{process.kill(Number(descriptor.bridgePid),0);entry.bridgeAlive=true;}catch{}
  if(entry.bridgeAlive)await new Promise(resolve=>{const socket=createConnection(descriptor.pipe);const timer=setTimeout(()=>{socket.destroy();resolve();},1200);socket.on('error',()=>{clearTimeout(timer);resolve();});socket.on('connect',()=>{socket.write(JSON.stringify({token:descriptor.token})+'\n');});socket.on('data',chunk=>{clearTimeout(timer);entry.pipeReachable=String(chunk).includes('"protocol":1');socket.destroy();resolve();});});
  result.descriptors.push(entry);
}
result.live=result.descriptors.filter(x=>x.bridgeAlive);
result.healthy=result.live.filter(x=>x.pipeReachable);
result.duplicateDesktopBridges=result.live.filter(x=>x.role==='desktop').length>1;
console.log(JSON.stringify(result,null,2));
process.exitCode=result.duplicateDesktopBridges||result.healthy.length===0?1:0;

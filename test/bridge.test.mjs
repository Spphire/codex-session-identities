import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createConnection } from 'node:net';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { BridgeClient } from '../bridge-client.mjs';

async function until(operation) {
  const deadline=Date.now()+8000;
  while(Date.now()<deadline){const result=await operation();if(result)return result;await new Promise(r=>setTimeout(r,20));}
  throw new Error('Bridge test deadline exceeded');
}

function messages(input) {
  const queue=[];createInterface({input}).on('line',line=>queue.push(JSON.parse(line)));
  return {async next(){return until(()=>queue.shift());}};
}

test('bridge authenticates its pipe and keeps desktop and panel request IDs separate', async t=>{
  const directory=await mkdtemp(join(tmpdir(),'identity-bridge-'));
  const stub=`const r=require('node:readline').createInterface({input:process.stdin});r.on('line',line=>{const v=JSON.parse(line);if(v.id!=null)process.stdout.write(JSON.stringify({id:v.id,result:{method:v.method,params:v.params}})+'\\n');});`;
  await writeFile(join(directory,'app-server'),stub);
  const child=spawn(process.execPath,[resolve('runtime-bridge.cjs'),'app-server','--analytics-default-enabled'],{
    cwd:directory,env:{...process.env,CODEX_HOME:directory,IDENTITY_PATCHED_CODEX:process.execPath},windowsHide:true,stdio:['pipe','pipe','pipe'],
  });
  let socket;
  t.after(async()=>{
    socket?.destroy();child.stdin.end();
    if(child.exitCode===null){const timer=setTimeout(()=>child.kill(),3000);await once(child,'exit');clearTimeout(timer);}
    await rm(directory,{recursive:true,force:true});
  });
  const desktop=messages(child.stdout);
  const registry=join(directory,'session-identities','runtimes');
  const filename=await until(async()=>{try{return(await readdir(registry))[0];}catch{return null;}});
  const descriptor=JSON.parse(await readFile(join(registry,filename),'utf8'));
  socket=createConnection(descriptor.pipe);await once(socket,'connect');const panel=messages(socket);
  socket.write(JSON.stringify({token:descriptor.token})+'\n');assert.equal((await panel.next()).ready,false);
  socket.write(JSON.stringify({id:0,method:'thread/list',params:{}})+'\n');assert.match((await panel.next()).error.message,/not initialized/);
  child.stdin.write(JSON.stringify({id:1,method:'initialize',params:{}})+'\n');assert.equal((await desktop.next()).id,1);
  assert.equal((await panel.next()).ready,true);
  child.stdin.write(JSON.stringify({id:9,method:'thread/list',params:{side:'desktop'}})+'\n');
  socket.write(JSON.stringify({id:9,method:'thread/list',params:{side:'panel'}})+'\n');
  assert.equal((await desktop.next()).result.params.side,'desktop');
  assert.equal((await panel.next()).result.params.side,'panel');
  const frame=Buffer.from(JSON.stringify({id:11,method:'thread/list',params:{searchTerm:'身份查询'}})+'\n');
  const split=frame.indexOf(Buffer.from('身份'))+1;
  socket.write(frame.subarray(0,split));socket.write(frame.subarray(split));
  assert.equal((await panel.next()).result.params.searchTerm,'身份查询');
  socket.write(JSON.stringify({id:10,method:'account/logout',params:{}})+'\n');assert.match((await panel.next()).error.message,/not allowed/);
  const connector=new BridgeClient(directory);t.after(()=>connector.close());
  assert.equal((await connector.connect()).connected,true);
  assert.equal((await connector.call('thread/identity/read',{threadId:'synthetic'})).params.threadId,'synthetic');
  assert.doesNotMatch(JSON.stringify(connector.status()),new RegExp(descriptor.token));
  const invalid=createConnection(descriptor.pipe);await once(invalid,'connect');const closed=once(invalid,'close');invalid.write('{"token":"incorrect"}\n');await closed;
});

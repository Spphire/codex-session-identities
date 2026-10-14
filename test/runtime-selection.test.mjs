import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {BridgeClient} from '../bridge-client.mjs';

for(const scenario of [
  {roles:['auxiliary','desktop'],pid:101},
  {roles:['desktop','desktop'],pid:null},
  {roles:['auxiliary'],pid:null},
  {roles:[undefined],pid:100},
])test(`runtime discovery selects a desktop, never an auxiliary: ${scenario.roles}`,async t=>{
  const directory=await mkdtemp(join(tmpdir(),'identity-role-'));
  const registry=join(directory,'session-identities','runtimes');await mkdir(registry,{recursive:true});
  const servers=[];const sockets=new Set();const client=new BridgeClient(directory);
  t.after(async()=>{client.close();for(const socket of sockets)socket.destroy();await Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve))));await rm(directory,{recursive:true,force:true});});
  for(const [index,role] of scenario.roles.entries()){
    const nonce=randomBytes(12).toString('hex');const token=randomBytes(32).toString('hex');
    const pipe=process.platform==='win32'?`\\\\.\\pipe\\codex-identity-${nonce}`:join(directory,nonce+'.sock');
    const server=createServer(socket=>{
      sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
      socket.once('data',()=>socket.write(JSON.stringify({protocol:1,ready:true,pid:100+index})+'\n'));
    });servers.push(server);server.listen(pipe);await once(server,'listening');
    await writeFile(join(registry,`${index+1}.json`),JSON.stringify({protocol:1,pipe,token,role}));
  }
  const state=await client.connect();assert.equal(state.connected,scenario.pid!==null);assert.equal(state.pid,scenario.pid);
});

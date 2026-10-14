import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCatalog } from './catalog.mjs';
import {removeIdentity} from './identity-management.mjs';
import {OfficialLogin} from './official-login.mjs';
import {OfficialUsage} from './official-usage.mjs';
import { BridgeClient } from './bridge-client.mjs';
import { SwitchCoordinator } from './switch-coordinator.mjs';
import { existsSync } from 'node:fs';

const root = dirname(fileURLToPath(import.meta.url));
export function panelServer({ codexDirectory, switcherDirectory, originalCodexExe, officialUsageOptions, accessToken=randomBytes(32).toString('hex') }) {
  const login=new OfficialLogin(codexDirectory,originalCodexExe);
  const usage=new OfficialUsage(codexDirectory,officialUsageOptions);
  const bridge = new BridgeClient(codexDirectory);
  let coordinator=existsSync(join(codexDirectory,'session-identities','panel-bindings.sqlite'))?new SwitchCoordinator(codexDirectory,bridge):null;
  const observed=new Map();
  let writes=Promise.resolve();
  const exclusive=operation=>{const next=writes.then(operation);writes=next.catch(()=>{});return next;};
  const files = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/style.css', ['style.css', 'text/css; charset=utf-8']],
    ['/icon.svg', ['icon.svg', 'image/svg+xml']],
  ]);
  const server = createServer(async (req, res) => {
    const address = res.socket.localAddress;
    const host = `127.0.0.1:${res.socket.localPort}`;
    if (req.headers.host !== host || address !== '127.0.0.1') { res.writeHead(403); res.end(); return; }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    if(req.url?.startsWith('/api/')){
      const supplied=Buffer.from(String(req.headers['x-codex-identity-access']||''));const expected=Buffer.from(accessToken);
      if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){json(401,{error:'面板访问未授权'});return;}
    }
    try {
      if(req.url==='/api/official-login'&&req.method==='GET'){json(200,login.view());return;}
      if(req.method==='POST'&&['/api/official-login/start','/api/official-login/cancel'].includes(req.url)){
        if(req.headers.origin!==`http://${host}`||!req.headers['content-type']?.startsWith('application/json')){json(403,{error:'仅接受面板内操作'});return;}
        let size=0;for await(const chunk of req){size+=chunk.length;if(size>4096){json(413,{error:'请求过大'});return;}}
        json(200,await exclusive(()=>req.url.endsWith('/start')?login.start():login.cancel()));return;
      }
      if(req.method==='POST'&&req.url==='/api/identities/remove'){
        if(req.headers.origin!==`http://${host}`||!req.headers['content-type']?.startsWith('application/json')){json(403,{error:'仅接受面板内操作'});return;}
        let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4096){json(413,{error:'请求过大'});return;}}
        const input=JSON.parse(body);
        try{
          const result=await exclusive(()=>removeIdentity(codexDirectory,readCatalog(codexDirectory,switcherDirectory),input,coordinator?.store.pendingRequests()||[],[...observed.values()].map(x=>x.identity)));
          json(200,result);
        }catch(error){json(409,{error:error.message});}
        return;
      }
      if (req.method==='POST' && ['/api/switch','/api/cancel'].includes(req.url)) {
        if(req.headers.origin!==`http://${host}` || !req.headers['content-type']?.startsWith('application/json')){json(403,{error:'仅接受面板内操作'});return;}
        if(!(await bridge.connect()).connected){json(503,{error:'运行时桥接未接入，未更改任何会话身份。'});return;}
        let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4096){json(413,{error:'请求过大'});return;}}
        const input=JSON.parse(body);
        if(!/^[a-f0-9-]{36}$/.test(input.threadId||'') || !Number.isSafeInteger(input.expectedDesiredRevision) || input.expectedDesiredRevision<0){json(400,{error:'无效的会话或版本'});return;}
        coordinator??=new SwitchCoordinator(codexDirectory,bridge);
        if(req.url==='/api/cancel'){json(200,coordinator.cancel(input.threadId,input.expectedDesiredRevision));return;}
        const result=await exclusive(async()=>{
          const catalog=readCatalog(codexDirectory,switcherDirectory);
          if(!catalog.sessions.some(x=>x.id===input.threadId)||!catalog.identities.some(x=>x.runtimeId===input.identityId&&x.available&&!x.removed))throw new Error('会话或可用身份不存在，请刷新');
          return coordinator.submit(input.threadId,input.identityId,input.expectedRevision,input.expectedDesiredRevision);
        });
        json(202,result);return;
      }
      if (req.method !== 'GET') {
        json(503, { error: '运行时桥接未接入，未更改任何会话身份。' });
        return;
      }
      if(['/api/official-usage','/api/official-usage?refresh=1'].includes(req.url)){
        json(200,{identities:usage.snapshot(readCatalog(codexDirectory,switcherDirectory).identities,{refresh:req.url.endsWith('?refresh=1')})});return;
      }
      if (req.url === '/api/state') {
        const state = readCatalog(codexDirectory, switcherDirectory);
        state.runtime = await bridge.connect();
        for(const session of state.sessions){
          const cached=observed.get(session.id);
          if(state.runtime.connected && cached?.pid===state.runtime.pid && cached.identity.revision===session.identityRevision){session.identityId=cached.identity.identityId;session.identityState=cached.identity.verified?'verified':cached.identity.identityId?'configured':'unbound';}
          session.queue=coordinator?.view(session.id)||null;
        }
        json(200, state);
        return;
      }
      if (req.url?.startsWith('/api/identity?')) {
        const threadId = new URL(req.url, `http://${host}`).searchParams.get('threadId');
        if (!threadId || !/^[a-f0-9-]{36}$/.test(threadId)) { json(400, {error:'无效的会话 ID'}); return; }
        if (!(await bridge.connect()).connected) { json(503,{error:bridge.status().reason}); return; }
        const identity=await bridge.call('thread/identity/read', {threadId});
        observed.set(threadId,{pid:bridge.status().pid,identity});
        json(200,{...identity,queue:coordinator?.view(threadId)||null});
        return;
      }
      const asset = files.get(req.url);
      if (!asset) { json(404, { error: 'Not found' }); return; }
      const bytes = await readFile(join(root, 'public', asset[0]));
      res.writeHead(200, { 'Content-Type': asset[1] }); res.end(bytes);
    } catch(error) {
      json(500, { error: error instanceof SyntaxError?'请求格式无效':String(error.message || '身份操作失败') });
    }
  });
  server.on('close',()=>{usage.close();coordinator?.close();bridge.close();void login.cancel().catch(()=>{});});
  Object.defineProperty(server,'identityAccessToken',{value:accessToken});
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const codexDirectory = process.env.CODEX_HOME || join(homedir(), '.codex');
  const port=Number(process.env.IDENTITY_PANEL_PORT || 18189);
  let accessToken;
  try{
    const saved=JSON.parse(await readFile(join(codexDirectory,'session-identities',`panel-access-${port}.json`),'utf8'));
    if(saved.port===port && typeof saved.token==='string' && /^[a-f0-9]{64}$/.test(saved.token))accessToken=saved.token;
  }catch{}
  let originalCodexExe;try{originalCodexExe=JSON.parse(await readFile(join(root,'runtime-config.json'),'utf8')).originalCodexExe;}catch{}
  const server = panelServer({ codexDirectory, accessToken, originalCodexExe, switcherDirectory: process.env.CODEX_IDENTITY_SWITCHER_HOME || join(codexDirectory, 'identity-switcher') });
  server.listen(port, '127.0.0.1', async () => {
    const directory=join(codexDirectory,'session-identities');await mkdir(directory,{recursive:true});
    await writeFile(join(directory,`panel-access-${server.address().port}.json`),JSON.stringify({port:server.address().port,token:server.identityAccessToken,pid:process.pid}),{mode:0o600});
    console.log(`Identity panel: http://127.0.0.1:${server.address().port}`);
  });
  server.on('error', error => { console.error(`Panel could not start: ${error.code}`); process.exitCode = 1; });
}

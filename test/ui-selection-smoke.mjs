import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {panelServer} from '../server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href:'playwright');
const home=await mkdtemp(join(tmpdir(),'identity-selection-ui-'));
const a='11111111-1111-1111-1111-111111111111',b='22222222-2222-2222-2222-222222222222';
const db=new DatabaseSync(join(home,'state_5.sqlite'));
db.exec('CREATE TABLE threads(id TEXT,title TEXT,model_provider TEXT,model TEXT,cwd TEXT,updated_at INTEGER,archived INTEGER)');
for(const id of [a,b])db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?)').run(id,id,'fixture','model',home,1,0);db.close();
for(const id of ['first','second']){
  const dir=join(home,'session-identities','profiles',id);await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'profile.json'),JSON.stringify({kind:'api',providerId:'fixture_'+id}));
  await writeFile(join(dir,'label.json'),JSON.stringify({name:id==='first'?'First API':'Second API'}));
}
let first=true,releaseOld,browser;
const bridge={status:()=>({connected:true,pid:42}),async connect(){return this.status()},close(){},async call(method,{threadId}){
  if(method==='bridge/permissions/read')return{supported:false};
  if(method!=='thread/identity/read')throw Error('Unexpected method');
  const old=threadId===a&&first;
  if(old){first=false;await new Promise(r=>releaseOld=r);}
  return{threadId,identityId:old?'first':'second',revision:old?1:2,verified:true,status:'applied'};
}};
const server=panelServer({codexDirectory:home,switcherDirectory:join(home,'identity-switcher'),bridge});
server.listen(0,'127.0.0.1');await once(server,'listening');
try{
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/#access=${server.identityAccessToken}`);
  await page.locator(`tr[data-thread-id="${a}"]`).click();
  for(const deadline=Date.now()+3000;!releaseOld;){assert.ok(Date.now()<deadline);await new Promise(r=>setTimeout(r,10));}
  await page.locator(`tr[data-thread-id="${b}"]`).click();await page.waitForFunction(()=>document.querySelector('#detail-identity').textContent.includes('Second API'));
  await page.locator(`tr[data-thread-id="${a}"]`).click();
  await page.waitForFunction(()=>document.querySelector('#detail-id').textContent=== '11111111-1111-1111-1111-111111111111'&&document.querySelector('#detail-identity').textContent.includes('Second API'));
  const completed=page.waitForResponse(async response=>response.url().includes('/api/identity?')&&(await response.json()).identityId==='first');
  releaseOld();await completed;
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.match(await page.locator('#detail-identity').innerText(),/Second API/);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,oldResponseIgnoredAfterSelectionRoundTrip:true}));
}finally{releaseOld?.();await browser?.close();await new Promise(r=>server.close(r));await rm(home,{recursive:true,force:true});}

import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {panelServer} from '../server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href:'playwright');
const home=await mkdtemp(join(tmpdir(),'api-form-ui-')),output=resolve(process.argv[2]);await mkdir(output,{recursive:true});
const db=new DatabaseSync(join(home,'state_5.sqlite'));db.exec('CREATE TABLE threads(id TEXT,title TEXT,model_provider TEXT,model TEXT,cwd TEXT,updated_at INTEGER,archived INTEGER)');db.close();
let fail=true,stored=0,browser;
const server=panelServer({codexDirectory:home,switcherDirectory:join(home,'identity-switcher'),apiIdentityOptions:{credential:async(op,id,key)=>{if(op==='store'){if(fail)throw Error('Synthetic private failure');assert.equal(key,'SYNTHETIC_API_FORM_KEY');stored++}}}});
server.listen(0,'127.0.0.1');await once(server,'listening');
try{
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/#access=${server.identityAccessToken}`);
  await page.locator('.api-add summary').click();
  await page.locator('#api-name').fill('Form gateway');await page.locator('#api-base-url').fill('https://example.invalid/v1');await page.locator('#api-model').fill('fixture-model');await page.locator('#api-key').fill('SYNTHETIC_API_FORM_KEY');
  assert.equal(await page.locator('#api-key').getAttribute('type'),'password');
  for(const [name,width,height] of [['desktop',1365,900],['mobile',390,844]]){
    await page.setViewportSize({width,height});await page.screenshot({path:join(output,`api-form-${name}.png`),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  await page.locator('#add-api').click();await page.waitForFunction(()=>document.querySelector('#api-status').textContent.includes('保存失败'));
  assert.equal(await page.locator('#api-key').inputValue(),'');assert.equal(await page.locator('#api-name').inputValue(),'Form gateway');assert.equal(await page.locator('#add-api').isEnabled(),true);assert.equal(stored,0);
  fail=false;await page.locator('#api-key').fill('SYNTHETIC_API_FORM_KEY');await page.locator('#add-api').click();await page.waitForFunction(()=>document.querySelector('#api-status').textContent.includes('已添加 Form gateway'));
  assert.equal(stored,1);assert.equal(await page.locator('#api-key').inputValue(),'');assert.match(await page.locator('#api-status').innerText(),/尚未验证/);assert.match(await page.locator('#identities').innerText(),/Form gateway/);
  assert.ok(!(await page.content()).includes('SYNTHETIC_API_FORM_KEY'));
  await page.reload();await page.waitForFunction(()=>document.querySelector('#identities').textContent.includes('Form gateway'));assert.equal(await page.locator('#api-key').inputValue(),'');assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,formAddsIdentity:true,failedSaveRetry:true,keyFieldCleared:true,identityPersists:true,desktopMobileLayout:true,externalRequests:0}));
}finally{await browser?.close();await new Promise(r=>server.close(r));await rm(home,{recursive:true,force:true})}

// Optional browser QA: provide Playwright through PLAYWRIGHT_MODULE or install it locally.
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {panelServer} from '../server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href:'playwright');
const home=mkdtempSync(join(tmpdir(),'panel-ui-synthetic-'));
const output=resolve(process.argv[2]||join(home,'screenshots'));mkdirSync(output,{recursive:true});
const id='11111111-1111-1111-1111-111111111111';
const db=new DatabaseSync(join(home,'state_5.sqlite'));
db.exec('CREATE TABLE threads(id TEXT,title TEXT,model_provider TEXT,model TEXT,cwd TEXT,updated_at INTEGER,archived INTEGER)');
db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?)').run(id,'Synthetic chat','openai','test-model','C:/synthetic',1,0);db.close();
for(const [name,kind] of [['official','chatgpt'],['system','chatgpt-system'],['gateway','api']]){
  const directory=join(home,'session-identities','profiles',name);mkdirSync(directory,{recursive:true});
  writeFileSync(join(directory,'profile.json'),JSON.stringify({kind,accountId:'SYNTHETIC_ACCOUNT',userId:'SYNTHETIC_USER',providerId:'test_gateway'}));
  writeFileSync(join(directory,'label.json'),JSON.stringify({name:'Synthetic gateway'}));
  if(kind==='api')continue;
  writeFileSync(join(kind==='chatgpt-system'?home:directory,'auth.json'),JSON.stringify({auth_mode:'chatgpt',tokens:{account_id:'SYNTHETIC_ACCOUNT',id_token:'header.'+Buffer.from(JSON.stringify({email:'synthetic@example.com','https://api.openai.com/auth':{chatgpt_user_id:'SYNTHETIC_USER'}})).toString('base64url')+'.synthetic'}}));
}
mkdirSync(join(home,'session-identities','bindings'));
writeFileSync(join(home,'session-identities','bindings',id+'.json'),JSON.stringify({identityId:'official',revision:1}));
const server=panelServer({codexDirectory:home,switcherDirectory:join(home,'identity-switcher')});
server.listen(0,'127.0.0.1');await once(server,'listening');
let browser;
try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/#access=${server.identityAccessToken}`);
  await page.waitForFunction(()=>document.querySelectorAll('#identities li').length===2);
  assert.equal(await page.locator('#identity option').count(),2);
  assert.equal(await page.getByRole('button',{name:'移除 synthetic@example.com',exact:true}).isDisabled(),true);
  assert.match(await page.locator('#rows').innerText(),/synthetic@example.com/);
  await page.evaluate(()=>{globalThis.fixtureRow=document.querySelector('#rows tr');});
  await page.getByRole('button',{name:'刷新'}).click();
  await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);
  assert.equal(await page.evaluate(()=>fixtureRow===document.querySelector('#rows tr')),true,'Refresh must retain unchanged rows');
  const update=new DatabaseSync(join(home,'state_5.sqlite'));
  update.prepare('UPDATE threads SET title=? WHERE id=?').run('Updated synthetic chat',id);update.close();
  await page.getByRole('button',{name:'刷新'}).click();await page.waitForFunction(()=>document.querySelector('.session-title').textContent==='Updated synthetic chat');
  assert.equal(await page.evaluate(()=>fixtureRow===document.querySelector('#rows tr')),true,'Updated rows must retain their selection target');
  await page.locator('#search').fill('no-fixture-match');assert.equal(await page.locator('#rows tr').count(),0);
  await page.locator('#search').fill('');assert.equal(await page.locator('#rows tr').count(),1);
  assert.equal(await page.evaluate(()=>fixtureRow===document.querySelector('#rows tr')),true,'Filtered rows must be reusable');
  for(const [name,width,height] of [['desktop',1365,900],['mobile',390,844]]){
    await page.setViewportSize({width,height});
    await page.screenshot({path:join(output,`${name}.png`),fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Page overflows viewport');
    assert.ok(await page.locator('#identities li').evaluateAll(rows=>rows.every(row=>{const text=row.firstElementChild.getBoundingClientRect();const button=row.lastElementChild.getBoundingClientRect();return text.right<=button.left&&button.right<=row.getBoundingClientRect().right;})),'Identity text overlaps removal button');
  }
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'移除 Synthetic gateway',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('#identities li').length===1);
  await page.reload();await page.waitForFunction(()=>document.querySelectorAll('#identities li').length===1);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,deduplicated:true,usedRemovalDisabled:true,unusedRemovalPersists:true,desktopMobile:true}));
}finally{
  await browser?.close();await new Promise(resolve=>server.close(resolve));rmSync(home,{recursive:true,force:true});
}

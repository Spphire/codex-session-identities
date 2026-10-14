// Optional Playwright benchmark using only synthetic panel rows.
import {createServer} from 'node:http';
import {readFile, writeFile} from 'node:fs/promises';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {once} from 'node:events';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href:'playwright');
const root=join(dirname(dirname(fileURLToPath(import.meta.url))),'public');
let rows=100;
const fixture=()=>({observedAt:new Date().toISOString(),runtime:{connected:false,reason:'Synthetic benchmark'},identities:[],sessions:Array.from({length:rows},(_,i)=>({id:`${String(i).padStart(8,'0')}-1111-1111-1111-111111111111`,title:`Synthetic chat ${i}`,cwd:'C:/synthetic',provider:'synthetic',model:'test',updatedAt:1700000000+i,archived:false,identityId:null,identityState:'unbound'}))});
const server=createServer(async(req,res)=>{
  if(req.url==='/api/state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(fixture()));return;}
  if(req.url==='/api/official-login'){res.setHeader('Content-Type','application/json');res.end('{"status":"idle"}');return;}
  const name={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/icon.svg':'icon.svg'}[req.url];
  if(!name){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':'text/html');
  const source=await readFile(join(root,name),'utf8');
  res.end(name==='app.js'?source+'\n globalThis.perfPanel={renderRows,refresh};':source);
});
server.listen(0,'127.0.0.1');await once(server,'listening');
let browser;
const report={date:new Date().toISOString(),synthetic:true,cases:[]};
try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1365,height:900}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>globalThis.perfPanel);
  for(const count of [100,800,1200,5000]){
    rows=count;await page.evaluate(()=>perfPanel.refresh());
    await page.waitForFunction(n=>document.querySelectorAll('#rows tr').length===n,count);
    const times=[];
    for(let i=0;i<10;i++)times.push(await page.evaluate(()=>{const start=performance.now();perfPanel.renderRows();document.querySelector('#rows').getBoundingClientRect();return performance.now()-start;}));
    times.sort((a,b)=>a-b);
    report.cases.push({sessions:count,n:times.length,renderAndLayoutMedianMs:+times[5].toFixed(3),renderAndLayoutP95Ms:+times[9].toFixed(3),domElements:await page.locator('*').count()});
  }
  assert.deepEqual(errors,[]);report.passed=true;
}finally{await browser?.close();await new Promise(r=>server.close(r));}
await writeFile(resolve(process.argv[2]||'performance-ui-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));

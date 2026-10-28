import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {protocolProbe} from '../compatibility-probe.mjs';

const fixture=`import {createInterface} from 'node:readline';
const mode=process.argv[2];
if(process.env.IDENTITY_PROBE_TEST_SECRET||process.env.OPENAI_API_KEY)process.exit(9);
if(process.env.CODEX_HOME!==process.cwd()||process.env.CODEX_SQLITE_HOME!==process.cwd())process.exit(10);
let counter=0;
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(m.id==null)return;
 if(mode==='exit'){process.exit(8);return}
 if(mode==='missing-identity'&&m.method==='thread/identity/read'){console.log(JSON.stringify({id:m.id,error:{code:-32601,message:'unknown method'}}));return}
 let result={};
 if(m.method==='initialize')result={userAgent:'probe'};
 if(m.method==='thread/list')result=mode==='bad-list'?{}:{data:[]};
 if(m.method==='thread/start')result={thread:{id:'test-'+(++counter),ephemeral:mode!=='durable-temporary'}};
 if(m.method==='thread/identity/read')result={identityId:mode==='wrong-identity'?'unexpected':null};
 console.log(JSON.stringify({id:m.id,result}));
});`;

for(const [mode,message] of [['ok',null],['missing-identity',/unknown method/],['bad-list',/unsupported shape/],['durable-temporary',/temporary thread semantics/],['wrong-identity',/unexpectedly loaded an identity/],['exit',/exited before/]]){
 test(`compatibility probe: ${mode}`,async()=>{
   const directory=await mkdtemp(join(tmpdir(),'identity-probe-test-'));
   const script=join(directory,'backend.mjs');await writeFile(script,fixture);
   const previous=process.env.IDENTITY_PROBE_TEST_SECRET;process.env.IDENTITY_PROBE_TEST_SECRET='synthetic-do-not-inherit';
   try{
     const probe=protocolProbe(process.execPath,directory,'1.2.3',[script,mode]);
     if(message)await assert.rejects(probe,message);
     else{const result=await probe;assert.equal(result.passed,true);assert.equal(result.inferenceRequests,0);assert.ok(result.checks.includes('identity-interface'))}
   }finally{
     if(previous===undefined)delete process.env.IDENTITY_PROBE_TEST_SECRET;else process.env.IDENTITY_PROBE_TEST_SECRET=previous;
     assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep+'identity-probe-test-'));
     await rm(directory,{recursive:true,force:true});
   }
 });
}

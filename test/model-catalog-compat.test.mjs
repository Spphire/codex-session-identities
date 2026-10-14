import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,copyFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {StdioClient} from '../stdio-client.mjs';
const {mergePage,validParams,InstalledModelCatalog}=createRequire(import.meta.url)('../model-catalog-compat.cjs');
const native={data:[{id:'shared',model:'shared',displayName:'Current name',isDefault:true,hidden:false},{id:'hidden',model:'hidden',hidden:true}],nextCursor:null};
const installed=[{id:'new',model:'new',displayName:'Installed alias',isDefault:true,hidden:false},{id:'shared',model:'shared',displayName:'Old name'},{id:'old-hidden',model:'old-hidden',hidden:true}];

test('catalog preserves native metadata and default while restoring installed aliases',()=>{
  const result=mergePage(native,installed,{}).result;
  assert.deepEqual(result.data.map(x=>x.model),['new','shared']);
  assert.equal(result.data[1].displayName,'Current name');
  assert.equal(result.data[0].isDefault,false);
  assert.equal(result.data.filter(x=>x.isDefault).length,1);
});
test('merged catalog paginates after visibility filtering without duplicate entries',()=>{
  assert.deepEqual(mergePage(native,installed,{limit:1}).result.data.map(x=>x.model),['new']);
  assert.equal(mergePage(native,installed,{limit:1}).result.nextCursor,'1');
  assert.deepEqual(mergePage(native,installed,{limit:1,cursor:'1'}).result.data.map(x=>x.model),['shared']);
  assert.equal(mergePage(native,installed,{limit:1,cursor:'1'}).result.nextCursor,null);
  assert.equal(mergePage(native,installed,{includeHidden:true}).result.data.length,4);
  assert.deepEqual(mergePage(native,installed,{cursor:'2'}).result.data,[]);
  assert.ok(mergePage(native,installed,{cursor:'3'}).error);
  assert.equal(mergePage({...native,nextCursor:'2'},installed,{}),null);
});
test('malformed pagination and visibility parameters remain subject to native validation',()=>{
  for(const value of [{limit:-1},{limit:1.2},{limit:2**32},{cursor:'-1'},{cursor:'wrong'},{includeHidden:'false'},[]])assert.equal(validParams(value),false);
  for(const value of [null,{}, {limit:0,cursor:'0',includeHidden:false}])assert.equal(validParams(value),true);
});

test('ready catalog does not wait for helper teardown; refresh remains serialized and invalidated',async t=>{
  const home=await mkdtemp(join(tmpdir(),'identity-catalog-cleanup-'));
  const script=`require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const v=JSON.parse(line);if(v.id!=null)process.stdout.write(JSON.stringify({id:v.id,result:v.method==='model/list'?{data:[{model:'fixture'}],nextCursor:null}:{}})+'\\n');}).on('close',()=>setTimeout(()=>process.exit(0),1500));`;
  const catalog=new InstalledModelCatalog(process.execPath,['-e',script],home);
  t.after(async()=>{catalog.close();await catalog.cleanup;await rm(home,{recursive:true,force:true});});
  assert.deepEqual(await catalog.get(),[{model:'fixture'}]);
  const first=catalog.client;assert.ok(first);assert.equal(first.child.exitCode,null);
  assert.deepEqual(await catalog.get(),[{model:'fixture'}]);assert.equal(catalog.client,first);
  await writeFile(join(home,'config.toml'),'# changed configuration\n');
  const refreshing=catalog.get();await catalog.cleanup;
  assert.notEqual(first.child.exitCode,null);
  assert.deepEqual(await refreshing,[{model:'fixture'}]);assert.notEqual(catalog.client,first);
});

for(const mode of ['available','unavailable','native-denied'])test(`bridge catalog compatibility: ${mode}`,async t=>{
  const available=mode!=='unavailable';
  const directory=await mkdtemp(join(tmpdir(),'identity-catalog-'));
  const config={originalCodexExe:process.execPath,appServerExe:process.execPath};
  for(const name of ['runtime-bridge.cjs','model-catalog-compat.cjs','client-version-compat.cjs','stdio-client.mjs'])await copyFile(resolve(name),join(directory,name));
  await writeFile(join(directory,'runtime-config.json'),JSON.stringify(config));
  const responder=(data)=>`require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const v=JSON.parse(line);if(v.id==null)return;const reply=v.method==='model/list'?${JSON.stringify(data)}:{};process.stdout.write(JSON.stringify({id:v.id,result:reply})+'\\n');});`;
  await writeFile(join(directory,'app-server'),available?responder({data:installed,nextCursor:null}):'process.exit(1);');
  const nativeScript=mode==='native-denied'?responder(native).replace('result:reply',"...(v.method==='model/list'?{error:{code:-32600,message:'Provider denied'}}:{result:reply})"):responder(native);
  const client=new StdioClient(process.execPath,[join(directory,'runtime-bridge.cjs'),'app-server','-e',nativeScript],{cwd:directory,env:{...process.env,CODEX_HOME:directory}});
  t.after(async()=>{await client.close();await rm(directory,{recursive:true,force:true});});
  await client.initialize();
  if(mode==='native-denied'){await assert.rejects(client.call('model/list',{}),/Provider denied/);return;}
  const page=await client.call('model/list',{limit:1});
  if(available){
    assert.deepEqual(page.data.map(x=>x.model),['new']);assert.equal(page.nextCursor,'1');
    const next=await client.call('model/list',{cursor:page.nextCursor,limit:1});assert.deepEqual(next.data.map(x=>x.model),['shared']);
    assert.equal(next.nextCursor,null);
  }else assert.deepEqual(page,native);
});

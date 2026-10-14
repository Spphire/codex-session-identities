// Read-only opt-in: no inference, refresh-token writes or global account switching.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {readCatalog} from '../catalog.mjs';
import {OfficialUsage} from '../official-usage.mjs';
const installation=process.argv[2];
if(!installation)throw new Error('Pass the installation directory');
const config=JSON.parse(await readFile(join(installation,'runtime-config.json'),'utf8'));
const identities=readCatalog(config.codexHome,join(config.codexHome,'identity-switcher')).identities.filter(x=>x.kind==='chatgpt'&&x.available&&!x.removed);
const paths=new Set([join(config.codexHome,'auth.json'),...identities.flatMap(x=>x.runtimeIds.map(id=>join(config.codexHome,'session-identities','profiles',id,'auth.json')))]);
const hashes=new Map();const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const path of paths){try{hashes.set(path,hash(await readFile(path)));}catch(error){if(error.code!=='ENOENT')throw error;}}
const service=new OfficialUsage(config.codexHome);
try{
  let state;
  for(const deadline=Date.now()+18000;Date.now()<deadline;){
    state=service.snapshot(identities);
    if(Object.values(state).every(x=>!x.loading))break;
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  const results=identities.map((identity,index)=>({account:index+1,profileAliases:identity.runtimeIds.length,...state[identity.id]}));
  for(const [path,before] of hashes)assert.equal(hash(await readFile(path)),before,'Auth file changed');
  console.log(JSON.stringify({accounts:results,authUnchanged:true}));
  assert.ok(results.length>0);assert.ok(results.every(x=>x.status==='ready'),'Some official accounts did not return usage');
}finally{service.close();}

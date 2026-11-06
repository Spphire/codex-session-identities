import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const [upstream,output]=process.argv.slice(2).map(value=>resolve(value));
if(!upstream||!output)throw new Error('Pass upstream repository and new output directory');
const patches=fileURLToPath(new URL('../patches/',import.meta.url));
const manifest=JSON.parse(await readFile(join(patches,'manifest.json'),'utf8'));
const git=(cwd,args)=>spawnSync('git',['-C',cwd,...args],{windowsHide:true});
assert.equal(git(upstream,['rev-parse','HEAD']).stdout.toString().trim(),manifest.baseCommit);
const fixture=join(output,'replay');await mkdir(fixture,{recursive:true});
const paths=new Set();
for(const name of manifest.patches){
  const patch=await readFile(join(patches,name),'utf8');
  for(const match of patch.matchAll(/^diff --git a\/(\S+) b\/\1$/gm)){
    const path=match[1];assert.ok(!path.startsWith('/')&&!path.split('/').includes('..'));paths.add(path);
  }
}
for(const path of paths){
  const source=git(upstream,['show',manifest.baseCommit+':'+path]);
  if(source.status!==0)continue; // Files introduced by the overlay are absent at base.
  await mkdir(dirname(join(fixture,path)),{recursive:true});await writeFile(join(fixture,path),source.stdout);
}
assert.equal(git(fixture,['init','--quiet']).status,0);
for(const name of manifest.patches){
  const result=git(fixture,['apply',join(patches,name)]);
  assert.equal(result.status,0,name+': '+result.stderr.toString());
}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const compared=[];
for(const path of paths){
  const replay=await readFile(join(fixture,path)),current=await readFile(join(upstream,path));
  // Existing Windows checkout line endings need not match Git blob endings.
  const normalized=bytes=>Buffer.from(bytes.toString('utf8').replaceAll('\r\n','\n'));
  assert.equal(hash(normalized(replay)),hash(normalized(current)),`${path}: current upstream differs from replay`);
  compared.push({path,sha256:hash(normalized(replay))});
}
const report={passed:true,baseCommit:manifest.baseCommit,patches:manifest.patches.length,files:compared,productionModified:false};
await writeFile(join(output,'result.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,files:compared.length}));

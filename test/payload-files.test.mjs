import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';

test('release and small-update inventories include the entire panel and bridge dependency closure',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../payload-files.json',import.meta.url),'utf8'));
  const entries=new Map(manifest.files.map(x=>[x.path,x]));
  assert.equal(entries.size,manifest.files.length);
  for(const name of await readdir(new URL('../',import.meta.url))){
    if(!/\.(?:mjs|cjs)$/.test(name))continue;
    assert.ok(entries.has(name),`${name} is shipped`);
    assert.equal(entries.get(name).panelUpdate,true,`${name} is updated with its callers`);
    const source=await readFile(new URL('../'+name,import.meta.url),'utf8');
    for(const match of source.matchAll(/(?:from\s*|require\(|import\()['"]\.\/([^'"]+)['"]/g)){
      assert.ok(entries.has(match[1]),`${name} dependency ${match[1]} is shipped`);
    }
  }
  for(const entry of manifest.files){
    assert.match(entry.path,/^(?:public\/)?[A-Za-z0-9_-][A-Za-z0-9_.-]*$/);
    assert.equal(typeof entry.panelUpdate,'boolean');
  }
  for(const name of ['bindings.mjs','browser-health.mjs','panel-http.mjs','payload-files.ps1','payload-files.json'])assert.equal(entries.get(name)?.panelUpdate,true);
  for(const name of ['codex-session-desktop.exe','codex-identity.exe'])assert.equal(entries.get(name)?.panelUpdate,false);
});

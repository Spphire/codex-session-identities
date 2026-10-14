import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {initializeResult}=createRequire(import.meta.url)('../client-version-compat.cjs');
test('Desktop sees installed capabilities while source metadata and client suffix stay intact',()=>{
  const value={userAgent:'Codex Desktop/0.0.0 (Windows; desktop; 26.1007.2314.0)',codexHome:'synthetic'};
  const result=initializeResult(value,'0.162.0-alpha.17.2');
  assert.equal(result.userAgent,'Codex Desktop/0.162.0-alpha.17.2 (Windows; desktop; 26.1007.2314.0)');
  assert.equal(value.userAgent,'Codex Desktop/0.0.0 (Windows; desktop; 26.1007.2314.0)');
  assert.equal(result.codexHome,value.codexHome);
  assert.equal(initializeResult({userAgent:'codex_desktop/0.0.0 (Windows)'},'0.162.0').userAgent,'codex_desktop/0.162.0 (Windows)');
  for(const invalid of [undefined,'0.0.0','invalid','1.2.3\n'])assert.deepEqual(initializeResult(value,invalid),value);
  const released={userAgent:'Codex Desktop/0.170.0 (client; 0.0.0)'};
  assert.deepEqual(initializeResult(released,'0.162.0'),released);
});

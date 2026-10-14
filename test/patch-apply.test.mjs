import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync} from 'node:fs';
import {execFileSync, spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
function fixture(t,broken=false){
  const home=mkdtempSync(join(tmpdir(),'identity patch '));const repo=join(home,'source');const patches=join(home,'patches');mkdirSync(repo);mkdirSync(patches);
  const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',windowsHide:true});
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('config','core.autocrlf','false');
  writeFileSync(join(repo,'file.txt'),'base\n');writeFileSync(join(repo,'other.txt'),'original\n');git('add','.');git('commit','-qm','fixture');
  const base=git('rev-parse','HEAD').trim();
  copyFileSync(resolve('patches/apply.ps1'),join(patches,'apply.ps1'));
  writeFileSync(join(patches,'manifest.json'),JSON.stringify({baseCommit:base,patches:['one.patch','two.patch']}));
  const patch=(before,after)=>`diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-${before}\n+${after}\n`;
  writeFileSync(join(patches,'one.patch'),patch('base','middle'));
  writeFileSync(join(patches,'two.patch'),patch(broken?'wrong':'middle','final \u4e2d\u6587'));
  writeFileSync(join(repo,'other.txt'),'user staged change\n');git('add','other.txt');
  const indexHash=()=>createHash('sha256').update(readFileSync(join(repo,'.git/index'))).digest('hex');
  const run=(...args)=>spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(patches,'apply.ps1'),'-Repository',repo,...args],{encoding:'utf8',windowsHide:true});
  t.after(()=>rmSync(home,{recursive:true,force:true}));return {repo,git,run,indexHash};
}
test('overlapping patch preflight/application is atomic, preserves the index and is repeatable',{skip:process.platform!=='win32'},t=>{
  const f=fixture(t);const hash=f.indexHash();const preflight=f.run('-CheckOnly');assert.equal(preflight.status,0,preflight.stderr);
  assert.equal(readFileSync(join(f.repo,'file.txt'),'utf8'),'base\n');assert.equal(f.indexHash(),hash);
  const applied=f.run();assert.equal(applied.status,0,applied.stderr);
  assert.equal(readFileSync(join(f.repo,'file.txt'),'utf8'),'final \u4e2d\u6587\n');assert.equal(f.indexHash(),hash);
  assert.equal(readFileSync(join(f.repo,'other.txt'),'utf8'),'user staged change\n');
  const repeat=f.run();assert.equal(repeat.status,0,repeat.stderr);assert.match(repeat.stdout,/already present/);assert.equal(f.indexHash(),hash);
});
test('a later patch failure leaves the whole checkout and real index untouched',{skip:process.platform!=='win32'},t=>{
  const f=fixture(t,true);const hash=f.indexHash();assert.notEqual(f.run().status,0);
  assert.equal(readFileSync(join(f.repo,'file.txt'),'utf8'),'base\n');assert.equal(f.indexHash(),hash);
});

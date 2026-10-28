import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

test('disconnected runtime status survives Windows PowerShell legacy code-page decoding',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'identity-status-encoding-'));
 const script=fileURLToPath(new URL('../runtime-status.mjs',import.meta.url));
 try{
   const result=spawnSync(process.execPath,[script,directory],{encoding:'utf8',windowsHide:true,timeout:10000});
   assert.equal(result.status,0,result.stderr);
   assert.match(result.stdout,/^[\x00-\x7f]+$/);
   const parsed=JSON.parse(result.stdout);
   assert.equal(parsed.connected,false);assert.equal(parsed.pid,null);assert.match(parsed.reason,/[\u4e00-\u9fff]/);
   if(process.platform==='win32'){
     const quote=s=>"'"+s.replaceAll("'","''")+"'";
     const expected=Buffer.from(parsed.reason).toString('base64');
     const command=`[Console]::OutputEncoding=[Text.Encoding]::GetEncoding(936); $ErrorActionPreference='Stop'; $r=& ${quote(process.execPath)} ${quote(script)} ${quote(directory)} | ConvertFrom-Json; $expected=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${expected}')); if($r.connected -or $r.reason -ne $expected){throw 'Unicode status mismatch'}; [Console]::WriteLine('passed')`;
     const powershell=join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
     const legacy=spawnSync(powershell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:10000});
     assert.equal(legacy.status,0,legacy.stderr);assert.match(legacy.stdout,/passed/);
   }
 }finally{assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep+'identity-status-encoding-'));await rm(directory,{recursive:true,force:true})}
});

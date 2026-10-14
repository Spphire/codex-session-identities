import test from 'node:test';
import assert from 'node:assert/strict';
import {StdioClient} from '../stdio-client.mjs';
test('closing RPC releases pipes retained by a descendant after the server exits',async t=>{
  const script=`const {spawn}=require('node:child_process');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const v=JSON.parse(line);if(v.id!=null)process.stdout.write(JSON.stringify({id:v.id,result:{}})+'\\n');}).on('close',()=>{spawn(process.execPath,['-e','setTimeout(()=>{},3000)'],{stdio:['ignore','inherit','inherit'],windowsHide:true});process.exit(0);});`;
  const client=new StdioClient(process.execPath,['-e',script]);t.after(()=>client.close());
  await client.initialize();await client.close();
  assert.ok(client.child.stdout.destroyed,'Descendant-owned stdout must not retain the RPC reader');
  assert.ok(client.child.stdin.destroyed);
});

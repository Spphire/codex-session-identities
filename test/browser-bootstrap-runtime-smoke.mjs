import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {StdioClient} from '../stdio-client.mjs';
const runtime=process.argv[2];
const home=await mkdtemp(join(tmpdir(),'browser-bootstrap-'));
const env={...process.env,HOME:home,USERPROFILE:home,CODEX_HOME:home,CUA_REPL_NODE_REPL_PATH:join(runtime,'bin','node_repl.exe'),CUA_REPL_ENABLED_SURFACES:'browser',CUA_REPL_BROWSER_ENV:'codex-app',NODE_REPL_NODE_PATH:join(runtime,'bin','node.exe'),NODE_REPL_NODE_MODULE_DIRS:join(runtime,'bin','node_modules'),NODE_REPL_TRUSTED_CODE_PATHS:runtime,BROWSER_USE_AVAILABLE_BACKENDS:'iab'};
for(const key of ['CODEX_CLI_PATH','NODE_REPL_JS_BANNER','NODE_REPL_TOOL_OVERRIDES','NODE_REPL_TRUSTED_SERVICES','BROWSER_USE_ACCESS_PIPE_PATH','BROWSER_USE_ACCESS_EXECUTOR_ID','BROWSER_USE_ACCESS_VERIFYING_IDENTITY'])delete env[key];
const rpc=new StdioClient(join(runtime,'bin','node.exe'),[join(runtime,'bin','node_modules','@oai','cua-repl','bin','cua-repl.mjs')],{env,cwd:home});
const write=rpc.child.stdin.write.bind(rpc.child.stdin);
rpc.child.stdin.write=(data,...args)=>write(JSON.stringify({jsonrpc:'2.0',...JSON.parse(data)})+'\n',...args);
try{
  await rpc.call('initialize',{protocolVersion:'2024-11-05',clientInfo:{name:'isolated-browser-bootstrap',version:'1'},capabilities:{}},15000);
  rpc.child.stdin.write(JSON.stringify({method:'notifications/initialized'})+'\n');
  const catalog=await rpc.call('tools/list',{},15000);const js=catalog.tools.find(t=>t.name==='js');
  assert.ok(js);assert.match(js.description,/cua\.getTab/);assert.match(js.description,/iab/);
  const result=await rpc.call('tools/call',{name:'js',arguments:{code:'nodeRepl.write({bootstrap:typeof cua, getTab:typeof cua.getTab});',title:'Validate isolated browser initialization'}},30000);
  assert.equal(result.isError??false,false,JSON.stringify(result.content).slice(-2000));
  const text=JSON.stringify(result.content);assert.match(text,/bootstrap/);assert.match(text,/object/);assert.match(text,/function/);
  console.log(JSON.stringify({passed:true,browserInstructions:true,initializedCua:true,realAccountUsed:false,modelRequests:0,browserPagesRead:0}));
}finally{await rpc.close();await rm(home,{recursive:true,force:true});}

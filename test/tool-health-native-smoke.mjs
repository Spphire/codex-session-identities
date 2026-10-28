import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {StdioClient} from '../stdio-client.mjs';
import {BridgeClient} from '../bridge-client.mjs';
import {ToolHealth} from '../tool-health.mjs';
const base=process.cwd();const installation=process.argv[2];
const configuration=JSON.parse(await readFile(join(installation,'runtime-config.json'),'utf8'));
const root=await mkdtemp(join(base,'native-tools-'));const home=join(root,'home');await mkdir(home);
for(const name of ['runtime-bridge.cjs','model-catalog-compat.cjs','client-version-compat.cjs','feature-config-compat.cjs'])await copyFile(join(base,name),join(root,name));
await writeFile(join(root,'runtime-config.json'),JSON.stringify({appServerExe:configuration.appServerExe}));
const marker=join(home,'marker');await writeFile(marker,'before');
const mcp=join(home,'fixture.cjs');
await writeFile(mcp,`const fs=require('node:fs');require('node:readline').createInterface({input:process.stdin}).on('line',s=>{const v=JSON.parse(s);if(v.id==null)return;let result={};if(v.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'isolated-tools',version:'1'}};if(v.method==='tools/list')result={tools:[{name:fs.readFileSync(${JSON.stringify(marker)},'utf8'),description:'Local fixture',inputSchema:{type:'object',properties:{}}}]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:v.id,result})+'\\n');});`);
const requests=[];const server=createServer(async(req,res)=>{let data='';for await(const chunk of req)data+=chunk;requests.push(JSON.parse(data));const rid='resp_'+requests.length;const item={id:'msg_'+requests.length,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'OK'}]};const events=[{type:'response.created',response:{id:rid,status:'in_progress'}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id:rid,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}];res.writeHead(200,{'content-type':'text/event-stream'});res.end(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));});server.listen(0,'127.0.0.1');await once(server,'listening');
await writeFile(join(home,'config.toml'),`model="gpt-5.1-codex"\nmodel_provider="fixture"\n[model_providers.fixture]\nname="Local fixture"\nbase_url="http://127.0.0.1:${server.address().port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\nsupports_websockets=false\n[mcp_servers.fixture]\ncommand=${JSON.stringify(process.execPath)}\nargs=[${JSON.stringify(mcp)}]\n`);
const env={...process.env,CODEX_HOME:home,CODEX_SQLITE_HOME:home,NO_PROXY:'127.0.0.1,localhost'};for(const key of Object.keys(env))if(/TOKEN|API_KEY|PASSWORD|SECRET/.test(key))delete env[key];
const rpc=new StdioClient(process.execPath,[join(root,'runtime-bridge.cjs'),'app-server','--analytics-default-enabled'],{env,cwd:home});const bridge=new BridgeClient(home);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let result;
try{
 await rpc.initialize('isolated_tool_health_validation');
 const {thread}=await rpc.call('thread/start',{cwd:home,approvalPolicy:'never',sandbox:'read-only',model:'gpt-5.1-codex'});
 const health=new ToolHealth(bridge);let report;
 for(let i=0;i<20;i++){report=await health.diagnose(thread.id);if(report.status==='observed'&&report.servers[0]?.toolCount===1)break;await sleep(300);}
 assert.equal(report.status,'observed');assert.equal(report.servers.find(s=>s.name==='fixture')?.toolCount,1);
 async function turn(){const {turn}=await rpc.call('turn/start',{threadId:thread.id,input:[{type:'text',text:'Reply OK; local test fixture.'}]});for(let i=0;i<300;i++){const done=rpc.events.find(e=>e.method==='turn/completed'&&e.params?.turn?.id===turn.id);if(done){assert.equal(done.params.turn.status,'completed',JSON.stringify(done.params.turn.error));return;}await sleep(100);}throw Error('turn timeout');}
 await turn();await writeFile(join(base,'fixture-request-tools.json'),JSON.stringify(requests.at(-1).tools,null,2));assert.ok(requests.at(-1).tools.find(t=>t.type==='namespace'&&t.name==='mcp__fixture')?.tools.some(t=>t.name==='before'),'first turn contains fixture tool');
 await writeFile(marker,'after');
 const configPath=join(home,'config.toml');const text=await readFile(configPath,'utf8');await writeFile(configPath,text.replace('args=['+JSON.stringify(mcp)+']','args=['+JSON.stringify(mcp)+',"configuration-v2"]'));
 report=await health.diagnose(thread.id);
 const recovery=await health.recover({threadId:thread.id,confirmation:report.confirmation,scope:'all-loaded-threads'});assert.equal(recovery.status,'queued');
 await turn();assert.ok(requests.at(-1).tools.find(t=>t.type==='namespace'&&t.name==='mcp__fixture')?.tools.some(t=>t.name==='after'),'next turn contains refreshed tool');
 assert.ok(!requests.at(-1).tools.find(t=>t.type==='namespace'&&t.name==='mcp__fixture')?.tools.some(t=>t.name==='before'));
 result={passed:true,scope:'isolated-native-backend-through-identity-bridge',perThreadCatalogRead:true,globalReloadQueued:true,changedConfigurationNextTurnToolsVerified:true,modelRequests:requests.length,externalModelRequests:0,realAccountUsed:false};
}catch(error){result={passed:false,error:error.message};process.exitCode=1;}
finally{bridge.close();await rpc.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
await writeFile(join(base,'native-tool-health-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));

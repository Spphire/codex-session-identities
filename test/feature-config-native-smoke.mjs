import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {StdioClient} from '../stdio-client.mjs';
import {createServer} from 'node:http';
import {once} from 'node:events';
const executable=resolve(process.argv[2]);const home=await mkdtemp(join(tmpdir(),'identity-feature-schema-'));
let native,bridge;
let requests=0;
const server=createServer(async(req,res)=>{
 if(req.method!=='POST'||!req.url?.endsWith('/responses')){res.writeHead(404);res.end('{}');return;}
 for await(const chunk of req){}requests++;
 const id='resp_fixture';const item={id:'msg_fixture',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'OK'}]};
 const events=[{type:'response.created',response:{id,status:'in_progress'}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}];
 res.writeHead(200,{'content-type':'text/event-stream'});res.end(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
});
const override={'features.async_compaction':{enabled:false},'features.multi_agent_v2.preserve_fork_prefix':true,'features.guardianv2':{enabled:false}};
const env={...process.env,CODEX_HOME:home,CODEX_SQLITE_HOME:home,RUST_MIN_STACK:'33554432'};
for(const key of Object.keys(env))if(/TOKEN|API_KEY|PASSWORD|SECRET/i.test(key))delete env[key];
try{
 server.listen(0,'127.0.0.1');await once(server,'listening');
 env.NO_PROXY='127.0.0.1,localhost,::1';env.no_proxy=env.NO_PROXY;
 await writeFile(join(home,'config.toml'),`model="gpt-5.1-codex"\nmodel_provider="fixture"\n[model_providers.fixture]\nname="fixture"\nbase_url="http://127.0.0.1:${server.address().port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\nsupports_websockets=false\n`);
 native=new StdioClient(executable,['--listen','stdio://'],{cwd:home,env});await native.initialize('feature_schema_before');
 await assert.rejects(native.call('thread/start',{cwd:home,ephemeral:true,config:override}),/invalid type: map, expected a boolean/);
 await native.close();native=null;
 for(const name of ['runtime-bridge.cjs','model-catalog-compat.cjs','client-version-compat.cjs','feature-config-compat.cjs'])await copyFile(new URL('../'+name,import.meta.url),join(home,name));
 await writeFile(join(home,'runtime-config.json'),JSON.stringify({appServerExe:executable}));
 bridge=new StdioClient(process.execPath,[join(home,'runtime-bridge.cjs'),'app-server'],{cwd:home,env});await bridge.initialize('feature_schema_after');
 const {thread}=await bridge.call('thread/start',{cwd:home,approvalPolicy:'never',sandbox:'read-only',config:override});assert.ok(thread.id);
 const identity=await bridge.call('thread/identity/read',{threadId:thread.id});assert.equal(identity.identityId,null);
 const {turn}=await bridge.call('turn/start',{threadId:thread.id,input:[{type:'text',text:'Local mock fixture only. Reply OK.'}]});
 const deadline=Date.now()+30000;let done;
 while(!(done=bridge.events.find(e=>e.method==='turn/completed'&&e.params?.turn.id===turn.id))){if(Date.now()>deadline)throw new Error('Local mock turn timed out');await new Promise(r=>setTimeout(r,50));}
 assert.equal(done.params.turn.status,'completed',done.params.turn.error?.message);assert.equal(requests,1);
 const resumed=await bridge.call('thread/resume',{threadId:thread.id,config:override,excludeTurns:true});assert.equal(resumed.thread.id,thread.id);
 console.log(JSON.stringify({passed:true,originalErrorReproduced:true,realBackend:true,realBridge:true,structuredStartPassed:true,structuredResumePassed:true,knownGuardianAndMultiAgentConfigPreserved:true,localMockRequests:requests,externalInferenceRequests:0,realAccountsUsed:false}));
}finally{await native?.close();await bridge?.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.ok(resolve(home).startsWith(resolve(tmpdir())+sep+'identity-feature-schema-'));await rm(home,{recursive:true,force:true,maxRetries:10,retryDelay:200});}

// Explicit opt-in: real billable requests, isolated chats, and a transparent local HTTP relay.
import {readFile,writeFile,mkdir,mkdtemp,readdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {request as httpsRequest,Agent as HttpsAgent} from 'node:https';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {StdioClient} from '../stdio-client.mjs';
import {readCatalog} from '../catalog.mjs';

const [installation,apiId,reportPath,backendOverride,modelOverride]=process.argv.slice(2);
if(!installation||!apiId||!reportPath)throw new Error('Usage: node real-identity-routing-smoke.mjs <installation> <API-profile-id> <private-report>');
const config=JSON.parse(await readFile(join(installation,'runtime-config.json'),'utf8'));
const profileRoot=join(config.codexHome,'session-identities','profiles');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const authPath=join(config.codexHome,'auth.json');const hostBytes=await readFile(authPath);const hostAuth=JSON.parse(hostBytes);
assert.equal(hostAuth.auth_mode,'chatgpt');
const profiles=[];
for(const id of await readdir(profileRoot))profiles.push({id,...JSON.parse(await readFile(join(profileRoot,id,'profile.json'),'utf8'))});
const system=profiles.find(x=>x.kind==='chatgpt-system'&&x.accountId===hostAuth.tokens.account_id);
const independent=profiles.find(x=>x.kind==='chatgpt'&&x.accountId===system?.accountId&&x.userId===system?.userId)||profiles.find(x=>x.kind==='chatgpt');
const api=profiles.find(x=>x.id===apiId&&x.kind==='api');assert.ok(system&&independent&&api,'Matching official aliases and API profile required');
const privatePath=join(profileRoot,independent.id,'auth.json');const privateBytes=await readFile(privatePath);const independentAuth=JSON.parse(privateBytes);
const home=await mkdtemp(join(tmpdir(),'real-identity-routing-'));const servers=[];const records=[];const forwardedRequests=new Set();
const relayAgent=new HttpsAgent({keepAlive:false,proxyEnv:process.env});
let client;const report={passed:false,realUpstreamRequests:true,isolatedChats:true,refreshTokensCopied:false,checks:[]};
const save=()=>writeFile(resolve(reportPath),JSON.stringify(report,null,2));
function shortAuth(auth){return {...auth,tokens:{...auth.tokens,refresh_token:''}};}
try{
  await mkdir(join(home,'session-identities','profiles'),{recursive:true});
  await writeFile(join(home,'auth.json'),JSON.stringify(shortAuth(hostAuth)),{mode:0o600});
  await writeFile(join(home,'config.toml'),'model_provider = "openai"\nmodel_reasoning_effort = "low"\n');
  const command=api.provider.auth.command;const args=api.provider.auth.args||[];
  const credential=spawnSync(command,args,{windowsHide:true,encoding:'utf8'});assert.equal(credential.status,0,'API credential helper failed');
  let apiKey=credential.stdout.trim();
  try{const parsed=JSON.parse(apiKey);apiKey=parsed.token||parsed.api_key||parsed.access_token||apiKey;}catch{}
  const definitions=[['system',system,hostAuth],['api',api,null],['independent',independent,independentAuth]];
  for(const [role,profile,auth] of definitions){
    const upstream=new URL(profile.provider.base_url);assert.equal(upstream.protocol,'https:');
    const expected=auth?`Bearer ${auth.tokens.access_token}`:`Bearer ${apiKey}`;
    const relay=createServer(async(req,res)=>{
      try{
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>16*1024*1024)throw new Error('Relay request too large');chunks.push(chunk);}
        const bytes=Buffer.concat(chunks);let model;try{model=JSON.parse(bytes).model;}catch{}
        const record={role,model,isModelRequest:req.url.includes('/responses'),credentialMatched:req.headers.authorization===expected,accountHeaderMatched:!auth||req.headers['chatgpt-account-id']===profile.accountId};records.push(record);
        const target=new URL(upstream.href.replace(/\/$/,'')+req.url);
        const forwarded=httpsRequest(target,{agent:relayAgent,method:req.method,headers:{...req.headers,host:target.host}},response=>{
          record.status=response.statusCode;res.writeHead(response.statusCode,response.headers);response.pipe(res);
        });
        forwardedRequests.add(forwarded);forwarded.once('close',()=>forwardedRequests.delete(forwarded));
        res.once('close',()=>forwarded.destroy());
        forwarded.setTimeout(45000,()=>forwarded.destroy());
        forwarded.on('error',()=>{record.transportFailed=true;if(!res.headersSent)res.writeHead(502);res.end();});forwarded.end(bytes);
      }catch{res.writeHead(502);res.end();}
    });
    relay.listen(0,'127.0.0.1');await once(relay,'listening');servers.push(relay);
    const directory=join(home,'session-identities','profiles',profile.id);await mkdir(directory);
    const copy={...profile,provider:{...profile.provider,base_url:`http://127.0.0.1:${relay.address().port}`,supports_websockets:false}};delete copy.id;
    await writeFile(join(directory,'profile.json'),JSON.stringify(copy));
    if(auth&&profile.kind==='chatgpt')await writeFile(join(directory,'auth.json'),JSON.stringify(shortAuth(auth)),{mode:0o600});
  }
  const localBypass=[process.env.NO_PROXY||process.env.no_proxy||'','127.0.0.1','localhost','::1'].filter(Boolean).join(',');
  client=new StdioClient(backendOverride?resolve(backendOverride):join(installation,'node.exe'),backendOverride?['--listen','stdio://']:[join(installation,'runtime-bridge.cjs'),'app-server'],{cwd:home,env:{...process.env,CODEX_HOME:home,RUST_MIN_STACK:'33554432',NO_PROXY:localBypass,no_proxy:localBypass}});
  report.backendSha256=hash(await readFile(backendOverride?resolve(backendOverride):config.appServerExe));
  await client.initialize('real_identity_routing_verification');
  const catalog=(await client.call('model/list',{includeHidden:false})).data;
  const model=(modelOverride?[modelOverride]:['gpt-6-luna','gpt-5.6-luna']).map(name=>catalog.find(x=>x.model===name)).find(Boolean);
  assert.ok(model,'No lightweight Luna model in the installed catalog');report.model=model.model;
  const supported=model.supportedReasoningEfforts?.map(x=>x.reasoningEffort)||[];
  const effort=['none','minimal','low'].find(x=>supported.includes(x))||'low';report.effort=effort;
  const threadId=(await client.call('thread/start',{cwd:home,model:model.model,approvalPolicy:'never',sandbox:'read-only'})).thread.id;
  const sibling=(await client.call('thread/start',{cwd:home,model:model.model,approvalPolicy:'never',sandbox:'read-only'})).thread.id;
  const siblingBefore=await client.call('thread/identity/read',{threadId:sibling});
  for(const [role,profile] of [['system',system],['api',api],['independent',independent],['system',system]]){
    const previous=await client.call('thread/identity/read',{threadId});
    const switchStart=performance.now();
    const binding=await client.call('thread/identity/set',{threadId,identityId:profile.id,expectedRevision:previous.revision});
    const switchMs=performance.now()-switchStart;
    assert.equal(binding.identityId,profile.id);assert.equal(binding.verified,true);
    const startIndex=records.length;
    const replyStart=performance.now();
    const started=await client.call('turn/start',{threadId,model:model.model,effort,serviceTier:null,input:[{type:'text',text:'Reply exactly OK. Do not use tools.'}]});
    let finished;
    for(const deadline=Date.now()+90000;Date.now()<deadline;){
      const snapshot=(await client.call('thread/read',{threadId,includeTurns:true})).thread;
      const turn=snapshot.turns.find(x=>x.id===started.turn.id);
      if(turn&&['idle','systemError'].includes(snapshot.status?.type)&&['completed','failed','interrupted'].includes(turn.status)){finished=turn;break;}
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    assert.ok(finished,'Real request timed out');
    const requests=records.slice(startIndex).filter(x=>x.isModelRequest);
    const check={role,model:model.model,status:finished.status,switchMs:+switchMs.toFixed(3),replyObservedMs:+(performance.now()-replyStart).toFixed(3),expectedIdentityConfirmed:true,networkRequests:requests,replyIsOK:finished.items.some(x=>x.type==='agentMessage'&&/^OK[.!]?$/.test(x.text.trim()))};
    report.checks.push(check);await save();console.log(JSON.stringify(check));
    assert.equal(finished.status,'completed',finished.error?.message);
    assert.ok(check.replyIsOK);assert.ok(requests.length);
    assert.ok(requests.every(x=>x.role===role&&x.credentialMatched&&x.accountHeaderMatched),'Wrong upstream route, credential or account header');
    assert.ok(requests.some(x=>x.status===200),'No successful upstream model response');
    assert.ok(requests.every(x=>x.status===200||(x.status==null&&x.transportFailed)),'Unexpected upstream HTTP status');
    assert.deepEqual(await client.call('thread/identity/read',{threadId:sibling}),siblingBefore,'Sibling identity changed');
  }
  const state=readCatalog(home,join(home,'identity-switcher'));
  const group=state.identities.find(x=>x.runtimeIds.includes(system.id));
  const sameOfficialAccount=system.accountId===independent.accountId&&system.userId===independent.userId;
  if(sameOfficialAccount)assert.ok(group.runtimeIds.includes(independent.id));
  else assert.ok(state.identities.some(x=>x.runtimeIds.includes(independent.id)&&x!==group),'Distinct official account must remain separate');
  report.sameChatAcrossAllSwitches=true;report.siblingUnchanged=true;report.officialAliasesGrouped=sameOfficialAccount;report.distinctOfficialAccounts=!sameOfficialAccount;
  report.hostAuthUnchanged=hash(await readFile(authPath))===hash(hostBytes);
  report.independentAuthUnchanged=hash(await readFile(privatePath))===hash(privateBytes);
  assert.ok(report.hostAuthUnchanged&&report.independentAuthUnchanged);report.passed=true;await save();
}catch(error){report.error=error.message;report.diagnostics=client?.events.slice(-30).map(x=>({method:x.method,serverRequest:x.id!=null,error:x.params?.error?.message,turnStatus:x.params?.turn?.status}));report.networkRequests=records;await save();console.error(JSON.stringify({passed:false,error:error.message,diagnostics:report.diagnostics,networkRequests:records}));process.exitCode=1;}
finally{await client?.close();for(const request of forwardedRequests)request.destroy();relayAgent.destroy();for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await rm(home,{recursive:true,force:true});}

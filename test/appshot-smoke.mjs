// Exercise Desktop's image/context transport through the real identity bridge.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {crc32,deflateSync} from 'node:zlib';
import {StdioClient} from '../stdio-client.mjs';

if(!process.argv[2])throw new Error('Pass patched app-server executable');
const executable=resolve(process.argv[2]);
const home=await mkdtemp(join(tmpdir(),'identity-appshot-'));
const requests=[];
let client,server;
function pngChunk(type,data){
  const content=Buffer.concat([Buffer.from(type),data]);
  const size=Buffer.alloc(4);size.writeUInt32BE(data.length);
  const checksum=Buffer.alloc(4);checksum.writeUInt32BE(crc32(content));
  return Buffer.concat([size,content,checksum]);
}
const header=Buffer.alloc(13);header.writeUInt32BE(2,0);header.writeUInt32BE(2,4);header[8]=8;header[9]=6;
const pixels=Buffer.from([0,255,0,0,255,0,255,0,255,0,0,0,255,255,255,255,255,255]);
const image='data:image/png;base64,'+Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),pngChunk('IHDR',header),pngChunk('IDAT',deflateSync(pixels)),pngChunk('IEND',Buffer.alloc(0))]).toString('base64');
const images=body=>body.input.flatMap(item=>item.content??[]).filter(item=>item.type==='input_image').map(item=>item.image_url);
try{
  server=createServer(async(req,res)=>{
    if(req.method!=='POST'||!req.url?.endsWith('/responses')){res.writeHead(404);res.end('{}');return;}
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    requests.push({authorization:req.headers.authorization,body:JSON.parse(Buffer.concat(chunks).toString())});
    const item={id:`msg_${requests.length}`,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'OK'}]};
    const id=`resp_${requests.length}`;
    const events=[{type:'response.created',response:{id,status:'in_progress'}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}];
    res.writeHead(200,{'content-type':'text/event-stream'});res.end(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}/v1`;
  await writeFile(join(home,'config.toml'),`model = "gpt-5.1-codex"\nmodel_provider = "fixture"\n[model_providers.fixture]\nname = "fixture"\nbase_url = "${base}"\nwire_api = "responses"\nexperimental_bearer_token = "synthetic-a"\nrequires_openai_auth = false\nsupports_websockets = false\n`);
  for(const id of ['a','b']){
    const profile=join(home,'session-identities','profiles',id);await mkdir(profile,{recursive:true});
    await writeFile(join(profile,'profile.json'),JSON.stringify({kind:'api',providerId:`pinned_${id}`,provider:{name:id,base_url:base,wire_api:'responses',experimental_bearer_token:`synthetic-${id}`,requires_openai_auth:false,supports_websockets:false}}));
  }
  // An isolated bridge config avoids production accounts and installed runtime mutation.
  for(const name of ['runtime-bridge.cjs','model-catalog-compat.cjs','client-version-compat.cjs','feature-config-compat.cjs'])await copyFile(new URL(`../${name}`,import.meta.url),join(home,name));
  await writeFile(join(home,'runtime-config.json'),JSON.stringify({appServerExe:executable}));
  const env={...process.env,CODEX_HOME:home,RUST_MIN_STACK:'33554432',NO_PROXY:'127.0.0.1,localhost,::1',no_proxy:'127.0.0.1,localhost,::1'};
  for(const key of ['OPENAI_API_KEY','CODEX_ACCESS_TOKEN','CODEX_API_KEY'])delete env[key];
  client=new StdioClient(process.execPath,[join(home,'runtime-bridge.cjs'),'app-server'],{cwd:home,env});
  await client.initialize('identity_appshot_smoke');
  const requirements=await client.call('configRequirements/read',{});
  assert.notEqual(requirements.requirements?.allowAppshots,false,'Appshots must not be disabled by the isolated backend');
  const threadId=(await client.call('thread/start',{cwd:home,approvalPolicy:'never',sandbox:'read-only',historyMode:'paginated'})).thread.id;
  await client.call('thread/identity/set',{threadId,identityId:'a',expectedRevision:0});
  const context='SYNTHETIC_APPSHOT_WINDOW_TEXT';
  async function turn(input,extra={}){
    const started=await client.call('turn/start',{threadId,input,...extra});
    const deadline=Date.now()+30000;
    while(true){
      const done=client.events.find(e=>e.method==='turn/completed'&&e.params?.threadId===threadId&&e.params.turn.id===started.turn.id);
      if(done){assert.equal(done.params.turn.status,'completed',done.params.turn.error?.message);return;}
      if(Date.now()>deadline)throw new Error('Appshot turn timed out');
      await new Promise(r=>setTimeout(r,25));
    }
  }
  await turn([{type:'text',text:context},{type:'image',url:image}]);
  assert.equal(requests.at(-1).authorization,'Bearer synthetic-a');
  assert.ok(JSON.stringify(requests.at(-1).body).includes(context));
  const sentImages=images(requests.at(-1).body);
  assert.equal(sentImages.length,1,'The model request must contain an image, not an unreadable-image placeholder');
  assert.match(sentImages[0],/^data:image\//);
  await client.call('thread/identity/set',{threadId,identityId:'b',expectedRevision:1});
  await client.call('thread/resume',{threadId,excludeTurns:true});
  await turn([{type:'text',text:'Check the earlier application snapshot.'}]);
  const switched=requests.at(-1);
  assert.equal(switched.authorization,'Bearer synthetic-b');
  assert.ok(JSON.stringify(switched.body).includes(context),'Window text must survive identity reload');
  assert.deepEqual(images(switched.body),sentImages,'Snapshot image must survive identity reload');
  const localImage=join(home,'appshot.png');await writeFile(localImage,Buffer.from(image.split(',')[1],'base64'));
  await turn([{type:'text',text:'SYNTHETIC_LOCAL_APPSHOT'},{type:'localImage',path:localImage}]);
  assert.equal(images(requests.at(-1).body).length,2,'Local screenshot must reach model request');
  console.log(JSON.stringify({passed:true,realBackend:true,realBridge:true,inlineImage:true,localImage:true,textAndImageSurvivedIdentitySwitch:true,nativeCaptureUiTested:false,realAccountsUsed:false}));
}finally{
  await client?.close();
  if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
  await rm(home,{recursive:true,force:true,maxRetries:20,retryDelay:250});
}

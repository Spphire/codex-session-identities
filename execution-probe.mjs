import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {StdioClient} from './stdio-client.mjs';

// Real native code-mode host and nested shell execution; model responses remain
// on loopback and the caller supplies an isolated, credential-free CODEX_HOME.
export async function executionProbe(executable,home,args=['app-server']){
  const original=await readFile(join(home,'config.toml'));
  const requests=[];let executionOutput='';let rpc;
  const server=createServer(async(req,res)=>{
    if(req.method!=='POST'||!req.url?.endsWith('/responses')){res.writeHead(404);res.end();return;}
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);requests.push(body);
    if(requests.length>1)executionOutput=JSON.stringify(body.input);
    const item=requests.length===1
      ?{type:'custom_tool_call',id:'ctc_exec',call_id:'call_exec',name:'exec',input:'text("CODE_MODE_RESULT_OK");text(await tools.exec_command({cmd:"Get-Location",max_output_tokens:100}));'}
      :{type:'message',id:'msg_ok',role:'assistant',status:'completed',content:[{type:'output_text',text:'EXECUTION_PROBE_DONE'}]};
    const id='resp_'+requests.length;const events=[{type:'response.created',response:{id,status:'in_progress'}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}];
    res.writeHead(200,{'content-type':'text/event-stream'});res.end(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    await writeFile(join(home,'config.toml'),`model="gpt-5.1-codex"\nmodel_provider="execution_probe"\n[features]\ncode_mode=true\ncode_mode_host=true\nunified_exec=true\n[code_mode]\ndisable_in_process_fallback=true\n[model_providers.execution_probe]\nname="Isolated execution probe"\nbase_url="http://127.0.0.1:${server.address().port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\nsupports_websockets=false\n`);
    const env={...process.env,CODEX_HOME:home,CODEX_SQLITE_HOME:home,RUST_MIN_STACK:'33554432',NO_PROXY:'127.0.0.1,localhost',no_proxy:'127.0.0.1,localhost'};
    for(const key of Object.keys(env))if(/TOKEN|API_KEY|PASSWORD|SECRET/i.test(key))delete env[key];
    rpc=new StdioClient(executable,args,{cwd:home,env});await rpc.initialize('paired_execution_probe');
    const {thread}=await rpc.call('thread/start',{cwd:home,model:'gpt-5.1-codex',approvalPolicy:'never',sandbox:'danger-full-access',ephemeral:true});
    const {turn}=await rpc.call('turn/start',{threadId:thread.id,input:[{type:'text',text:'Local execution compatibility fixture.'}]});
    let completed;
    for(const deadline=Date.now()+25000;Date.now()<deadline;){
      completed=rpc.events.find(e=>e.method==='turn/completed'&&e.params?.turn?.id===turn.id);
      if(completed)break;await new Promise(r=>setTimeout(r,50));
    }
    if(!completed||completed.params.turn.status!=='completed')throw new Error('Native execution compatibility probe did not complete');
    if(!executionOutput.includes('CODE_MODE_RESULT_OK')||!executionOutput.includes(home.replaceAll('\\','\\\\'))||executionOutput.includes('failed to decode code-mode IPC frame')){
      await writeFile(join(home,'execution-probe-output.json'),executionOutput);
      const ipcError=executionOutput.includes('result_buffered_for_ns')?': incompatible result_buffered_for_ns field':'';
      throw new Error('Native code-mode/shell execution failed'+ipcError+'; backend and companions may use incompatible IPC versions');
    }
    return {passed:true,checks:['native-code-mode-result','nested-shell-execution'],modelRequests:requests.length,externalModelRequests:0};
  }finally{
    await rpc?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await writeFile(join(home,'config.toml'),original);
  }
}

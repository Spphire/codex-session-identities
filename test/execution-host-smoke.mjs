import {StdioClient} from '../stdio-client.mjs';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const installation=process.argv[2];
const model=process.argv[3]||'gpt-6.1-sol';
const config=JSON.parse(await readFile(join(installation,'runtime-config.json'),'utf8'));
const auth=JSON.parse(await readFile(join(config.codexHome,'auth.json'),'utf8'));
const home=join(installation,'test',`execution-host-${Date.now()}`);
await mkdir(home,{recursive:true});
await writeFile(join(home,'config.toml'),'[features]\ncode_mode = true\ncode_mode_host = true\n');
const client=new StdioClient(join(installation,'node.exe'),[join(installation,'runtime-bridge.cjs'),'app-server'],{cwd:home,env:{...process.env,CODEX_HOME:home,RUST_MIN_STACK:'33554432'}});
const report={passed:false,isolatedHome:true};
try{
  await client.initialize('execution_host_verification');
  await client.call('account/login/start',{type:'chatgptAuthTokens',accessToken:auth.tokens.access_token,chatgptAccountId:auth.tokens.account_id});
  const threadId=(await client.call('thread/start',{cwd:home,model,approvalPolicy:'never',sandbox:'danger-full-access'})).thread.id;
  const started=await client.call('turn/start',{threadId,effort:'low',input:[{type:'text',text:'Use the shell execution tool to run Get-Location. You must actually execute the command. Do not read or change any files. After successful execution reply EXECUTION_HOST_OK.'}]});
  let finished;
  for(const deadline=Date.now()+150000;Date.now()<deadline;){
    const completed=client.events.find(x=>x.method==='turn/completed'&&x.params?.threadId===threadId&&x.params?.turn?.id===started.turn.id);
    if(completed){
      const items=new Map((completed.params.turn.items||[]).map(x=>[x.id,x]));
      for(const event of client.events){if(event.method==='item/completed'&&event.params?.threadId===threadId&&event.params?.turnId===started.turn.id)items.set(event.params.item.id,event.params.item);}
      finished={...completed.params.turn,items:[...items.values()]};break;
    }
    await new Promise(r=>setTimeout(r,1000));
  }
  assert.ok(finished,'Execution verification timed out');
  report.status=finished.status;report.error=finished.error?.message;
  report.commands=finished.items.filter(x=>x.type==='commandExecution').map(x=>({command:x.command,exitCode:x.exitCode,output:x.aggregatedOutput}));
  report.itemTypes=finished.items.map(x=>x.type);
  report.messages=finished.items.filter(x=>x.type==='agentMessage').map(x=>x.text);
  report.warnings=client.events.filter(x=>/error|warning/i.test(x.method??'')).map(x=>({method:x.method,message:x.params?.message??x.params?.error?.message}));
  assert.equal(finished.status,'completed',finished.error?.message);
  assert.ok(report.commands.some(x=>x.exitCode===0&&String(x.output).includes(home)),'No successful shell command with the fixture working directory');
  assert.ok(finished.items.some(x=>x.type==='agentMessage'&&x.text.includes('EXECUTION_HOST_OK')));
  const registry=join(home,'session-identities','runtimes');
  const descriptor=JSON.parse(await readFile(join(registry,(await readdir(registry))[0]),'utf8'));
  const output=execFileSync('powershell.exe',['-NoProfile','-Command',`@(Get-CimInstance Win32_Process -Filter "Name='codex-code-mode-host.exe'" | Where-Object {$_.ParentProcessId -eq ${descriptor.runtimePid}} | Select-Object ProcessId,ParentProcessId) | ConvertTo-Json -Compress`],{encoding:'utf8',windowsHide:true});
  report.hostProcesses=JSON.parse(output.trim()||'[]');
  assert.ok([report.hostProcesses].flat().length,'No execution host belonging to the tested backend');
  report.passed=true;
}catch(error){report.error=error.message;process.exitCode=1;}
finally{await client.close();await writeFile(join(installation,'execution-host-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}

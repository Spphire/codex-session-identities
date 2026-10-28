import {readFile,readdir,stat,copyFile,writeFile,rename} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export async function repairBrowserRuntime({codexHome,resourcesDirectory,runtimesDirectory}){
  const file=join(codexHome,'config.toml');let original;
  try{original=await readFile(file,'utf8')}catch(error){if(error.code==='ENOENT')return {passed:true,changed:false};throw error}
  const separator=String.raw`[\\/]+`;
  const pattern=new RegExp('('+runtimesDirectory.split(/[\\/]+/).map(escape).join(separator)+separator+')([a-f0-9]{16})(?='+separator+')','gi');
  const allowed=new Set(['command','args','CUA_REPL_NODE_REPL_PATH','NODE_REPL_NODE_PATH','NODE_REPL_NODE_MODULE_DIRS','NODE_REPL_TRUSTED_CODE_PATHS']);
  let section='';let candidates=[];
  const lines=original.split(/(?<=\n)/);
  for(const [index,line] of lines.entries()){
    const header=line.replace(/^\uFEFF/,'').match(/^\s*\[([^\]]+)\]/);if(header)section=header[1];
    const key=line.match(/^\s*([A-Za-z_]+)\s*=/)?.[1];
    pattern.lastIndex=0;
    if(['mcp_servers.node_repl','mcp_servers.node_repl.env'].includes(section)&&allowed.has(key)&&pattern.test(line))candidates.push(index);
  }
  if(!candidates.length)return {passed:true,changed:false};
  const expected=await readFile(join(resourcesDirectory,'cua_node','manifest.json'),'utf8');const matches=[];
  for(const entry of await readdir(runtimesDirectory,{withFileTypes:true})){
    if(!entry.isDirectory()||!/^[a-f0-9]{16}$/i.test(entry.name))continue;
    const directory=join(runtimesDirectory,entry.name);
    try{
      if(await readFile(join(directory,'manifest.json'),'utf8')!==expected)continue;
      for(const name of ['node.exe','node_repl.exe'])if(!(await stat(join(directory,'bin',name))).isFile())throw Error('missing');
      if(!(await stat(join(directory,'bin','node_modules'))).isDirectory())continue;
      matches.push(entry.name);
    }catch{}
  }
  if(matches.length!==1)throw new Error('Cannot uniquely locate the browser runtime matching the installed Desktop; open official Codex to finish runtime setup.');
  let changedKeys=0;
  for(const index of candidates){const updated=lines[index].replace(pattern,(_,prefix)=>prefix+matches[0]);if(updated!==lines[index]){lines[index]=updated;changedKeys++;}}
  // The official launcher provides the browser bootstrap and its model-visible
  // instructions. A plain NodeREPL with suppressed browser guidance lacks both.
  let bootstrapConfigured=false;
  const runtimeBin=join(runtimesDirectory,matches[0],'bin');
  // Current Desktop owns a separate cua_repl plugin. Do not replace its plain
  // node_repl configuration with our legacy browser-only launcher on each start.
  let officialPluginAvailable=false;
  const pluginRoot=join(codexHome,'plugins','cache','openai-bundled','unified-computer-use');
  const normalized=value=>typeof value==='string'?value.replaceAll('\\','/').toLowerCase():'';
  for(const version of await readdir(pluginRoot).catch(()=>[])){
    try{
      const plugin=JSON.parse(await readFile(join(pluginRoot,version,'.mcp.json'),'utf8'))?.mcpServers?.cua_repl;
      if(plugin?.enabled!==false&&normalized(plugin?.command)===normalized(join(runtimeBin,'node.exe'))&&plugin?.args?.length===1&&normalized(plugin.args[0])===normalized(join(runtimeBin,'node_modules','@oai','cua-repl','bin','cua-repl.mjs'))&&normalized(plugin?.env?.CUA_REPL_NODE_REPL_PATH)===normalized(join(runtimeBin,'node_repl.exe'))&&plugin?.env?.CUA_REPL_ENABLED_SURFACES?.split(',').some(value=>value.trim()==='browser'))officialPluginAvailable=true;
    }catch{}
  }
  let serverHeader=-1,envHeader=-1,commandIndex=-1,argsIndex=-1;section='';
  for(const [index,line] of lines.entries()){
    const header=line.match(/^\s*\[([^\]]+)\]/);if(header){section=header[1];if(section==='mcp_servers.node_repl')serverHeader=index;if(section==='mcp_servers.node_repl.env')envHeader=index;}
    if(section==='mcp_servers.node_repl'){if(/^\s*command\s*=/.test(line))commandIndex=index;if(/^\s*args\s*=\s*\[\s*\]\s*(?:#.*)?(?:\r?\n)?$/.test(line))argsIndex=index;}
  }
  const content=lines.join('');
  const envSection=content.match(/^\[mcp_servers\.node_repl\.env\][^\n]*\r?\n([\s\S]*?)(?=^\[|(?![\s\S]))/m)?.[1]??'';
  const command=commandIndex>=0?lines[commandIndex].match(/^\s*command\s*=\s*'([^']+)'/)?.[1]:null;
  const owned=command?.replaceAll('\\','/').toLowerCase()===join(runtimeBin,'node_repl.exe').replaceAll('\\','/').toLowerCase();
  if(!officialPluginAvailable&&serverHeader>=0&&envHeader>=0&&argsIndex>=0&&owned&&/^BROWSER_USE_AVAILABLE_BACKENDS\s*=.*\biab\b/m.test(envSection)&&/^NODE_REPL_INSTRUCTIONS_USE_CASE_BROWSER\s*=\s*""\s*$/m.test(envSection)&&!/^\s*(?:CUA_REPL_|NODE_REPL_JS_BANNER|NODE_REPL_TOOL_OVERRIDES)/m.test(envSection)){
    const wrapper=join(runtimeBin,'node_modules','@oai','cua-repl','bin','cua-repl.mjs');
    if(!(await stat(wrapper)).isFile())throw new Error('The installed browser runtime lacks its official initialization launcher.');
    const newline=original.includes('\r\n')?'\r\n':'\n';
    lines[commandIndex]='command = '+JSON.stringify(join(runtimeBin,'node.exe'))+newline;
    lines[argsIndex]='args = ['+JSON.stringify(wrapper)+']'+newline;
    lines[envHeader]+= 'CUA_REPL_NODE_REPL_PATH = '+JSON.stringify(join(runtimeBin,'node_repl.exe'))+newline+'CUA_REPL_ENABLED_SURFACES = "browser"'+newline+'CUA_REPL_BROWSER_ENV = "codex-app"'+newline;
    changedKeys+=5;bootstrapConfigured=true;
  }
  let browserServiceUpdated=false;section='';
  for(const [index,line] of lines.entries()){
    const header=line.match(/^\s*\[([^\]]+)\]/);if(header)section=header[1];
    if(section!=='mcp_servers.node_repl.env')continue;
    const value=line.match(/^\s*NODE_REPL_TRUSTED_SERVICES\s*=\s*'([^']+)'\s*$/)?.[1];
    if(!value)continue;
    const services=JSON.parse(value),browser=services.browser;
    if(typeof browser==='string'&&browser.replaceAll('\\','/').toLowerCase().startsWith(codexHome.replaceAll('\\','/').toLowerCase()+'/plugins/cache/openai-bundled/browser/')&&/\/scripts\/browser-service\.mjs$/.test(browser.replaceAll('\\','/'))){
      services.browser='@oai/browser-desktop/service';
      lines[index]="NODE_REPL_TRUSTED_SERVICES = '"+JSON.stringify(services)+"'"+(line.endsWith('\r\n')?'\r\n':line.endsWith('\n')?'\n':'');
      changedKeys++;browserServiceUpdated=true;
    }
  }
  if(!changedKeys)return {passed:true,changed:false,bootstrapOwner:officialPluginAvailable?'official-plugin':'existing-configuration'};
  if(await readFile(file,'utf8')!==original)throw new Error('Browser configuration changed concurrently; retry the repair.');
  const backup=file+'.before-browser-runtime-'+Date.now()+'.bak';await copyFile(file,backup);
  const temporary=file+'.browser-runtime-'+process.pid+'.tmp';await writeFile(temporary,lines.join(''));await rename(temporary,file);
  return {passed:true,changed:true,changedKeys,bootstrapConfigured,browserServiceUpdated,bootstrapOwner:officialPluginAvailable?'official-plugin':'legacy-compatibility',backup};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const root=resolve(process.argv[2]);const config=JSON.parse(await readFile(join(root,'runtime-config.json'),'utf8'));
    console.log(JSON.stringify(await repairBrowserRuntime({codexHome:config.codexHome,resourcesDirectory:dirname(config.originalCodexExe),runtimesDirectory:join(process.env.LOCALAPPDATA,'OpenAI','Codex','runtimes','cua_node')})));
  }catch(error){console.log(JSON.stringify({passed:false,error:error.message}));process.exitCode=1;}
}

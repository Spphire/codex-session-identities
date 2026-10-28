import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {repairBrowserRuntime} from '../repair-browser-runtime.mjs';
test('browser paths follow only the matching official runtime and preserve custom config and authorization',async()=>{
  const root=await mkdtemp(join(tmpdir(),'browser-paths-'));
  try{
    const codexHome=join(root,'home'),resourcesDirectory=join(root,'resources'),runtimesDirectory=join(root,'runtimes','cua_node');
    const runtime=join(runtimesDirectory,'1111111111111111');
    await mkdir(codexHome,{recursive:true});await mkdir(join(resourcesDirectory,'cua_node'),{recursive:true});await mkdir(join(runtime,'bin','node_modules'),{recursive:true});
    for(const file of ['node.exe','node_repl.exe'])await writeFile(join(runtime,'bin',file),'fixture');
    for(const directory of [join(resourcesDirectory,'cua_node'),runtime])await writeFile(join(directory,'manifest.json'),'matching-official-manifest');
    const old=join(runtimesDirectory,'0000000000000000');
    const original=`# keep\r\n[mcp_servers.node_repl]\r\ncommand = '${old}/bin/node_repl.exe'\r\nargs=[]\r\n[mcp_servers.node_repl.env]\r\nNODE_REPL_NODE_PATH = '${old}/bin/node.exe'\r\nBROWSER_USE_ACCESS_PIPE_PATH='leave-auth-as-is'\r\n[mcp_servers.custom]\r\ncommand='${old}/custom.exe'\r\n`;
    const file=join(codexHome,'config.toml');await writeFile(file,original);
    const options={codexHome,resourcesDirectory,runtimesDirectory};const result=await repairBrowserRuntime(options);
    assert.equal(result.changedKeys,2);assert.equal(await readFile(result.backup,'utf8'),original);
    const updated=await readFile(file,'utf8');assert.ok(updated.includes('1111111111111111'));assert.ok(updated.includes(`command='${old}/custom.exe'`));assert.ok(updated.includes("BROWSER_USE_ACCESS_PIPE_PATH='leave-auth-as-is'"));assert.ok(updated.includes('\r\n'));
    assert.equal((await repairBrowserRuntime(options)).changed,false);
    await writeFile(join(runtime,'manifest.json'),'wrong-version');
    await assert.rejects(()=>repairBrowserRuntime(options),/Cannot uniquely/);assert.equal(await readFile(file,'utf8'),updated);
    await writeFile(join(runtime,'manifest.json'),'matching-official-manifest');
    const wrapper=join(runtime,'bin','node_modules','@oai','cua-repl','bin','cua-repl.mjs');await mkdir(join(wrapper,'..'),{recursive:true});await writeFile(wrapper,'official wrapper fixture');
    const legacy=original.replace("BROWSER_USE_ACCESS_PIPE_PATH='leave-auth-as-is'",`BROWSER_USE_ACCESS_PIPE_PATH='leave-auth-as-is'\r\nBROWSER_USE_AVAILABLE_BACKENDS="chrome,iab"\r\nNODE_REPL_INSTRUCTIONS_USE_CASE_BROWSER=""\r\nNODE_REPL_TRUSTED_SERVICES='${JSON.stringify({browser:join(codexHome,'plugins','cache','openai-bundled','browser','26.1016.51333','scripts','browser-service.mjs'),sky:'preserve-custom-sky'})}'`);
    await writeFile(file,legacy);const bootstrap=await repairBrowserRuntime(options);assert.equal(bootstrap.bootstrapConfigured,true);
    const bootstrapped=await readFile(file,'utf8');assert.ok(bootstrapped.includes('cua-repl.mjs'));assert.match(bootstrapped,/CUA_REPL_ENABLED_SURFACES = "browser"/);assert.ok(bootstrapped.includes("BROWSER_USE_ACCESS_PIPE_PATH='leave-auth-as-is'"));assert.equal((await repairBrowserRuntime(options)).changed,false);
    assert.equal(bootstrap.browserServiceUpdated,true);assert.ok(bootstrapped.includes('@oai/browser-desktop/service'));assert.ok(bootstrapped.includes('preserve-custom-sky'));
    await writeFile(file,legacy.replace('args=[]','args=["custom"]'));assert.equal((await repairBrowserRuntime(options)).bootstrapConfigured,false);
    const officialPlugin=join(codexHome,'plugins','cache','openai-bundled','unified-computer-use','current');await mkdir(officialPlugin,{recursive:true});
    await writeFile(join(officialPlugin,'.mcp.json'),JSON.stringify({mcpServers:{cua_repl:{command:join(runtime,'bin','node.exe'),args:[wrapper],env:{CUA_REPL_NODE_REPL_PATH:join(runtime,'bin','node_repl.exe'),CUA_REPL_ENABLED_SURFACES:'browser,computer'}}}}));
    await writeFile(file,legacy);const official=await repairBrowserRuntime(options);
    assert.equal(official.bootstrapOwner,'official-plugin');assert.equal(official.bootstrapConfigured,false);
    const officialConfig=await readFile(file,'utf8');assert.match(officialConfig,/args=\[\]/);assert.doesNotMatch(officialConfig,/CUA_REPL_ENABLED_SURFACES/);assert.ok(officialConfig.includes("BROWSER_USE_ACCESS_PIPE_PATH='leave-auth-as-is'"));
    assert.equal((await repairBrowserRuntime(options)).changed,false);
  }finally{await rm(root,{recursive:true,force:true})}
});

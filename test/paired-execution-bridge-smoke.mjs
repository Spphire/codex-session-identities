import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {copyBridgeFixture} from './support/bridge-fixture.mjs';
import {executionProbe} from '../execution-probe.mjs';

const backend=resolve(process.argv[2]);
const home=await mkdtemp(join(tmpdir(),'paired-bridge-execution-'));
try{
  await copyBridgeFixture(home);
  await writeFile(join(home,'runtime-config.json'),JSON.stringify({appServerExe:backend}));
  await writeFile(join(home,'config.toml'),'');
  console.log(JSON.stringify(await executionProbe(process.execPath,home,[join(home,'runtime-bridge.cjs'),'app-server'])));
}finally{await rm(home,{recursive:true,force:true,maxRetries:10,retryDelay:100});}

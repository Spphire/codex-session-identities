import {executionProbe} from '../execution-probe.mjs';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const home=await mkdtemp(join(tmpdir(),'paired-execution-'));
await writeFile(join(home,'config.toml'),'');
try{console.log(JSON.stringify(await executionProbe(process.argv[2],home,process.argv.slice(3))));}
catch(error){console.log(JSON.stringify({passed:false,error:error.message,diagnostics:home}));process.exitCode=1;}

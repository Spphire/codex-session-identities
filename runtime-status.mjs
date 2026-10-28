import {BridgeClient} from './bridge-client.mjs';
const client=new BridgeClient(process.argv[2]);
// Windows PowerShell 5.1 can decode native UTF-8 output through a legacy code page.
// Keep machine JSON ASCII on the pipe; JSON parsers restore Unicode losslessly.
try{const {connected,pid,reason}=await client.connect();let terminalControlAvailable=false;if(connected){try{terminalControlAvailable=(await client.call('bridge/terminals/capabilities',{},2000))?.revision===1}catch{}}console.log(JSON.stringify({connected,pid,reason,terminalControlAvailable}).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')));}finally{client.close();}

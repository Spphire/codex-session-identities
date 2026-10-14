import {BridgeClient} from './bridge-client.mjs';
const client=new BridgeClient(process.argv[2]);
try{const {connected,pid}=await client.connect();console.log(JSON.stringify({connected,pid}));}finally{client.close();}

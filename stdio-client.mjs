import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';

export class StdioClient {
  constructor(executable,args,options={}){
    this.pending=new Map();this.sequence=0;this.events=[];this.closed=false;
    this.child=spawn(executable,args,{...options,windowsHide:true,stdio:['pipe','pipe','ignore']});
    const fail=()=>{this.closed=true;for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(new Error('Codex RPC process stopped'));}this.pending.clear();};
    this.child.on('error',fail);this.child.on('exit',fail);this.child.stdin.on('error',fail);
    createInterface({input:this.child.stdout}).on('line',line=>{
      let message;try{message=JSON.parse(line);}catch{return;}
      const request=this.pending.get(message.id);
      if(!request){this.events.push(message);return;}
      this.pending.delete(message.id);clearTimeout(request.timer);
      if(message.error)request.reject(new Error(message.error.message));else request.resolve(message.result);
    });
  }
  call(method,params,timeout=60000){
    if(this.closed)return Promise.reject(new Error('Codex RPC is closed'));
    return new Promise((resolve,reject)=>{
      const id=++this.sequence;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`RPC timeout: ${method}`));},timeout);
      this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,method,params})+'\n');
    });
  }
  async initialize(name='identity_management'){
    await this.call('initialize',{clientInfo:{name,version:'0.1.0'},capabilities:{experimentalApi:true}});
    this.child.stdin.write('{"method":"initialized","params":{}}\n');
  }
  async close(){
    this.child.stdin.end();if(this.child.exitCode!==null||this.child.signalCode!==null)return;
    const killer=setTimeout(()=>this.child.kill(),10000);await once(this.child,'exit');clearTimeout(killer);
  }
}

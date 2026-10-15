import { readdir, readFile, stat } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';

export class BridgeClient extends EventEmitter {
  constructor(codexDirectory) {
    super();
    this.directory=join(codexDirectory,'session-identities','runtimes');
    this.socket=null;this.ready=false;this.pid=null;this.pending=new Map();this.sequence=0;this.connecting=null;
    this.reason='尚未加载身份桥接后端';
  }

  status() { return {connected:Boolean(this.socket && !this.socket.destroyed && this.ready),canSwitch:Boolean(this.socket && !this.socket.destroyed && this.ready),pid:this.pid,reason:this.reason}; }

  async connect() {
    if(this.socket && !this.socket.destroyed)return this.status();
    if(this.connecting)return this.connecting;
    this.connecting=this.discover().finally(()=>{this.connecting=null;});return this.connecting;
  }

  async discover() {
    let files;try{files=await readdir(this.directory);}catch{this.reason='尚未加载身份桥接后端';return this.status();}
    const live=[];
    for(const filename of files.filter(x=>/^\d+\.json$/.test(x))) {
      try {
        const file=join(this.directory,filename);if((await stat(file)).size>4096)continue;
        const descriptor=JSON.parse(await readFile(file,'utf8'));
        if(descriptor.protocol!==1 || !/^[a-f0-9]{64}$/.test(descriptor.token) || typeof descriptor.pipe!=='string')continue;
        if(process.platform==='win32' && !descriptor.pipe.startsWith('\\\\.\\pipe\\codex-identity-'))continue;
        live.push({...await this.open(descriptor),role:descriptor.role});
      } catch {}
    }
    const desktop=live.filter(x=>x.role==='desktop');
    const candidates=desktop.length?desktop:live.filter(x=>x.role==null);
    if(candidates.length!==1){for(const item of live)item.socket.destroy();this.reason=candidates.length?'存在多个桌面身份后端，需明确选择':'未找到运行中的桌面身份后端';return this.status();}
    const selected=candidates[0];for(const item of live)if(item!==selected)item.socket.destroy();
    this.socket=selected.socket;this.ready=selected.ready;this.pid=selected.pid;
    this.reason=this.ready?'已连接身份后端':'等待桌面初始化后端';
    this.socket.on('data',chunk=>this.consume(selected,chunk));
    this.socket.on('close',()=>{if(this.socket===selected.socket)this.disconnect();});
    // A handshake and an event can share a frame; consume any buffered tail now.
    this.consume(selected,'');this.socket.resume();return this.status();
  }

  open(descriptor) {
    return new Promise((resolve,reject)=>{
      const socket=createConnection(descriptor.pipe);socket.setEncoding('utf8');
      const timeout=setTimeout(()=>{socket.destroy();reject(new Error('Bridge handshake timeout'));},1500);
      const fail=error=>{clearTimeout(timeout);socket.destroy();reject(error);};socket.on('error',fail);
      const state={socket,buffer:'',ready:false,pid:null};
      const handshake=chunk=>{
        state.buffer+=chunk;const index=state.buffer.indexOf('\n');if(index<0)return;
        try {
          const message=JSON.parse(state.buffer.slice(0,index));state.buffer=state.buffer.slice(index+1);
          if(message.protocol!==1 || typeof message.ready!=='boolean')throw new Error('Invalid bridge handshake');
          state.ready=message.ready;state.pid=message.pid;clearTimeout(timeout);socket.pause();socket.off('data',handshake);resolve(state);
        }catch(error){fail(error);}
      };
      socket.on('data',handshake);socket.on('connect',()=>socket.write(JSON.stringify({token:descriptor.token})+'\n'));
    });
  }

  consume(state,chunk) {
    state.buffer+=chunk;
    if(Buffer.byteLength(state.buffer)>8*1024*1024){state.socket.destroy();return;}
    let index;
    while((index=state.buffer.indexOf('\n'))>=0){
      const line=state.buffer.slice(0,index);state.buffer=state.buffer.slice(index+1);
      let message;try{message=JSON.parse(line);}catch{state.socket.destroy();return;}
      if(message.protocol===1 && typeof message.ready==='boolean'){
        this.ready=message.ready;this.reason=message.ready?'已连接身份后端':'等待桌面初始化后端';continue;
      }
      if(message.id==null&&['turn/completed','thread/status/changed','thread/started'].includes(message.method)){
        this.emit('lifecycle',message);continue;
      }
      const pending=this.pending.get(message.id);if(!pending)continue;
      this.pending.delete(message.id);clearTimeout(pending.timeout);
      if(message.error)pending.reject(new Error(message.error.message));else pending.resolve(message.result);
    }
  }

  async call(method,params,timeoutMs=60000) {
    await this.connect();if(!this.status().connected)throw new Error(this.reason);
    return new Promise((resolve,reject)=>{
      const id=`panel:${++this.sequence}`;
      const timeout=setTimeout(()=>{this.pending.delete(id);reject(new Error('身份后端响应超时，尚不能确认是否生效'));},timeoutMs);
      this.pending.set(id,{resolve,reject,timeout});this.socket.write(JSON.stringify({id,method,params})+'\n');
    });
  }

  disconnect() {
    this.socket=null;this.ready=false;this.reason='身份后端已断开';
    for(const pending of this.pending.values()){clearTimeout(pending.timeout);pending.reject(new Error(this.reason));}
    this.pending.clear();
  }

  close(){this.socket?.destroy();this.disconnect();}
}

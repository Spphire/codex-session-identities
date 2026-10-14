import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BindingStore } from './bindings.mjs';

export class SwitchCoordinator {
  constructor(codexDirectory, bridge) {
    const directory=join(codexDirectory,'session-identities');mkdirSync(directory,{recursive:true});
    this.store=new BindingStore(join(directory,'panel-bindings.sqlite'));this.bridge=bridge;this.inflight=new Set();this.closed=false;this.storeClosed=false;
    this.timer=setInterval(()=>this.tick(),2000);this.timer.unref();
    this.eventTimer=null;
    this.onLifecycle=()=>{
      if(this.closed)return;
      clearTimeout(this.eventTimer);
      this.eventTimer=setTimeout(()=>void this.tick(),25);this.eventTimer.unref();
    };
    this.bridge.on?.('lifecycle',this.onLifecycle);
  }

  async submit(threadId,identityId,expectedRevision,expectedDesiredRevision) {
    if(this.inflight.has(threadId))throw new Error('该会话正在切换，请稍后刷新');
    const native=await this.bridge.call('thread/identity/read',{threadId});
    if(this.inflight.has(threadId))throw new Error('该会话正在切换，请稍后刷新');
    if(native.revision!==expectedRevision)throw new Error('会话身份已变化，请刷新后重试');
    this.store.requestSwitch(threadId,identityId,expectedDesiredRevision,expectedRevision);
    void this.tick();return this.store.read(threadId);
  }

  async tick() {
    if(this.closed || !(await this.bridge.connect()).connected || this.closed)return;
    await Promise.all(this.store.pendingRequests().map(async request=>{
      if(this.inflight.has(request.threadId)||this.closed)return;
      this.inflight.add(request.threadId);
      const runtimeId=`runtime-${this.bridge.status().pid}`;
      try {
        const latest=this.store.read(request.threadId);
        if(latest.runtimeId!==runtimeId)this.store.attachRuntime(request.threadId,runtimeId,latest.runtimeId);
        let state=await this.bridge.call('thread/identity/read',{threadId:request.threadId});
        if(state.status==='unloaded'){
          if(state.identityId!==request.desiredIdentityId){
            if(state.revision!==request.nativeRevision)throw new Error('revision changed');
            state=await this.bridge.call('thread/identity/set',{threadId:request.threadId,identityId:request.desiredIdentityId,expectedRevision:request.nativeRevision});
            if(state.status==='busy')return;
          }
          if(state.status==='unloaded'&&state.identityId===request.desiredIdentityId){
            this.store.acknowledge(request.threadId,runtimeId,request.desiredRevision,request.desiredIdentityId,'configured');return;
          }
        }
        if(state.verified && state.identityId===request.desiredIdentityId){
          this.store.acknowledge(request.threadId,runtimeId,request.desiredRevision,request.desiredIdentityId);return;
        }
        if(request.nativeRevision!==state.revision)throw new Error('revision changed');
        const result=await this.bridge.call('thread/identity/set',{threadId:request.threadId,identityId:request.desiredIdentityId,expectedRevision:request.nativeRevision});
        if(result.status==='busy')return;
        if(!result.verified || result.identityId!==request.desiredIdentityId)throw new Error('Unconfirmed identity');
        this.store.acknowledge(request.threadId,runtimeId,request.desiredRevision,request.desiredIdentityId);
      } catch(error) {
        // A timeout/disconnect is ambiguous. Next poll reads the native identity before retrying.
        if(this.bridge.status().connected && !/超时|断开|stopped|timeout|thread changed during identity preparation/i.test(error.message))this.store.reject(request.threadId,runtimeId,request.desiredRevision,'runtime_unavailable');
      } finally {this.inflight.delete(request.threadId);if(this.closed&&!this.inflight.size)this.closeStore();}
    }));
  }

  cancel(threadId,revision){
    if(this.inflight.has(threadId))throw new Error('后端正在处理，暂时不能取消');
    return this.store.cancel(threadId,revision);
  }

  view(threadId){const state=this.store.read(threadId);return {...state,verified:state.verified&&this.bridge.status().connected&&state.runtimeId===`runtime-${this.bridge.status().pid}`,inflight:this.inflight.has(threadId)};}

  closeStore(){if(!this.storeClosed){this.storeClosed=true;this.store.close();}}
  close(){this.closed=true;clearInterval(this.timer);clearTimeout(this.eventTimer);this.bridge.removeListener?.('lifecycle',this.onLifecycle);if(!this.inflight.size)this.closeStore();}
}

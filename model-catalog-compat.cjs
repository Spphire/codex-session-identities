'use strict';
const fs = require('node:fs');
const path = require('node:path');

function validParams(params) {
  if(params == null)return true;
  return typeof params==='object' && !Array.isArray(params)
    && (params.limit==null || Number.isInteger(params.limit) && params.limit>=0 && params.limit<=0xffffffff)
    && (params.cursor==null || typeof params.cursor==='string' && /^\d+$/.test(params.cursor) && Number.isSafeInteger(Number(params.cursor)))
    && (params.includeHidden==null || typeof params.includeHidden==='boolean');
}

function mergePage(native, original, params={}) {
  if(!Array.isArray(native.data) || native.nextCursor!=null || !Array.isArray(original))return null;
  const nativeModels=new Map(native.data.map(model=>[model.model,model]));
  const nativeDefault=native.data.some(model=>model.isDefault);
  const seen=new Set();const models=[];
  // Keep installed ordering and aliases, but prefer the patched backend's current metadata.
  for(const model of [...original,...native.data]){
    if(!model || typeof model.model!=='string' || seen.has(model.model))continue;
    seen.add(model.model);const entry=nativeModels.get(model.model)||{...model,isDefault:nativeDefault?false:model.isDefault};
    if(params.includeHidden || !entry.hidden)models.push(entry);
  }
  const start=Number(params.cursor??0);
  if(start>models.length)return {error:{code:-32600,message:'Model cursor exceeds catalog length'}};
  const limit=Math.max(1,params.limit??models.length);
  const end=Math.min(start+limit,models.length);
  return {result:{...native,data:models.slice(start,end),nextCursor:end<models.length?String(end):null}};
}

class InstalledModelCatalog {
  constructor(executable,args,home){this.executable=executable;this.args=args;this.home=home;this.cached=null;this.pending=null;this.client=null;this.cleanup=null;this.closed=false;}
  async get(){
    if(this.closed)return null;
    const files=[this.executable,path.join(this.home,'config.toml'),path.join(this.home,'auth.json')];
    const stamp=files.map(file=>{try{const s=fs.statSync(file);return `${s.size}:${s.mtimeMs}`;}catch{return 'missing';}}).join('|');
    if(this.cached?.stamp===stamp && Date.now()-this.cached.time<30000)return this.cached.models;
    if(this.pending)return this.pending;
    this.pending=this.fetch().then(models=>{
      this.cached={stamp,time:Date.now(),models};return models;
    }).catch(()=>null).finally(()=>{this.pending=null;});
    return this.pending;
  }
  async fetch(){
    // Return a valid catalog without making Desktop wait for helper teardown.
    // Serialize a later refresh with cleanup so only one helper exists at a time.
    await this.cleanup;
    const {StdioClient}=await import('./stdio-client.mjs');
    if(this.closed)return null;
    const client=new StdioClient(this.executable,this.args,{env:{...process.env,CODEX_HOME:this.home}});
    this.client=client;
    const deadline=setTimeout(()=>client.child.kill(),15000);
    try{
      await client.initialize('identity_model_catalog');
      let cursor=null;const models=[];const cursors=new Set();
      do{
        const page=await client.call('model/list',{includeHidden:true,cursor});
        if(!Array.isArray(page.data))throw new Error('Invalid installed model catalog');
        models.push(...page.data);cursor=page.nextCursor;
        if(cursor!=null){if(cursors.has(cursor))throw new Error('Repeated model cursor');cursors.add(cursor);}
      }while(cursor!=null);
      return models;
    }finally{
      // Retain the deadline while closing an unresponsive helper process.
      this.cleanup=client.close().catch(()=>client.child.kill()).finally(()=>{
        clearTimeout(deadline);if(this.client===client)this.client=null;
      });
    }
  }
  close(){this.closed=true;this.client?.child.kill();}
}
module.exports={InstalledModelCatalog,mergePage,validParams};

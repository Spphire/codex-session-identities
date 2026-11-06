'use strict';
const {validThreadId,validProfileId,validRevision}=require('./identity-contract.cjs');

const nativeMethods=new Set(['thread/list','thread/resume','thread/identity/read','thread/identity/set','model/list','configRequirements/read','bridge/permissions/read']);
const fixtureMethods=new Set(['thread/start','thread/read','turn/start','thread/name/set','model/list']);
const controlMethods=new Set(['bridge/tools/capabilities','mcpServerStatus/list','config/mcpServer/reload','thread/browser/read','thread/browser/reload','bridge/terminals/capabilities','thread/backgroundTerminals/list','thread/backgroundTerminals/terminate','thread/identity/forceSet','thread/goal/get','thread/goal/set']);
const forward={action:'forward'};
const reject=error=>({action:'reject',error});

// Pure authorization/shape policy. Authentication stays at the pipe boundary;
// native identity methods keep their native validation and revision fences.
function panelRequestPolicy(value,{ready,integrationTests=false,identityForceRevision}={}){
  if(!value||typeof value!=='object'||Array.isArray(value))return reject('Method not allowed by identity bridge');
  const {method,params:p}=value;
  if(integrationTests===true&&method==='bridge/shutdown'&&value.id!=null)return {action:'shutdown'};
  if(!method||value.id==null||(!nativeMethods.has(method)&&!controlMethods.has(method)&&!(integrationTests===true&&fixtureMethods.has(method))))return reject('Method not allowed by identity bridge');
  if(!ready)return reject('Desktop has not initialized the backend');
  if(!controlMethods.has(method))return method==='bridge/permissions/read'?{action:'permissions'}:forward;
  const keys=p&&typeof p==='object'&&!Array.isArray(p)?Object.keys(p):null;
  const thread=keys&&validThreadId(p.threadId);
  const empty=keys?.length===0;
  if(['thread/browser/read','thread/browser/reload'].includes(method)&&thread&&keys.length===1)return forward;
  if(method==='bridge/terminals/capabilities'&&empty)return {action:'reply',result:{revision:1,scope:'selected-thread',forceSwitchRevision:identityForceRevision===1?1:0}};
  if(identityForceRevision===1&&thread){
    if(method==='thread/identity/forceSet'&&keys.length===3&&validProfileId(p.identityId)&&validRevision(p.expectedRevision))return forward;
    if(method==='thread/goal/get'&&keys.length===1)return forward;
    if(method==='thread/goal/set'&&keys.length===3&&p.origin==='user'&&p.status==='paused')return forward;
  }
  const page=thread&&p.limit===100&&(p.cursor===null||typeof p.cursor==='string'&&p.cursor.length<=8192);
  if(method==='thread/backgroundTerminals/list'&&page&&keys.every(k=>['threadId','cursor','limit'].includes(k)))return forward;
  if(method==='thread/backgroundTerminals/terminate'&&thread&&keys.length===2&&typeof p.processId==='string'&&/^\d{1,10}$/.test(p.processId))return forward;
  if(method==='bridge/tools/capabilities'&&empty)return {action:'reply',result:{revision:1,reloadScope:'all-loaded-threads'}};
  if(method==='config/mcpServer/reload'&&empty)return forward;
  if(method==='mcpServerStatus/list'&&page&&p.detail==='toolsAndAuthOnly'&&keys.every(k=>['threadId','detail','limit','cursor'].includes(k)))return forward;
  return reject('Invalid tool diagnostic parameters');
}
module.exports={panelRequestPolicy};

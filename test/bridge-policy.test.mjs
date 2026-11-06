import test from 'node:test';
import assert from 'node:assert/strict';
import {panelRequestPolicy} from '../bridge-policy.cjs';
import legacyPolicy from './fixtures/bridge-policy-v0.1.12.cjs';

const threadId='01a12537-493b-7542-b502-d487829730f1';
test('extracted panel policy preserves v0.1.12 routing and denials across feature gates',()=>{
  const methods=['thread/list','thread/resume','thread/identity/read','thread/identity/set','model/list','configRequirements/read','bridge/permissions/read','thread/start','thread/read','turn/start','thread/name/set','bridge/shutdown','account/logout','missing','bridge/tools/capabilities','mcpServerStatus/list','config/mcpServer/reload','thread/browser/read','thread/browser/reload','bridge/terminals/capabilities','thread/backgroundTerminals/list','thread/backgroundTerminals/terminate','thread/identity/forceSet','thread/goal/get','thread/goal/set'];
  const params=[undefined,null,{},[],{threadId},{threadId:'invalid'},
    {threadId,identityId:'fixture',expectedRevision:0},{threadId,identityId:'../other',expectedRevision:0},
    {threadId,identityId:'fixture',expectedRevision:-1},{threadId,identityId:'fixture',expectedRevision:1,all:true},
    {threadId,origin:'user',status:'paused'},{threadId,origin:'user',status:'active'},
    {threadId,processId:'12'},{threadId,processId:'../12'},{threadId,processId:'12',all:true},
    {threadId,cursor:null,limit:100},{threadId,cursor:'x'.repeat(8193),limit:100},
    {threadId,detail:'toolsAndAuthOnly',limit:100,cursor:null},
    {threadId,detail:'full',limit:100,cursor:null},{threadId,limit:100,cursor:null,extra:1}];
  for(const ready of [false,true])for(const integrationTests of [false,true])for(const identityForceRevision of [undefined,0,1,2]){
    const options={ready,integrationTests,identityForceRevision};
    for(const method of methods)for(const p of params)for(const id of [null,0,'panel:1']){
      const request={id,method,params:p};
      assert.deepEqual(panelRequestPolicy(request,options),legacyPolicy(request,options),JSON.stringify({request,options}));
    }
  }
});
test('JSON primitives cannot crash an authenticated panel connection',()=>{
  for(const value of [null,false,0,'text',[]])assert.equal(panelRequestPolicy(value,{ready:true}).action,'reject');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {compatibleFeatureConfig}=createRequire(import.meta.url)('../feature-config-compat.cjs');
test('new Desktop feature tables do not reach the pinned boolean fallback',()=>{
  for(const method of ['thread/start','thread/resume','thread/fork']){
    const message={id:1,method,params:{threadId:'fixture',config:{'features.async_compaction':{enabled:false,options:{future:true}},'features.future_leaf.enabled':true,'features.future_leaf.detail':{value:1},'features.goals':true,model:'unchanged'}}};
    const result=compatibleFeatureConfig(message);
    assert.equal(result.message.params.config['features.async_compaction'],false);
    assert.equal(result.message.params.config['features.future_leaf'],true);
    assert.equal(result.message.params.config['features.future_leaf.detail'],undefined);
    assert.equal(result.message.params.config['features.goals'],true);
    assert.equal(result.message.params.config.model,'unchanged');
    assert.equal(typeof message.params.config['features.async_compaction'],'object');
  }
});
test('known structured controls and all unrelated configuration keep their semantics',()=>{
  const config={'features.guardianv2':{enabled:true,transcript:{max_tokens:100}},'features.multi_agent_v2.wait_agent_enabled':false,features:{code_mode_host:{enabled:true},future:{enabled:false},future_without_boolean:{option:7},goals:true},approval_policy:'on-request'};
  const {message,adapted}=compatibleFeatureConfig({method:'thread/resume',params:{config}});
  assert.deepEqual(message.params.config['features.guardianv2'],config['features.guardianv2']);
  assert.equal(message.params.config['features.multi_agent_v2.wait_agent_enabled'],false);
  assert.deepEqual(message.params.config.features.code_mode_host,{enabled:true});
  assert.equal(message.params.config.features.future,false);
  assert.equal(message.params.config.features.future_without_boolean,undefined);
  assert.equal(message.params.config.features.goals,true);
  assert.equal(message.params.config.approval_policy,'on-request');
  assert.deepEqual(adapted,['features.future','features.future_without_boolean']);
  for(const method of ['config/batchWrite','turn/start','initialize']){const input={method,params:{config}};assert.equal(compatibleFeatureConfig(input).message,input);}
});

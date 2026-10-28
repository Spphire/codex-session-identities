'use strict';
// Structured feature tables understood by the pinned v10 backend. Unknown boolean
// flags are tolerated by it, but unknown tables fail the entire config parse.
const structured=new Set(['tool_registry','code_mode','code_mode_host','non_prefixed_mcp_tool_names','guardianv2','multi_agent_v2','token_budget','context_management','rollout_budget','current_time_reminder','sleep_tool','network_proxy']);
const methods=new Set(['thread/start','thread/resume','thread/fork']);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function compatibleFeatureConfig(message){
  if(!methods.has(message.method)||!object(message.params?.config))return {message,adapted:[]};
  const config={...message.params.config};const adapted=[];
  if(object(config.features)){
    const features={...config.features};
    for(const [key,value] of Object.entries(features)){
      if(!object(value)||structured.has(key))continue;
      if(typeof value.enabled==='boolean')features[key]=value.enabled;else delete features[key];
      adapted.push('features.'+key);
    }
    config.features=features;
  }
  for(const [key,value] of Object.entries(config)){
    if(!key.startsWith('features.'))continue;
    const parts=key.slice(9).split('.');const name=parts[0];
    if(structured.has(name))continue;
    if(parts.length===1&&object(value)){
      if(typeof value.enabled==='boolean')config[key]=value.enabled;else delete config[key];
      adapted.push(key);
    }else if(parts.length>1){
      // An enabled leaf has a faithful boolean representation on the old schema.
      if(parts.length===2&&parts[1]==='enabled'&&typeof value==='boolean'&&config['features.'+name]===undefined)config['features.'+name]=value;
      delete config[key];adapted.push(key);
    }
  }
  return {message:adapted.length?{...message,params:{...message.params,config}}:message,adapted};
}
module.exports={compatibleFeatureConfig};

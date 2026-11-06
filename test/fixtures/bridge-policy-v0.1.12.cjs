// Frozen v0.1.12 policy from d9727e7 for differential tests only.
module.exports=function legacyPolicy(request,options){
 const config=options,ready=options.ready,socket={};let decision;
 const permitted=new Set(['thread/list','thread/resume','thread/identity/read','thread/identity/set','model/list','configRequirements/read','bridge/permissions/read']);
 if(config.integrationTests===true)for(const method of ['thread/start','thread/read','turn/start','thread/name/set','model/list'])permitted.add(method);
 const forward=()=>{decision={action:'forward'}};
 const send=(_,value)=>{decision={action:'reply',result:value.result}};
 const responseError=(_,id,error)=>{decision={action:'reject',error}};
 for(const value of [request]){
        if(config.integrationTests===true && value.method==='bridge/shutdown' && value.id!=null){decision={action:'shutdown'};continue;}
        const toolMethod=['bridge/tools/capabilities','mcpServerStatus/list','config/mcpServer/reload','thread/browser/read','thread/browser/reload','bridge/terminals/capabilities','thread/backgroundTerminals/list','thread/backgroundTerminals/terminate','thread/identity/forceSet','thread/goal/get','thread/goal/set'].includes(value.method);
        if(!value.method || value.id==null || (!permitted.has(value.method)&&!toolMethod)){responseError(socket,value.id??null,'Method not allowed by identity bridge');continue;}
        if(!ready){responseError(socket,value.id,'Desktop has not initialized the backend');continue;}
        if(toolMethod){
          const p=value.params;
          if(['thread/browser/read','thread/browser/reload'].includes(value.method)&&p&&Object.keys(p).length===1&&typeof p.threadId==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(p.threadId)){forward(value,socket);continue;}
          const empty=p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).length===0;
          if(value.method==='bridge/terminals/capabilities'&&empty){send(socket,{id:value.id,result:{revision:1,scope:'selected-thread',forceSwitchRevision:config.identityForceRevision===1?1:0}});continue;}
          const terminalThread=p&&typeof p.threadId==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(p.threadId);
          if(config.identityForceRevision===1&&terminalThread){
            if(value.method==='thread/identity/forceSet'&&Object.keys(p).length===3&&typeof p.identityId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(p.identityId)&&Number.isSafeInteger(p.expectedRevision)&&p.expectedRevision>=0){forward(value,socket);continue;}
            if(value.method==='thread/goal/get'&&Object.keys(p).length===1){forward(value,socket);continue;}
            if(value.method==='thread/goal/set'&&Object.keys(p).length===3&&p.origin==='user'&&p.status==='paused'){forward(value,socket);continue;}
          }
          if(value.method==='thread/backgroundTerminals/list'&&terminalThread&&Object.keys(p).every(k=>['threadId','cursor','limit'].includes(k))&&p.limit===100&&(p.cursor===null||typeof p.cursor==='string'&&p.cursor.length<=8192)){forward(value,socket);continue;}
          if(value.method==='thread/backgroundTerminals/terminate'&&terminalThread&&Object.keys(p).length===2&&typeof p.processId==='string'&&/^\d{1,10}$/.test(p.processId)){forward(value,socket);continue;}
          if(value.method==='bridge/tools/capabilities'&&empty){send(socket,{id:value.id,result:{revision:1,reloadScope:'all-loaded-threads'}});continue;}
          if(value.method==='config/mcpServer/reload'&&empty){forward(value,socket);continue;}
          if(value.method==='mcpServerStatus/list'&&p&&Object.keys(p).every(k=>['threadId','detail','limit','cursor'].includes(k))&&typeof p.threadId==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(p.threadId)&&p.detail==='toolsAndAuthOnly'&&p.limit===100&&(p.cursor===null||typeof p.cursor==='string'&&p.cursor.length<=8192)){forward(value,socket);continue;}
          responseError(socket,value.id,'Invalid tool diagnostic parameters');continue;
        }
        if(value.method==='bridge/permissions/read'){
          decision={action:'permissions'};continue;
        }
        forward(value,socket);
 }
 return decision;
};

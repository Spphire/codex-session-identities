import {existsSync,readFileSync,readdirSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

export function removedIdentities(home){
  const file=join(home,'session-identities','panel-identities.json');
  if(!existsSync(file))return [];
  const data=JSON.parse(readFileSync(file,'utf8'));
  if(data.version!==1||!Array.isArray(data.removedIds)||!data.removedIds.every(x=>typeof x==='string'))throw new Error('身份列表配置格式无效');
  return data.removedIds;
}

export function removeIdentity(home,catalog,input,pending=[],observed=[]){
  const identity=catalog.identities.find(x=>x.id===input.identityId&&!x.removed);
  if(!identity)throw new Error('身份已变化，请刷新后重试');
  if(!Array.isArray(input.expectedMemberIds)||JSON.stringify([...input.expectedMemberIds].sort())!==JSON.stringify([...identity.memberIds].sort()))throw new Error('身份档案已变化，请刷新后重试');
  const ids=new Set(identity.runtimeIds);
  const used=()=>{throw new Error('该身份仍有会话绑定或待切换请求，请先切换这些会话的身份');};
  if(catalog.sessions.some(x=>ids.has(x.identityId))||pending.some(x=>ids.has(x.desiredIdentityId))||observed.some(x=>ids.has(x.identityId)))used();
  // Include bindings for archived or orphaned chats, not just rows visible in the panel.
  const root=join(home,'session-identities','bindings');
  if(existsSync(root))for(const name of readdirSync(root)){
    if(!/^[a-f0-9-]{36}\.json$/.test(name))continue;
    if(ids.has(JSON.parse(readFileSync(join(root,name),'utf8')).identityId))used();
  }
  const removedIds=[...new Set([...removedIdentities(home),...identity.memberIds])];
  const directory=join(home,'session-identities');mkdirSync(directory,{recursive:true});
  const temporary=join(directory,`panel-identities.${randomUUID()}.tmp`);
  writeFileSync(temporary,JSON.stringify({version:1,removedIds}),{mode:0o600});
  renameSync(temporary,join(directory,'panel-identities.json'));
  return {removed:true,credentialsDeleted:false};
}

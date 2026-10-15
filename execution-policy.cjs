'use strict';
const {DatabaseSync}=require('node:sqlite');
const {mkdirSync}=require('node:fs');
const {join}=require('node:path');
const managedMethods=new Set(['thread/start','thread/resume','thread/fork','thread/settings/update','turn/start','command/exec']);

function policy(mode){
  if(!['yolo','standard'].includes(mode))throw new Error('无效的执行权限模式');
  return {mode,approvalPolicy:mode==='yolo'?'never':'on-request',sandboxMode:mode==='yolo'?'danger-full-access':'workspace-write'};
}
class ExecutionPolicy {
  constructor(home){
    const directory=join(home,'session-identities');mkdirSync(directory,{recursive:true});
    this.db=new DatabaseSync(join(directory,'execution-policy.sqlite'));
    const applicationId=this.db.prepare('PRAGMA application_id').get().application_id;
    const hasTables=this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' LIMIT 1").get();
    if((hasTables||applicationId!==0)&&applicationId!==1128875090){this.db.close();throw new Error('Refusing to modify an unrelated execution-policy database');}
    this.db.exec("PRAGMA busy_timeout=1000; CREATE TABLE IF NOT EXISTS execution_policy (id INTEGER PRIMARY KEY CHECK(id=1), mode TEXT NOT NULL CHECK(mode IN ('yolo','standard')), revision INTEGER NOT NULL); INSERT OR IGNORE INTO execution_policy VALUES(1,'yolo',0); PRAGMA application_id=1128875090");
  }
  read(){const row=this.db.prepare('SELECT mode,revision FROM execution_policy WHERE id=1').get();return {...policy(row.mode),revision:row.revision};}
  set({mode,expectedRevision}){
    policy(mode);
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw new Error('无效的权限版本');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const current=this.read();if(current.revision!==expectedRevision)throw new Error('执行权限已变化，请刷新后重试');
      if(mode!==current.mode)this.db.prepare('UPDATE execution_policy SET mode=?,revision=revision+1 WHERE id=1').run(mode);
      const result=this.read();this.db.exec('COMMIT');return result;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  close(){this.db.close();}
}
function applyPolicy(message,current){
  const method=message.method;
  if(!managedMethods.has(method))return message;
  if(!message.params||typeof message.params!=='object'||Array.isArray(message.params))return message;
  const params={...message.params};
  const start=['thread/start','thread/resume','thread/fork'].includes(method);
  const sandbox=current.mode==='yolo'?{type:'dangerFullAccess'}:{type:'workspaceWrite',writableRoots:[],networkAccess:false,excludeTmpdirEnvVar:false,excludeSlashTmp:false};
  // Native profile selectors and raw sandbox overrides are mutually exclusive.
  delete params.permissions;delete params.permissionProfile;
  if(start){params.sandbox=current.sandboxMode;delete params.sandboxPolicy;}
  else{params.sandboxPolicy=sandbox;delete params.sandbox;}
  if(method!=='command/exec')params.approvalPolicy=current.approvalPolicy;
  return {...message,params};
}
function assertAllowed(mode,requirements){
  const desired=policy(mode);
  if(requirements?.allowedApprovalPolicies&&!requirements.allowedApprovalPolicies.includes(desired.approvalPolicy))throw new Error('组织策略不允许此命令审批模式');
  if(requirements?.allowedSandboxModes&&!requirements.allowedSandboxModes.includes(desired.sandboxMode))throw new Error('组织策略不允许此文件访问模式');
}
module.exports={ExecutionPolicy,applyPolicy,assertAllowed,managedMethods};

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function metadata(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}

function officialEmail(codexDirectory, profileDirectory, profile) {
  try {
    const auth=metadata(join(profile.kind==='chatgpt-system'?codexDirectory:profileDirectory,'auth.json'));
    if(auth.auth_mode!=='chatgpt'||typeof auth.tokens?.id_token!=='string')return null;
    const claims=JSON.parse(Buffer.from(auth.tokens.id_token.split('.')[1],'base64url').toString('utf8'));
    const info=claims['https://api.openai.com/auth'];
    const userId=info?.chatgpt_user_id||info?.user_id;
    if(!profile.accountId||!profile.userId||auth.tokens.account_id!==profile.accountId||userId!==profile.userId)return null;
    return typeof claims.email==='string' && /^[^\s@]+@[^\s@]+$/.test(claims.email)?claims.email:null;
  }catch{return null;}
}

export function readCatalog(codexDirectory, switcherDirectory) {
  const saved = metadata(join(switcherDirectory, 'state.json'));
  // Use an explicit allowlist: this file can contain credentials in nested baselines.
  const identities = [
    ...(saved.identities ?? []).map(x => ({ id: `api:${x.id}`, name: String(x.name), kind: 'api', provider: String(x.providerId) })),
    ...(saved.officialAccounts ?? []).map(x => ({ id: `chatgpt:${x.id}`, name: String(x.name), kind: 'chatgpt', provider: 'openai' })),
  ];
  const profileRoot=join(codexDirectory,'session-identities','profiles');
  for(const identity of identities){
    const runtimeId=identity.id.replace(':','_');
    identity.runtimeId=existsSync(join(profileRoot,runtimeId,'profile.json'))?runtimeId:null;
  }
  if(existsSync(profileRoot))for(const item of readdirSync(profileRoot,{withFileTypes:true})){
    if(!item.isDirectory() || !/^[A-Za-z0-9_-]{1,100}$/.test(item.name) || identities.some(x=>x.runtimeId===item.name))continue;
    const profile=metadata(join(profileRoot,item.name,'profile.json'));
    if(!['api','chatgpt','chatgpt-system'].includes(profile.kind))continue;
    const label=metadata(join(profileRoot,item.name,'label.json'));
    identities.push({id:item.name,runtimeId:item.name,name:typeof label.name==='string'?label.name:item.name,kind:profile.kind.startsWith('chatgpt')?'chatgpt':'api',provider:String(profile.providerId)});
  }
  const bindingRoot=join(codexDirectory,'session-identities','bindings');const bindings=new Map();
  for(const identity of identities){
    if(identity.kind!=='chatgpt'||!identity.runtimeId)continue;
    const directory=join(profileRoot,identity.runtimeId);
    const email=officialEmail(codexDirectory,directory,metadata(join(directory,'profile.json')));
    if(email)identity.name=email;
  }
  if(existsSync(bindingRoot))for(const name of readdirSync(bindingRoot)){
    if(!/^[a-f0-9-]{36}\.json$/.test(name))continue;
    const binding=metadata(join(bindingRoot,name));
    if(typeof binding.identityId==='string'&&Number.isInteger(binding.revision))bindings.set(name.slice(0,-5),binding);
  }
  const db = new DatabaseSync(join(codexDirectory, 'state_5.sqlite'), { readOnly: true });
  try {
    db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 1500;');
    const columns = new Set(db.prepare('PRAGMA table_info(threads)').all().map(x => x.name));
    const wanted = ['id', 'title', 'model_provider', 'model', 'cwd', 'updated_at', 'archived'];
    if (!wanted.every(x => columns.has(x))) throw new Error('Unsupported thread database schema');
    const nameColumn = columns.has('name') ? ', name' : '';
    const rows = db.prepare(`SELECT ${wanted.join(',')}${nameColumn} FROM threads ORDER BY updated_at DESC, id`).all();
    return {
      observedAt: new Date().toISOString(),
      identities,
      runtime: { connected: false, canSwitch: false, reason: '运行时身份接口尚未接入' },
      sessions: rows.map(x => ({
        id: x.id, title: (x.name || x.title || '未命名会话').slice(0, 160), provider: x.model_provider,
        model: x.model || '', cwd: x.cwd, updatedAt: x.updated_at, archived: Boolean(x.archived),
        // A provider string or creator_account_id does not prove the currently active account.
        identityId: bindings.get(x.id)?.identityId||null,
        identityRevision:bindings.get(x.id)?.revision||0,
        identityState:bindings.has(x.id)?'configured':'unbound', pendingIdentityId: null,
      })),
    };
  } finally { db.close(); }
}

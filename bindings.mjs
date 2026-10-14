import { DatabaseSync } from 'node:sqlite';

export class BindingConflict extends Error {}

function identifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9:_-]{1,160}$/.test(value)) {
    throw new TypeError('Invalid identity or session reference');
  }
  return value;
}

// This database belongs to the panel. Never open a Codex database with this class.
export class BindingStore {
  constructor(filename) {
    this.db = new DatabaseSync(filename);
    const applicationId = this.db.prepare('PRAGMA application_id').get().application_id;
    const hasTables = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' LIMIT 1").get();
    if ((hasTables || applicationId !== 0) && applicationId !== 1128875088) {
      this.db.close();
      throw new Error('Refusing to modify a database not owned by the identity panel');
    }
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (hasTables && version !== 1) {
      this.db.close();
      throw new Error('Unsupported identity binding schema version');
    }
    this.db.exec(`
      PRAGMA busy_timeout = 1500;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS bindings (
        thread_id TEXT PRIMARY KEY,
        desired_revision INTEGER NOT NULL DEFAULT 0,
        desired_identity TEXT,
        applied_revision INTEGER NOT NULL DEFAULT 0,
        applied_identity TEXT,
        applied_runtime_id TEXT,
        confirmation_phase TEXT NOT NULL DEFAULT 'runtime',
        runtime_id TEXT,
        error_code TEXT
      );
      CREATE TABLE IF NOT EXISTS identity_changes (
        thread_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        identity_id TEXT NOT NULL,
        native_revision INTEGER,
        PRIMARY KEY(thread_id, revision)
      );
      PRAGMA application_id = 1128875088;
      PRAGMA user_version = 1;
    `);
    const changeColumns = this.db.prepare('PRAGMA table_info(identity_changes)').all().map(x=>x.name);
    if (!changeColumns.includes('native_revision')) this.db.exec('ALTER TABLE identity_changes ADD COLUMN native_revision INTEGER');
    const bindingColumns=this.db.prepare('PRAGMA table_info(bindings)').all().map(x=>x.name);
    if(!bindingColumns.includes('confirmation_phase'))this.db.exec("ALTER TABLE bindings ADD COLUMN confirmation_phase TEXT NOT NULL DEFAULT 'runtime'");
  }

  close() { this.db.close(); }

  transaction(operation) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  read(threadId) {
    identifier(threadId);
    const row = this.db.prepare('SELECT * FROM bindings WHERE thread_id = ?').get(threadId);
    if (!row) return { threadId, desiredRevision: 0, desiredIdentityId: null, appliedRevision: 0, appliedIdentityId: null, runtimeId: null, verified: false, pending: false, errorCode: null };
    return {
      threadId, desiredRevision: row.desired_revision, desiredIdentityId: row.desired_identity,
      appliedRevision: row.applied_revision, appliedIdentityId: row.applied_identity,
      runtimeId: row.runtime_id, confirmationPhase:row.confirmation_phase,
      verified: row.confirmation_phase==='runtime' && row.runtime_id !== null && row.runtime_id === row.applied_runtime_id,
      pending: row.desired_revision > row.applied_revision,
      errorCode: row.error_code,
    };
  }

  requestSwitch(threadId, identityId, expectedRevision, nativeRevision = null) {
    identifier(threadId); identifier(identityId);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new TypeError('Invalid revision');
    if (nativeRevision !== null && (!Number.isSafeInteger(nativeRevision) || nativeRevision < 0)) throw new TypeError('Invalid native revision');
    return this.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO bindings(thread_id) VALUES (?)').run(threadId);
      const current = this.read(threadId);
      if (current.desiredRevision !== expectedRevision) throw new BindingConflict('Identity selection changed; refresh before switching');
      if (current.desiredIdentityId === identityId && current.pending && !current.errorCode) return current;
      const revision = expectedRevision + 1;
      this.db.prepare('INSERT INTO identity_changes(thread_id, revision, identity_id, native_revision) VALUES (?,?,?,?)').run(threadId, revision, identityId, nativeRevision);
      this.db.prepare('UPDATE bindings SET desired_revision=?, desired_identity=?, error_code=NULL WHERE thread_id=?').run(revision, identityId, threadId);
      return this.read(threadId);
    });
  }

  pendingRequests() {
    return this.db.prepare('SELECT thread_id FROM bindings WHERE desired_revision > applied_revision AND error_code IS NULL').all().map(x=>{
      const state=this.read(x.thread_id);
      const change=this.db.prepare('SELECT native_revision FROM identity_changes WHERE thread_id=? AND revision=?').get(state.threadId,state.desiredRevision);
      return {...state,nativeRevision:change.native_revision};
    });
  }

  cancel(threadId, expectedRevision) {
    identifier(threadId);
    return this.transaction(()=>{
      const state=this.read(threadId);
      if(state.desiredRevision!==expectedRevision)throw new BindingConflict('Identity request changed');
      if(!state.pending||state.errorCode)throw new BindingConflict('Identity request already finished');
      this.db.prepare("UPDATE bindings SET error_code='cancelled' WHERE thread_id=?").run(threadId);
      return this.read(threadId);
    });
  }

  // Only the authenticated runtime bridge may call these methods, never browser input.
  attachRuntime(threadId, runtimeId, expectedRuntimeId = null) {
    identifier(threadId); identifier(runtimeId);
    if (expectedRuntimeId !== null) identifier(expectedRuntimeId);
    return this.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO bindings(thread_id) VALUES (?)').run(threadId);
      const current = this.read(threadId);
      if (current.runtimeId !== expectedRuntimeId) throw new BindingConflict('Runtime ownership changed');
      this.db.prepare('UPDATE bindings SET runtime_id=? WHERE thread_id=?').run(runtimeId, threadId);
      return this.read(threadId);
    });
  }

  acknowledge(threadId, runtimeId, revision, identityId, phase='runtime') {
    identifier(threadId); identifier(runtimeId); identifier(identityId);
    if (!Number.isSafeInteger(revision) || revision < 1) throw new TypeError('Invalid revision');
    if(!['runtime','configured'].includes(phase))throw new TypeError('Invalid confirmation phase');
    return this.transaction(() => {
      const current = this.read(threadId);
      if (current.runtimeId !== runtimeId) throw new BindingConflict('Acknowledgement belongs to another runtime');
      if (revision < current.appliedRevision) throw new BindingConflict('Stale acknowledgement');
      const request = this.db.prepare('SELECT identity_id FROM identity_changes WHERE thread_id=? AND revision=?').get(threadId, revision);
      if (!request || request.identity_id !== identityId) throw new BindingConflict('Acknowledgement does not match a recorded request');
      // A newer request can coexist with acknowledgement of a captured older turn.
      this.db.prepare('UPDATE bindings SET applied_revision=?, applied_identity=?, applied_runtime_id=?, confirmation_phase=?, error_code=CASE WHEN desired_revision=? THEN NULL ELSE error_code END WHERE thread_id=?').run(revision, identityId, runtimeId, phase, revision, threadId);
      return this.read(threadId);
    });
  }

  reject(threadId, runtimeId, revision, errorCode) {
    identifier(threadId); identifier(runtimeId);
    const allowed = new Set(['identity_missing', 'credentials_unavailable', 'model_unavailable', 'policy_denied', 'runtime_unavailable']);
    if (!allowed.has(errorCode)) throw new TypeError('Unsupported public error code');
    return this.transaction(() => {
      const current = this.read(threadId);
      if (current.runtimeId !== runtimeId || current.desiredRevision !== revision || revision <= current.appliedRevision) throw new BindingConflict('Failure belongs to an obsolete request');
      this.db.prepare('UPDATE bindings SET error_code=? WHERE thread_id=?').run(errorCode, threadId);
      return this.read(threadId);
    });
  }
}

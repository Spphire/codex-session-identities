'use strict';

// Native RPC identifiers. Panel database keys also include historical aliases;
// do not use these narrower validators for BindingStore's persisted keys.
const validThreadId = value => typeof value === 'string'
  && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const validProfileId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const validRevision = value => Number.isSafeInteger(value) && value >= 0;

module.exports = {validThreadId, validProfileId, validRevision};

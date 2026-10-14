'use strict';
const validVersion = value => typeof value==='string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value) && !/^0\.0\.0(?:-|$)/.test(value);
function initializeResult(result,installedVersion){
  if(!validVersion(installedVersion)||typeof result?.userAgent!=='string')return result;
  // Desktop derives backend capabilities from this prefix. Keep the client suffix intact.
  return {...result,userAgent:result.userAgent.replace(/^([^/\r\n]+\/)0\.0\.0(?=\s|\()/,`$1${installedVersion}`)};
}
module.exports={validVersion,initializeResult};

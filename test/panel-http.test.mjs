import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {hasPanelAccess,isPanelJsonRequest,readJsonBody,readRequestBody} from '../panel-http.mjs';

test('bounded JSON reads preserve a multibyte character split across network chunks',async()=>{
  const bytes=Buffer.from(JSON.stringify({name:'身份',model:'fixture'}));
  const cut=bytes.indexOf(Buffer.from('身份'))+1;
  assert.deepEqual(await readJsonBody(Readable.from([bytes.subarray(0,cut),bytes.subarray(cut)]),bytes.length),{name:'身份',model:'fixture'});
  await assert.rejects(()=>readRequestBody(Readable.from([bytes.subarray(0,cut),bytes.subarray(cut)]),bytes.length-1),error=>error.statusCode===413&&error.message==='请求过大');
  await assert.rejects(()=>readJsonBody(Readable.from([Buffer.from('{')]),4096),SyntaxError);
});
test('HTTP token and same-origin requirements remain independent',()=>{
  const token='a'.repeat(64),req={headers:{'x-codex-identity-access':token,origin:'http://127.0.0.1:18189','content-type':'application/json; charset=utf-8'}};
  assert.equal(hasPanelAccess(req,token),true);assert.equal(isPanelJsonRequest(req,'127.0.0.1:18189'),true);
  assert.equal(hasPanelAccess(req,'b'.repeat(64)),false);
  assert.equal(hasPanelAccess({headers:{}},token),false);
  assert.equal(isPanelJsonRequest({...req,headers:{...req.headers,origin:'http://other.invalid'}},'127.0.0.1:18189'),false);
});

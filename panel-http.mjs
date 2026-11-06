import {timingSafeEqual} from 'node:crypto';

/** Shared HTTP boundary rules for the local identity panel. */
export function writeJson(res,status,data){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(data));
}

export function hasPanelAccess(req,accessToken){
  const supplied=Buffer.from(String(req.headers['x-codex-identity-access']||''));
  const expected=Buffer.from(accessToken||'');
  return supplied.length===expected.length&&timingSafeEqual(supplied,expected);
}

export function isPanelJsonRequest(req,host){
  return req.headers.origin===`http://${host}`&&req.headers['content-type']?.startsWith('application/json');
}

export async function readRequestBody(req,maxBytes){
  const chunks=[];let size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>maxBytes){
      const error=new Error('请求过大');
      error.statusCode=413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJsonBody(req,maxBytes){
  const body=(await readRequestBody(req,maxBytes)).toString('utf8');
  return JSON.parse(body);
}

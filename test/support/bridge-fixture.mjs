import {copyFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,dirname,basename} from 'node:path';

// Copy the adapter's actual static dependency closure, including conditional
// require() dependencies, instead of maintaining lists in every smoke fixture.
export async function copyBridgeFixture(destination,extras=[]){
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const visited=new Set();
  async function copy(name){
    if(visited.has(name))return;visited.add(name);
    const source=join(root,name);
    await copyFile(source,join(destination,name));
    const text=await readFile(source,'utf8');
    for(const match of text.matchAll(/(?:require|import)\(['"](\.\/[^'"]+)['"]\)/g)){
      if(dirname(match[1])!=='.')throw new Error('Fixture dependency must remain a sibling file');
      await copy(basename(match[1]));
    }
  }
  for(const name of ['runtime-bridge.cjs',...extras])await copy(name);
}

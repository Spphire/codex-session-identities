import {mkdir,readFile,writeFile,rename,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {StdioClient} from './stdio-client.mjs';

export class OfficialLogin {
  constructor(home,executable,Client=StdioClient){this.home=home;this.executable=executable;this.Client=Client;this.state={status:'idle'};}
  view(){return {...this.state};}
  async start(){
    if(this.client)throw new Error('已有登录正在进行，请完成或取消');
    if(!this.executable)throw new Error('未配置原版 CLI，请重新安装');
    this.directory=join(this.home,'session-identities','login-'+randomUUID());
    await mkdir(this.directory,{recursive:true});
    await writeFile(join(this.directory,'config.toml'),'cli_auth_credentials_store = "file"\n');
    this.client=new this.Client(this.executable,['app-server','--stdio'],{cwd:this.directory,env:{...process.env,CODEX_HOME:this.directory}});
    this.state={status:'starting'};
    try{
      await this.client.initialize('identity_panel_login');
      const result=await this.client.call('account/login/start',{type:'chatgptDeviceCode'});
      const url=new URL(result.verificationUrl);
      if(url.protocol!=='https:'||url.hostname!=='auth.openai.com'||typeof result.userCode!=='string')throw new Error('Invalid device response');
      this.loginId=result.loginId;
      this.state={status:'waiting',verificationUrl:url.href,userCode:result.userCode};
      this.timer=setInterval(()=>void this.poll(),1000);this.timer.unref();
      this.expiry=setTimeout(()=>void this.cancel('expired'),15*60*1000);this.expiry.unref();
      return this.view();
    }catch{await this.cleanup();this.state={status:'failed',error:'设备登录启动失败，请确认账号已启用设备代码登录后重试'};return this.view();}
  }
  async poll(){
    if(this.polling||!this.client)return;this.polling=true;
    try{
      const event=this.client.events.find(x=>x.method==='account/login/completed'&&x.params?.loginId===this.loginId);
      if(!event)return;
      if(!event.params.success)throw new Error('Login failed');
      const auth=JSON.parse(await readFile(join(this.directory,'auth.json'),'utf8'));
      const claims=JSON.parse(Buffer.from(auth.tokens.id_token.split('.')[1],'base64url').toString('utf8'));
      const accountId=auth.tokens.account_id;const userId=claims['https://api.openai.com/auth']?.chatgpt_user_id||claims['https://api.openai.com/auth']?.user_id;
      if(auth.auth_mode!=='chatgpt'||!accountId||!userId)throw new Error('Invalid account');
      const root=join(this.home,'session-identities','profiles');await mkdir(root,{recursive:true});
      let duplicate=false;
      for(const id of await readdir(root)){
        try{const profile=JSON.parse(await readFile(join(root,id,'profile.json'),'utf8'));if(profile.accountId===accountId&&profile.userId===userId)duplicate=true;}catch{}
      }
      if(duplicate){this.state={status:'duplicate',error:'该账号已有身份档案，请使用已有身份；如已移除，请先恢复'};await this.cleanup();return;}
      const id='chatgpt_'+randomUUID();
      await writeFile(join(this.directory,'profile.json'),JSON.stringify({kind:'chatgpt',accountId,userId,providerId:'identity_'+id.replaceAll('-','_'),provider:{name:'OpenAI',base_url:'https://chatgpt.com/backend-api/codex',wire_api:'responses',requires_openai_auth:true}}));
      await writeFile(join(this.directory,'label.json'),JSON.stringify({name:typeof claims.email==='string'?claims.email:'独立官方账号'}));
      await this.stopClient();
      await rename(this.directory,join(root,id));this.directory=null;
      this.state={status:'completed',name:typeof claims.email==='string'?claims.email:'独立官方账号'};await this.cleanup();
    }catch{this.state={status:'failed',error:'官方登录未完成，请重试'};await this.cleanup();}
    finally{this.polling=false;}
  }
  async stopClient(){const client=this.client;this.client=null;if(process.platform==='win32'&&client?.child?.pid&&client.child.exitCode===null&&!client.child.signalCode)spawnSync('taskkill',['/PID',String(client.child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await client?.close();}
  async cleanup(){clearInterval(this.timer);clearTimeout(this.expiry);await this.stopClient();if(this.directory){const directory=this.directory;await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:200});this.directory=null;}}
  async cancel(status='cancelled'){if(this.polling)throw new Error('登录正在保存，请稍后');await this.cleanup();this.state={status};return this.view();}
}

import net from 'node:net';

const port=Number(process.argv[2]||19091);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid proxy port');
const server=net.createServer(socket=>{
  socket.setTimeout(15000);
  let buffer=Buffer.alloc(0),connected=false,target=null;
  const fail=(status,message)=>{if(!socket.destroyed){socket.write(`HTTP/1.1 ${status}\r\nContent-Length: ${Buffer.byteLength(message)}\r\nConnection: close\r\n\r\n${message}`);socket.destroy();}};
  socket.on('data',chunk=>{
    if(connected)return;
    buffer=Buffer.concat([buffer,chunk]);
    if(buffer.length>32768){fail('431 Request Header Fields Too Large','header too large');return;}
    const end=buffer.indexOf('\r\n\r\n');if(end<0)return;
    const header=buffer.subarray(0,end).toString('latin1');const first=header.split('\r\n',1)[0].split(' ');
    if(first[0]!=='CONNECT'||!/^\S+:\d{1,5}$/.test(first[1]||'')){fail('405 Method Not Allowed','CONNECT required');return;}
    const separator=first[1].lastIndexOf(':');const host=first[1].slice(0,separator);const targetPort=Number(first[1].slice(separator+1));
    if(!host||targetPort<1||targetPort>65535){fail('400 Bad Request','invalid target');return;}
    target=net.connect({host,port:targetPort});target.once('connect',()=>{
      connected=true;socket.setTimeout(0);socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      const remainder=buffer.subarray(end+4);if(remainder.length)target.write(remainder);
      socket.pipe(target);target.pipe(socket);
    });
    target.once('error',()=>fail('502 Bad Gateway','upstream connection failed'));
    target.once('close',()=>socket.destroy());
  });
  socket.once('timeout',()=>fail('408 Request Timeout','header timeout'));
  socket.once('error',()=>target?.destroy());
});
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({ready:true,port})));
const stop=()=>server.close(()=>process.exit(0));process.once('SIGTERM',stop);process.once('SIGINT',stop);

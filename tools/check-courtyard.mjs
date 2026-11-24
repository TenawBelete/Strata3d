// Run against an isolated Chrome started with --remote-debugging-port=9296.
import {mkdir, writeFile} from 'node:fs/promises';
import {setTimeout as wait} from 'node:timers/promises';

const debuggerOrigin=process.env.CHROME_DEBUG_URL || 'http://127.0.0.1:9296';
const origin=process.env.STRATA_URL || 'http://127.0.0.1:8001/';
const page=new URL('panaderia.html?mode=run&present=1',origin).href;
const target=await (await fetch(debuggerOrigin+'/json/new?'+encodeURIComponent(page),{method:'PUT'})).json();
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve=>socket.onopen=resolve);
const pending=new Map(), errors=[];
let sequence=0;
socket.onmessage=event=>{
  const message=JSON.parse(event.data);
  if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);
  if(message.method==='Log.entryAdded' && message.params.entry.level==='error')errors.push(message.params.entry.text+' '+(message.params.entry.url||''));
  pending.get(message.id)?.(message);
  pending.delete(message.id);
};
function call(method,params={}){
  const id=++sequence;
  return new Promise((resolve,reject)=>{
    pending.set(id,msg=>msg.error?reject(Error(msg.error.message)):resolve(msg.result));
    socket.send(JSON.stringify({id,method,params}));
  });
}
const evaluate=async expression=>(await call('Runtime.evaluate',{expression,returnByValue:true})).result.value;
try {
  await call('Runtime.enable');await call('Log.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:page+'&hour=12&rain=0'});
  let ready=false;
  for(let i=0;i<120&&!ready;i++){
    await wait(250);
    ready=await evaluate("document.querySelector('#conditions')?.hidden===false");
  }
  if(!ready)throw Error('Courtyard did not become ready: '+errors.join(', '));
  const directory=new URL('../output/courtyard-conditions/',import.meta.url);
  await mkdir(directory,{recursive:true});
  async function capture(name){
    await wait(200);
    const {data}=await call('Page.captureScreenshot',{format:'jpeg',quality:90});
    await writeFile(new URL(name+'.jpg',directory),Buffer.from(data,'base64'));
    const measure=await call('Runtime.evaluate',{
      expression:`(async()=>{
        const img=new Image();img.src='data:image/jpeg;base64,${data}';await img.decode();
        const canvas=document.createElement('canvas');canvas.width=64;canvas.height=36;
        const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,64,36);
        const rgba=ctx.getImageData(0,0,64,36).data;let light=0;
        for(let i=0;i<rgba.length;i+=4)light+=.2126*rgba[i]+.7152*rgba[i+1]+.0722*rgba[i+2];
        return light/(64*36);
      })()`,awaitPromise:true,returnByValue:true
    });
    return measure.result.value;
  }
  const day=await capture('day');
  await evaluate("document.querySelector('[name=hour]').value=0;document.querySelector('[name=hour]').dispatchEvent(new Event('input',{bubbles:true}))");
  const night=await capture('night');
  if(!(day>30 && night>2 && night<day*.72))throw Error('Day/night rendering regression: '+day+' / '+night);
  await evaluate("document.querySelector('[name=rain]').value=8;document.querySelector('[name=rain]').dispatchEvent(new Event('input',{bubbles:true}))");
  await capture('night-rain');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight'});
  await wait(1800);
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight'});
  await capture('turn');
  if(errors.length)throw Error(errors.join('\n'));
  console.log('Captured day, midnight, rain and turn in '+directory.pathname);
}finally{
  socket.close();
  await fetch(debuggerOrigin+'/json/close/'+target.id);
}

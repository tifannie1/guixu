import {spawn,spawnSync} from 'node:child_process';
const port=4173, url='http://127.0.0.1:'+port+'/';
function open(){
  if(process.platform!=='win32')return;
  spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,stdio:'ignore'}).unref();
}
async function ready(){
  try{const res=await fetch(url,{signal:AbortSignal.timeout(700)});return res.ok&&(await res.text()).includes('归序 · 个人资料中心');}catch{return false;}
}
if(await ready()){open();process.exit(0);}
const build=spawnSync(process.execPath,['scripts/build.mjs'],{stdio:'inherit'});
if(build.status!==0)process.exit(build.status??1);
const child=spawn(process.execPath,['scripts/local.mjs',String(port)],{stdio:'inherit'});
let exited=false;
child.on('exit',code=>{exited=true;process.exitCode=code??0;});
for(let i=0;i<24&&!exited;i++){
  if(await ready()){open();console.log('Keep this window open while using the library.');break;}
  if(i===23){child.kill();process.exitCode=1;break;}
  await new Promise(resolve=>setTimeout(resolve,250));
}
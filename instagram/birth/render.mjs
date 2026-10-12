import {chromium} from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';import path from 'node:path';import {execSync} from 'node:child_process';
const here=path.dirname(new URL(import.meta.url).pathname);
const FPS=24,DUR=5,N=8;
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--allow-file-access-from-files']});
const p=await b.newPage({viewport:{width:1080,height:1350}});
await p.goto('file://'+here+'/carousel.html');await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(600);
fs.mkdirSync(here+'/out',{recursive:true});fs.mkdirSync(here+'/frames',{recursive:true});
// crop viewport to one slide at a time by scrolling the pano via a wrapper transform
for(let s=+(process.argv[2]||0);s<N;s++){
  await p.evaluate(s=>{document.querySelectorAll('.s').forEach((e,i)=>e.style.display=i===s?'flex':'none')},s);
  const dir=`${here}/frames/s${s+1}`;fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir,{recursive:true});
  for(let f=0;f<FPS*DUR;f++){
    const t=f/FPS*1000;
    await p.evaluate(t=>document.getAnimations().forEach(a=>{a.pause();a.currentTime=t}),t);
    await p.screenshot({path:`${dir}/${String(f).padStart(3,'0')}.jpg`,type:'jpeg',quality:92,clip:{x:0,y:0,width:1080,height:1350}});
  }
  await p.screenshot({path:`${here}/out/slide-${String(s+1).padStart(2,'0')}.png`,clip:{x:0,y:0,width:1080,height:1350}});
  execSync(`ffmpeg -y -loglevel error -framerate ${FPS} -i ${dir}/%03d.jpg -c:v libx264 -pix_fmt yuv420p -crf 18 -movflags +faststart ${here}/out/slide-${String(s+1).padStart(2,'0')}.mp4`);
  fs.rmSync(dir,{recursive:true,force:true});console.log('slide',s+1);
}
await b.close();

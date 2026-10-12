import {chromium} from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';import path from 'node:path';
const here=path.dirname(new URL(import.meta.url).pathname);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--allow-file-access-from-files']});
const p=await b.newPage({viewport:{width:1080,height:1350},deviceScaleFactor:1});
await p.goto('file://'+here+'/carousel.html');await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(800);
fs.mkdirSync(here+'/slides',{recursive:true});
for(let i=0;i<9;i++){await p.screenshot({path:`${here}/slides/slide-${String(i+1).padStart(2,'0')}.png`,clip:{x:i*1080,y:0,width:1080,height:1350},fullPage:true});}
await p.screenshot({path:here+'/slides/panorama-preview.png',clip:{x:0,y:0,width:9720,height:1350},fullPage:true});
await b.close();console.log('done');

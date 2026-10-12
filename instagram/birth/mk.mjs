import {chromium} from '/opt/node-tools/node_modules/playwright/index.mjs';
const A='stroke="#3a3a48" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"';
const T='#b8ebe3',P='#ffd9c9',C='#fff3d6',W='#fff8f2';
const items={
bulb:`<path d="M60 14 C38 14 26 30 26 48 C26 62 36 68 40 80 L80 80 C84 68 94 62 94 48 C94 30 82 14 60 14Z" fill="${C}" ${A}/><path d="M42 88 L78 88 M46 97 L74 97" ${A}/><path d="M60 80 L60 58 M50 50 L60 58 L70 50" fill="none" ${A} stroke-width="2.6"/><path d="M60 4 L60 -2 M20 18 L14 12 M100 18 L106 12 M10 46 L2 46 M110 46 L118 46" ${A} stroke-width="2.6"/><circle cx="46" cy="34" r="5" fill="#fff" stroke="none"/>`,
dress:`<path d="M60 20 C60 12 70 10 70 18 C70 24 62 24 60 30" fill="none" ${A}/><path d="M22 44 L60 28 L98 44" fill="none" ${A}/><path d="M48 56 C52 50 56 48 60 48 C64 48 68 50 72 56 L78 70 L102 98 L18 98 L42 70 Z" fill="${P}" ${A}/><path d="M42 70 L78 70" ${A} stroke-width="2.4"/><circle cx="60" cy="82" r="3" fill="#3a3a48"/><path d="M92 20 L92 36 M84 28 L100 28" ${A} stroke-width="2.6"/><path d="M16 70 L16 80 M11 75 L21 75" ${A} stroke-width="2.4"/>`,
stage:`<path d="M28 100 L92 100 L100 86 L20 86 Z" fill="${T}" ${A}/><path d="M60 8 L60 24" ${A}/><path d="M44 26 L76 26 L70 40 L50 40 Z" fill="${C}" ${A}/><path d="M50 40 L22 86 M70 40 L98 86" fill="none" stroke="#f5c97a" stroke-width="3" stroke-dasharray="2 8" stroke-linecap="round"/><path d="M60 58 C62 66 68 66 70 70 C66 72 62 76 60 82 C58 76 54 72 50 70 C54 66 58 66 60 58Z" fill="${P}" ${A} stroke-width="2.4"/>`,
umbrella:`<path d="M12 56 C12 30 34 14 60 14 C86 14 108 30 108 56 C98 50 90 50 84 56 C78 50 68 50 60 56 C52 50 42 50 36 56 C30 50 20 50 12 56Z" fill="${P}" ${A}/><path d="M60 14 L60 4 M60 56 L60 92 C60 100 50 102 48 94" fill="none" ${A}/><path d="M36 56 C38 40 46 24 60 14 M84 56 C82 40 74 24 60 14" fill="none" ${A} stroke-width="2.2"/><path d="M96 74 C96 70 102 68 104 72 C106 68 112 70 112 74 C112 80 104 84 104 86 C104 84 96 80 96 74Z" fill="${T}" ${A} stroke-width="2.4"/>`,
flag:`<path d="M10 100 C26 78 40 58 58 50 C72 44 84 40 100 38 L112 100 Z" fill="${T}" ${A}/><path d="M64 48 L64 6" ${A}/><path d="M64 8 C78 4 84 14 100 10 L100 28 C84 32 78 22 64 26 Z" fill="${P}" ${A}/><path d="M24 20 L24 32 M18 26 L30 26" ${A} stroke-width="2.6"/><path d="M104 56 L104 66 M99 61 L109 61" ${A} stroke-width="2.4"/>`,
egg:`<path d="M60 8 C36 8 22 40 22 64 C22 88 38 104 60 104 C82 104 98 88 98 64 C98 40 84 8 60 8Z" fill="${W}" ${A}/><path d="M24 62 L38 52 L48 66 L60 50 L72 66 L84 52 L96 62" fill="${P}" ${A}/><path d="M36 62 C36 54 44 52 48 58 C52 52 60 54 60 62 C60 70 48 74 48 78 C48 74 36 70 36 62Z" fill="${T}" ${A} stroke-width="2.4" transform="translate(22 4)"/><path d="M104 20 L104 34 M97 27 L111 27 M10 30 L10 40 M5 35 L15 35" ${A} stroke-width="2.6"/>`,
sprout:`<path d="M34 78 L86 78 L80 104 L40 104 Z" fill="${P}" ${A}/><path d="M60 78 C60 60 60 46 60 36" fill="none" ${A}/><path d="M60 52 C42 54 30 44 28 28 C46 26 58 36 60 52Z" fill="${T}" ${A}/><path d="M60 42 C78 44 90 34 92 18 C74 16 62 26 60 42Z" fill="${T}" ${A}/><path d="M16 20 L16 32 M10 26 L22 26" ${A} stroke-width="2.6"/><circle cx="100" cy="64" r="3" fill="#3a3a48"/>`
};
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:900,height:900}});
for(const [n,body] of Object.entries(items)){
 await p.setContent(`<body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -10 132 124" width="900" height="900" fill="none">${body}</svg></body>`);
 await p.screenshot({path:`dd/${n}.png`,omitBackground:true});
}
await b.close();

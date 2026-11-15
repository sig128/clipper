// End-to-end walk-through of the GTA build. Each step is isolated so one failure doesn't hide the rest.
const fs=require('fs'),path=require('path'),{execSync}=require('child_process'),{chromium}=require('playwright');
const DIR=__dirname,OUT=path.join(DIR,'e2e4-out');fs.mkdirSync(OUT,{recursive:true});
const body=fs.readFileSync(path.join(DIR,'..','artifact-body.html'),'utf8');
fs.writeFileSync(path.join(DIR,'_v4.html'),`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${body}</body></html>`);
const URL='file://'+path.join(DIR,'_v4.html');
const R=[];const ok=(n,v,d='')=>{R.push((v?'PASS ':'FAIL ')+n+(d?'  — '+d:''));console.log(R[R.length-1])};
const ONLY=process.argv[2]||'';
(async()=>{
 const b=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});
 const errs=[];
 const ctx=await b.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,acceptDownloads:true});
 const p=await ctx.newPage();
 p.on('pageerror',e=>errs.push('pageerror: '+e.message));
 p.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text())});
 const step=async(n,f)=>{if(ONLY&&!n.toLowerCase().includes(ONLY))return;try{await f()}catch(e){ok(n,false,e.message.split('\n')[0])}};
 await p.goto(URL);await p.waitForSelector('.cc');
 const perf=await p.evaluate(()=>{const f=performance.getEntriesByName('first-contentful-paint')[0];return f?Math.round(f.startTime):null});
 ok('Home renders with the launch bar',await p.isVisible('#launchbar'),`first paint ${perf}ms`);
 await p.screenshot({path:OUT+'/home.png'});

 await step('Clips: GTA filter and search',async()=>{
  await p.click('a.nav-i[data-k="clips"]');await p.waitForSelector('#cgrid');
  await p.click('.chip[data-k="gta"]');await p.waitForTimeout(80);const g=await p.$$eval('#cgrid .cc',e=>e.filter(x=>!x.hidden).map(x=>x.dataset.id));
  await p.click('.chip[data-k="all"]');await p.fill('#cq','harbor');await p.waitForTimeout(150);const q=await p.$$eval('#cgrid .cc',e=>e.filter(x=>!x.hidden).map(x=>x.dataset.id));await p.fill('#cq','');
  ok('Clips: GTA filter and search',g.length===6&&g.every(id=>id.startsWith('g'))&&q.join()==='g1',`gta=${g} harbor→${q}`);
 });
 await step('Editor opens on the Hook tab with checks',async()=>{
  await p.evaluate(()=>openEditor('g1'));await p.waitForSelector('#ed');await p.waitForTimeout(300);
  const st=await p.evaluate(()=>({side:ED.side,hook:ED.hook.text,game:ED.game,cnt:$('#chkb .cnt').textContent,flags:checksFor(ED.c).map(f=>f.k)}));
  await p.screenshot({path:OUT+'/editor_hook.png'});
  ok('Editor opens on the Hook tab with checks',st.side==='hook'&&st.hook&&st.game==='gta5'&&st.cnt==='1'&&st.flags.join()==='radio',JSON.stringify(st));
 });
 await step('Hook overlay is drawn on the preview',async()=>{
  const d=await p.evaluate(()=>{const grab=()=>{seekU(.6);const cv=ED.pv,x=cv.getContext('2d'),y=Math.round(cv.height*.13);return Array.from(x.getImageData(0,y-6,cv.width,12).data)};const a=grab(),t=ED.hook.text;ED.hook.text='';const b=grab();ED.hook.text=t;drawPreview();let diff=0;for(let i=0;i<a.length;i++)diff+=Math.abs(a[i]-b[i]);return diff/a.length});
  ok('Hook overlay is drawn on the preview',d>3,`avg pixel difference ${d.toFixed(1)}`);
 });
 await step('Fix a check from the checks sheet',async()=>{
  await p.click('#chkb');await p.waitForSelector('#chkbody');await p.screenshot({path:OUT+'/checks.png'});
  await p.click('#chkbody [data-k="fxRadio"]');await p.waitForTimeout(150);
  const st=await p.evaluate(()=>({radio:ED.aud.radio,cnt:$('#chkb .cnt').textContent,body:$('#chkbody').textContent.slice(0,40)}));
  await p.keyboard.press('Escape');
  ok('Fix a check from the checks sheet',st.radio===true&&st.cnt===''&&/All clear/.test(st.body),JSON.stringify(st));
 });
 await step('Undo restores the radio flag',async()=>{
  await p.evaluate(()=>undo());const a=await p.evaluate(()=>({radio:ED.aud.radio,cnt:$('#chkb .cnt').textContent}));await p.evaluate(()=>redo());const b2=await p.evaluate(()=>ED.aud.radio);
  ok('Undo restores the radio flag',a.radio===false&&a.cnt==='1'&&b2===true,JSON.stringify(a));
 });
 await step('Render speed with the GTA scenes',async()=>{
  const ms=await p.evaluate(()=>{const N=60,t=performance.now();for(let i=0;i<N;i++){ED.u=i/N*ED.outDur;drawPreview()}return(performance.now()-t)/N});
  ok('Render speed with the GTA scenes',ms<8,`${ms.toFixed(2)} ms per preview frame`);
 });
 await step('GTA preset on a fresh clip',async()=>{
  await p.evaluate(()=>openEditor('g4'));await p.waitForTimeout(250);
  const before=await p.evaluate(()=>checksFor(ED.c).map(f=>f.k).join());
  await p.click('[data-a="gtaPreset"]');await p.waitForTimeout(150);
  const after=await p.evaluate(()=>({flags:checksFor(ED.c).map(f=>f.k).join(),hook:ED.hook.text,loop:ED.loop,ver:ED.ver,layout:ED.st.layout}));
  ok('GTA preset on a fresh clip',before==='orig,rights'&&after.flags==='rights'&&after.hook&&after.loop&&after.ver==='payoff'&&after.layout==='stack',before+' → '+JSON.stringify(after));
 });
 await step('Permission fix through the menu',async()=>{
  await p.click('#chkb');await p.waitForSelector('#chkbody [data-k="fxRights"]');await p.click('#chkbody [data-k="fxRights"]');await p.waitForSelector('.menu');
  await p.click('.menu [data-k="partner"]');await p.waitForTimeout(120);const s=await p.evaluate(()=>({rights:srcOf(findClip('g4')).rights,flags:checksFor(findClip('g4')).map(f=>f.k).join()}));
  await p.keyboard.press('Escape');ok('Permission fix through the menu',s.rights==='partner'&&s.flags==='',JSON.stringify(s));
 });
 await step('7-second check and its fix',async()=>{
  const r=await p.evaluate(()=>{const c=findClip('g3'),a=checksFor(c,{plat:'yt'}).map(f=>f.k).join(),tt=checksFor(c,{plat:'tt'}).map(f=>f.k).join();applyFix(c,'fxYtOrder');return{a,tt,b:checksFor(c,{plat:'yt'}).map(f=>f.k).join(),ver:cutFor(c,'yt').ver}});
  ok('7-second check and its fix',r.a==='open7'&&r.tt===''&&r.b===''&&r.ver==='chrono',JSON.stringify(r));
 });
 await step('Cutscene and spoiler flags block planning',async()=>{
  const r=await p.evaluate(()=>{const c=findClip('g5'),F=checksFor(c);S.ready.add('g5');const acc=NET.accounts[0],d=new Date();d.setDate(d.getDate()+2);const pc=placeCheck(c,'yt',acc,atOf(d,'12:00'));return{flags:F.map(f=>f.k+':'+f.sev).join(),fix:F.find(f=>f.k==='cutscene').fx.map(x=>x[1]).join(),ok:pc.ok,why:pc.blk}});
  ok('Cutscene and spoiler flags block planning',r.flags==='cutscene:high,spoiler:high'&&r.fix==='fxCutOk'&&!r.ok,JSON.stringify(r));
 });
 await step('Launch lock keeps GTA VI after unlock',async()=>{
  const r=await p.evaluate(()=>{const c=findClip('g6'),acc=NET.accounts[0];return{before:placeCheck(c,'yt',acc,'2026-11-18T11:00').blk.join(' | '),after:placeCheck(c,'yt',acc,'2026-11-19T12:00').ok,lock:checksFor(c).map(f=>f.k+':'+f.sev).join()}});
  ok('Launch lock keeps GTA VI after unlock',/before launch/.test(r.before)&&r.after&&r.lock==='launch:lock',JSON.stringify(r));
 });
 await step('Plan: auto-fill, no duplicates, launch lock',async()=>{
  await p.evaluate(()=>{S.ready.delete('g5');go('plan')});await p.waitForSelector('.pg');
  await p.click('[data-a="planAuto"]');await p.waitForTimeout(300);
  const r=await p.evaluate(()=>{const keys=NET.plan.map(e=>e.clip+'/'+e.plat),dup=keys.length!==new Set(keys).size,g6=NET.plan.filter(e=>e.clip==='g6').map(e=>e.at),bad=NET.plan.filter(e=>{const c=findClip(e.clip);return nHigh(checksFor(c,{plat:e.plat,when:dateOf(e.at)}))}).length;return{n:NET.plan.length,dup,g6,bad,filled:$$('.slot.fill').length}});
  await p.screenshot({path:OUT+'/plan.png'});
  ok('Plan: auto-fill, no duplicates, launch lock',r.n>=12&&!r.dup&&r.g6.length&&r.g6.every(a=>a>='2026-11-18T12:00')&&r.bad===0&&r.filled>=4,JSON.stringify(r));
 });
 await step('Plan: slot sheet and fill sheet',async()=>{
  await p.click('.slot.fill');await p.waitForSelector('#slotbody');const s=await p.evaluate(()=>({rows:$$('#slotbody .spl').length,kits:$$('#slotbody [data-a="entKit"]').length}));
  await p.screenshot({path:OUT+'/slot.png'});await p.keyboard.press('Escape');
  await p.click('.slot.empty');await p.waitForSelector('#slotbody');await p.click('#slotbody [data-a="slotFill"]');await p.waitForSelector('.cand');
  const f=await p.evaluate(()=>({cands:$$('.cand').length,enabled:$$('.cand [data-a="fillPick"]:not([disabled])').length,why:$$('.cand .why.bad').map(x=>x.textContent)}));
  await p.screenshot({path:OUT+'/fill.png'});await p.keyboard.press('Escape');await p.keyboard.press('Escape');
  ok('Plan: slot sheet and fill sheet',s.rows>=1&&s.kits>=1&&f.cands>=3,JSON.stringify({s,f}));
 });
 await step('Plan: limits meters follow the selected day',async()=>{
  const r=await p.evaluate(()=>{const v=()=>$$('.meter .mv b').map(b=>+b.textContent);const a=v();const i=weekDays().findIndex(isLaunch);S.planDay=i;rerenderPlan();const b=v();S.planDay=0;rerenderPlan();return{a,b}});
  ok('Plan: limits meters follow the selected day',r.a.length===4&&r.b.length===4,JSON.stringify(r));
 });
 await step('Plan survives a reload',async()=>{
  const n=await p.evaluate(()=>NET.plan.length);await p.reload();await p.waitForTimeout(500);const m=await p.evaluate(()=>({n:NET.plan.length,g1:checksFor(findClip('g1')).map(f=>f.k).join(),g4:srcOf(findClip('g4')).rights,g4hook:edView(findClip('g4')).hook.text}));
  ok('Plan, edits and permissions survive a reload',n>0&&n===m.n&&m.g1===''&&m.g4==='partner'&&!!m.g4hook,`${n} → ${JSON.stringify(m)}`);
 });
 await step('Settings: account times must be 2 hours apart',async()=>{
  await p.evaluate(()=>{S.setTab='accounts';go('config')});await p.waitForSelector('[data-a="accEdit"][data-id="a2"]');await p.click('[data-a="accEdit"][data-id="a2"]');await p.waitForSelector('#act');
  await p.fill('#act','15:00, 16:00');await p.click('[data-a="accSave"]');const e=await p.isVisible('#acerr');const et=e?await p.textContent('#acerr'):'';
  await p.fill('#act','10:00, 15:00, 19:30');await p.click('[data-a="accSave"]');await p.waitForTimeout(100);const s=await p.evaluate(()=>NET.accounts.find(a=>a.id==='a2').slots.join());
  ok('Settings: account times must be 2 hours apart',e&&/2 hours/.test(et)&&s==='10:00,15:00,19:30',`${et} · saved ${s}`);
 });
 await step('Drop a recording: moments found',async()=>{
  await p.evaluate(()=>go('home'));await p.waitForSelector('#file',{state:'attached'});
  await p.setInputFiles('#file',path.join(DIR,'gta_test_capture.webm'));
  await p.waitForFunction(()=>{const s=SOURCES.find(x=>x.local);return s&&s.moments},null,{timeout:90000});
  const r=await p.evaluate(()=>{const s=SOURCES.find(x=>x.local);return{n:s.moments.length,ts:s.moments.map(m=>Math.round(m.t)),lb:s.letterbox.map(([a,b])=>[Math.round(a),Math.round(b)]),why:s.moments.map(m=>m.why.join('+'))}});
  await p.evaluate(()=>momentsSheet(SOURCES.find(x=>x.local)));await p.waitForTimeout(200);await p.screenshot({path:OUT+'/moments.png'});
  const near=t=>r.ts.some(x=>Math.abs(x-t)<=8);
  ok('Drop a recording: moments found',near(56)&&near(150)&&r.lb.some(([a,b])=>a<=104&&b>=126),JSON.stringify(r));
 });
 await step('Make a clip from a moment and export a real file',async()=>{
  const i=await p.evaluate(()=>SOURCES.find(x=>x.local).moments.findIndex(m=>Math.abs(m.t-56)<=8));
  await p.click(`[data-a="momMake"][data-k="${i}"]`);await p.waitForSelector('#ed');await p.waitForTimeout(400);
  const c=await p.evaluate(()=>({id:ED.c.id,in:+ED.c.in.toFixed(1),dur:+ED.c.dur.toFixed(1),local:ED.local,flags:checksFor(ED.c).map(f=>f.k).join(),out:+ED.outDur.toFixed(1)}));
  await p.click('[data-a="gtaPreset"]');await p.waitForTimeout(100);
  await p.click('[data-a="export"]');await p.waitForSelector('#expbtn');
  await p.click('[data-a="expPick"][data-k="tt"]');
  const dl=p.waitForEvent('download',{timeout:120000});await p.click('#expbtn');const d=await dl;const fp=path.join(OUT,d.suggestedFilename());await d.saveAs(fp);
  const z=execSync(`python3 -c "import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print('|'.join(i.filename+':'+str(i.file_size) for i in z.infolist()));z.extractall(sys.argv[2])" "${fp}" "${OUT}/kit_local"`).toString().trim();
  const vid=fs.readdirSync(OUT+'/kit_local').find(f=>/\.(webm|mp4)$/.test(f));
  const pr=execSync(`ffprobe -v error -show_entries format=duration:stream=codec_type,width,height -of compact "${OUT}/kit_local/${vid}"`).toString().trim().replace(/\n/g,' ; ');
  await p.waitForTimeout(400);await p.screenshot({path:OUT+'/export_done.png'});
  const ready=await p.evaluate(id=>S.ready.has(id),c.id);
  ok('Make a clip from a moment and export a real file',c.local&&/caption\.txt/.test(z)&&/cover\.png/.test(z)&&/checklist\.txt/.test(z)&&/codec_type=video/.test(pr)&&/codec_type=audio/.test(pr)&&/width=1080\|height=1920/.test(pr)&&ready,JSON.stringify(c)+' · '+z+' · '+pr);
 });
 await step('Sample clip renders a real post kit from the plan',async()=>{
  await p.keyboard.press('Escape');await p.evaluate(()=>go('plan'));await p.waitForSelector('.pg');
  const at=await p.evaluate(()=>{const e=NET.plan.find(e=>e.clip==='g2'&&e.plat==='yt');return e&&{acc:e.acct,at:e.at,id:e.id}});
  await p.evaluate(a=>slotSheet(a.acc,a.at),at);await p.waitForSelector(`[data-a="entKit"][data-id="${at.id}"]`);
  const dl=p.waitForEvent('download',{timeout:120000});await p.click(`[data-a="entKit"][data-id="${at.id}"]`);const d=await dl;const fp=path.join(OUT,d.suggestedFilename());await d.saveAs(fp);
  execSync(`rm -rf "${OUT}/kit_s" && python3 -c "import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "${fp}" "${OUT}/kit_s"`);
  const vid=fs.readdirSync(OUT+'/kit_s').find(f=>/\.(webm|mp4)$/.test(f)),pr=execSync(`ffprobe -v error -show_entries format=duration:stream=width,height -of compact "${OUT}/kit_s/${vid}"`).toString().trim().replace(/\n/g,' ; ');
  const cap=fs.readFileSync(OUT+'/kit_s/caption.txt','utf8'),chk=fs.readFileSync(OUT+'/kit_s/checklist.txt','utf8');
  execSync(`ffmpeg -v error -y -ss 1 -i "${OUT}/kit_s/${vid}" -frames:v 1 "${OUT}/kit_s_frame.png"`);
  ok('Sample clip renders a real post kit from the plan',/width=1080\|height=1920/.test(pr)&&/Title/.test(cap)&&/#Shorts/.test(cap)&&/YouTube Studio/.test(chk),pr+' · '+cap.split('\n').slice(0,2).join(' / '));
 });
 await step('Phone: plan, editor and home fit the screen',async()=>{
  const ph=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});const q=await ph.newPage();q.on('pageerror',e=>errs.push('phone pageerror: '+e.message));
  await q.goto(URL+'#plan');await q.waitForTimeout(500);
  const r={};for(const h of ['plan','home','clips','edit-g1']){await q.evaluate(h=>{location.hash=h},h);await q.waitForTimeout(350);r[h]=await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&$('#page').scrollWidth<=$('#page').clientWidth+1)}
  await q.evaluate(()=>{location.hash='plan'});await q.waitForTimeout(300);const chips=await q.$$eval('.daychip',e=>e.length);await q.screenshot({path:OUT+'/phone_plan.png'});
  await q.evaluate(()=>{location.hash='edit-g1'});await q.waitForTimeout(400);await q.screenshot({path:OUT+'/phone_editor.png'});
  await ph.close();ok('Phone: plan, editor and home fit the screen',Object.values(r).every(Boolean)&&chips===7,JSON.stringify(r)+` daychips=${chips}`);
 });
 await step('Browser back and forward',async()=>{
  await p.evaluate(()=>go('clips'));await p.waitForTimeout(150);await p.evaluate(()=>openEditor('g2'));await p.waitForTimeout(250);await p.goBack();await p.waitForTimeout(250);
  const a=await p.evaluate(()=>({v:S.view,ed:ED.on}));await p.goForward();await p.waitForTimeout(300);const f=await p.evaluate(()=>({ed:ED.on,id:ED.c&&ED.c.id}));
  ok('Browser back and forward',a.v==='clips'&&!a.ed&&f.ed&&f.id==='g2',JSON.stringify({a,f}));
 });
 ok('No console errors',errs.length===0,errs.slice(0,6).join(' | '));
 fs.writeFileSync(OUT+'/results.txt',R.join('\n'));
 console.log(`\n${R.filter(r=>r.startsWith('PASS')).length}/${R.length} passed`);
 await b.close();
})();

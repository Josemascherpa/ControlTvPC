const {createServer}=require('node:http');
const {spawn}=require('node:child_process');
const {readFileSync,existsSync,mkdirSync,writeFileSync}=require('node:fs');
const {join,resolve,extname}=require('node:path');
const assert=require('node:assert/strict');
const {CdpClient}=require('../dist/src/infrastructure/edge/cdp-client');
const root=resolve(__dirname,'..');const delay=ms=>new Promise(r=>setTimeout(r,ms));
const keys=['trending_movies','popular_movies','popular_tv','new_releases','action_movies','comedy_movies','scifi_movies','thriller_movies'];
const rails=Object.fromEntries(keys.map((k,r)=>[k,{results:Array.from({length:20},(_,c)=>({id:r*20+c+1,type:'movie',title:`Película ${r+1}-${c+1}`,poster:`https://image.tmdb.org/t/p/w342/test-${r}-${c}.jpg`,backdrop:`https://image.tmdb.org/t/p/w780/test-${r}-${c}.jpg`,year:'2026',rating:8,overview:'Sinopsis de prueba para medir el catálogo en un televisor.'}))}]));
const fixture={success:true,hero:rails[keys[0]].results[0],rails};
(async()=>{
 const server=createServer((req,res)=>{let f=join(root,'ui',req.url==='/'?'index.html':req.url.split('?')[0]);if(!existsSync(f)){res.writeHead(404);return res.end()}res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.woff2':'font/woff2'})[extname(f)]||'application/octet-stream');res.end(readFileSync(f))});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const exe=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
 const profile=join(root,'work',`perf-${Date.now()}`);mkdirSync(profile,{recursive:true});
 const child=spawn(exe,['--headless=new','--remote-debugging-port=19449',`--user-data-dir=${profile}`,'--no-first-run','about:blank'],{windowsHide:true,stdio:'ignore'});let client;
 try{
 let v;for(let i=0;i<60&&!v;i++){await delay(100);v=await CdpClient.probe(19449)}assert.ok(v);
 client=await CdpClient.connect(v.webSocketDebuggerUrl);const {targetId}=await client.send('Target.createTarget',{url:'about:blank'});const {sessionId}=await client.send('Target.attachToTarget',{targetId,flatten:true});const send=(m,p)=>client.send(m,p,sessionId);
 const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 client.on('Fetch.requestPaused',({requestId,request})=>{const url=new URL(request.url);let body;let type='application/json';if(url.hostname==='api.framextv.xyz')body=Buffer.from(JSON.stringify(fixture));else if(url.hostname==='image.tmdb.org'){const w=Number(url.pathname.match(/\/w(\d+)\//)?.[1]||1280);type='image/svg+xml';body=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${Math.round(w*9/16)}"><rect width="100%" height="100%" fill="#203343"/><circle cx="150" cy="90" r="80" fill="#326b64"/></svg>`)}if(body)void send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:type},{name:'Access-Control-Allow-Origin',value:'*'}],body:body.toString('base64')});else void send('Fetch.failRequest',{requestId,errorReason:'Failed'})});
 await send('Fetch.enable',{patterns:[{urlPattern:'https://*'}]});await send('Performance.enable',{});
 const report=[];
 const optimized=(process.argv[2]||'').includes('optimized');
 for(const [width,height] of [[960,540],[1280,720],[1920,1080],[3840,2160]]){
 await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
 for(let i=0;i<100;i++){if(await ev('document.querySelectorAll(".rows .card").length===160 && document.activeElement.id==="heroPlay"'))break;await delay(50)}
 await delay(1000);
 const layout=await ev('(()=>{const r=document.querySelector(".rows-viewport").getBoundingClientRect();const a=document.getElementById("heroActions").getBoundingClientRect();return {rowsTop:r.top,heroBottom:a.bottom,gap:r.top-a.bottom}})()');
 if(optimized) assert.ok(layout.gap>=0 && layout.gap<=18,'Encabezado sin hueco sobrante');
 const rounds=[];
 for(let round=0;round<3;round++){
 await ev('window.__controlTvHome()');await delay(500);
 const m1=(await send('Performance.getMetrics',{})).metrics;
 const result=await ev(`new Promise(resolve=>{let n=0,last=performance.now(),samples=[];let start=last;const run=now=>{samples.push(now-last);last=now;if(now-start>=3000){resolve({frames:samples.length,p95:samples.sort((a,b)=>a-b)[Math.floor(samples.length*.95)],over33:samples.filter(v=>v>33).length});return}requestAnimationFrame(run)};requestAnimationFrame(run);const timer=setInterval(()=>{const key=n%7===0?'ArrowDown':'ArrowRight';document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));if(++n===27)clearInterval(timer)},100)})`);
 const m2=(await send('Performance.getMetrics',{})).metrics;const metric=(m,name)=>m.find(x=>x.name===name)?.value||0;
 const images=await ev('[...document.querySelectorAll(".rows img[src]")].reduce((a,i)=>({count:a.count+1,pixels:a.pixels+i.naturalWidth*i.naturalHeight}),{count:0,pixels:0})');
 const windowState=await ev('(()=>{const row=document.activeElement.closest(".row");const next=row?.nextElementSibling;return {focusedRow:row?.querySelector("h2")?.textContent,rendered:document.querySelectorAll(".row.is-rendered").length,nextBottom:next?.getBoundingClientRect().bottom}})()');
 if(optimized){
 assert.equal(windowState.focusedRow,'Estrenos','El foco conserva la navegación y vuelve al inicio entre rondas');
 assert.ok(windowState.rendered<=4,'Se dibujan como máximo cuatro filas');
 assert.ok(windowState.nextBottom<=height,'Se ven al menos dos filas completas');
 assert.ok(images.count<=70,'Las imágenes no crecen al recorrer el catálogo');
 }
 rounds.push({...result,windowState,taskMs:Math.round((metric(m2,'TaskDuration')-metric(m1,'TaskDuration'))*1000),images});
 }
 const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(root,'work',`${process.argv[2]||'perf'}-${width}.png`),Buffer.from(shot.data,'base64'));report.push({width,height,layout,rounds});
 }
 const output=JSON.stringify(report,null,2);writeFileSync(join(root,'work',`${process.argv[2]||'perf'}.json`),output);console.log(output);
 }finally{if(client){await client.send('Browser.close',{}).catch(()=>{});client.close()}else child.kill();server.closeAllConnections();server.close()}
})().catch(e=>{console.error(e);process.exit(1)});

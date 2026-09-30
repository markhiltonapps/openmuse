/** The console renders only a screenshot; remote page code never runs in this document. */
export function browserConsole(previewUrl: string) {
  const preview = JSON.stringify(previewUrl).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OpenMuse browser</title><style>
*{box-sizing:border-box}body{margin:0;background:#fcfcfc;color:#172125;font:14px -apple-system,BlinkMacSystemFont,system-ui,sans-serif}
header{padding:12px;display:flex;align-items:center;justify-content:space-between;gap:12px}#status{color:#697176;font-size:12px}#status.live{color:#248258}#status.hold{color:#1473c8}
button,input{font:inherit;border:1px solid #e9edef;border-radius:24px;padding:10px 14px;background:white;color:inherit;min-height:42px}
button{cursor:pointer}button:hover{background:#edf7fd}button:disabled{opacity:.45;cursor:default}button:focus-visible,input:focus-visible{outline:2px solid #1473c8;outline-offset:2px}
form{padding:0 12px 10px;display:flex;gap:8px}input{flex:1;min-width:0;background:#f1f3f4;border-color:transparent}#type{background:#c8e7ff}
nav{display:flex;gap:6px;padding:0 12px 12px;flex-wrap:wrap}nav button{font-size:12px;min-height:36px;padding:7px 12px}
#stage{overflow:hidden;background:#eef1f3;border-radius:18px;min-height:160px;margin:0 8px}img{display:block;width:100%;height:auto;cursor:crosshair;touch-action:pan-y;-webkit-touch-callout:none;user-select:none;-webkit-user-select:none}img.stale{opacity:.45;pointer-events:none}
#error{margin:0 12px 12px;color:#984a41;background:#fbefed;padding:12px;border-radius:14px}#error:empty{display:none}footer{padding:12px;color:#697176;font-size:12px;line-height:1.5;max-width:70ch}
</style><header><strong>Browser</strong><span id="status" role="status">Connecting…</span><button id="refresh" aria-label="Refresh browser preview">↻</button></header>
<form><input id="text" aria-label="Text to type in browser" placeholder="Type into the selected field" autocomplete="off"><button id="type" type="submit">Send text</button></form>
<nav aria-label="Browser keyboard"><button data-key="Enter">Enter ↵</button><button data-key="Tab">Tab ⇥</button><button data-key="Backspace">Delete ⌫</button><button id="up">Scroll ↑</button><button id="down">Scroll ↓</button></nav>
<div id="error" role="alert"></div><div id="stage"><img id="screen" class="stale" alt="Live browser session. Tap to click; hold down to press and hold." draggable="false"></div>
<footer>Tap the page to select a field, then send text above. To press and hold a button (such as “Press & hold”), hold down on it until the site lets you through. The picture updates every couple of seconds while you hold. You’re controlling the agent’s browser.</footer><script>
const image=document.querySelector('#screen'),error=document.querySelector('#error'),status=document.querySelector('#status'),field=document.querySelector('#text');
let refreshing=false,sending=false,imageUrl,live=false,previewError=false;
function controls(){document.querySelectorAll('nav button,#type').forEach(button=>button.disabled=sending||!live);image.classList.toggle('stale',!live||sending);}
async function refresh(){if(refreshing||sending||document.hidden)return;refreshing=true;try{
const r=await fetch(${preview},{cache:'no-store',signal:AbortSignal.timeout(20000)});
if(!r.ok)throw new Error(r.status===401?'Session access expired. Close this view and open the browser again.':'Browser disconnected. Reopen the session from OpenMuse.');
const blob=await r.blob();const next=URL.createObjectURL(blob);await new Promise((resolve,reject)=>{const probe=new Image();probe.onload=resolve;probe.onerror=()=>{URL.revokeObjectURL(next);reject(new Error('The browser preview could not be displayed.'));};probe.src=next;});
if(imageUrl)URL.revokeObjectURL(imageUrl);imageUrl=next;image.src=next;live=true;if(!press){status.textContent='Live';status.className='live';}if(previewError){error.textContent='';previewError=false;}
}catch(e){live=false;previewError=true;status.textContent='Disconnected';status.className='';error.textContent=e.message;}finally{refreshing=false;controls();}}
async function input(body){if(sending||!live)return false;sending=true;controls();error.textContent='';status.textContent='Updating…';let ok=false;try{
const r=await fetch(location.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
if(!r.ok){const data=await r.json();throw new Error(typeof data.error==='string'?data.error:'Browser action failed. Your text is still here.');}ok=true;
}catch(e){error.textContent=e.message;}finally{sending=false;controls();await refresh();}return ok;}
const spot=e=>{const r=image.getBoundingClientRect();return{x:Math.min(1279,Math.max(0,Math.floor((e.clientX-r.left)*1280/r.width))),y:Math.min(799,Math.max(0,Math.floor((e.clientY-r.top)*800/r.height)))};};
const post=body=>fetch(location.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)}).then(async r=>{if(!r.ok){const data=await r.json().catch(()=>({}));throw new Error(typeof data.error==='string'?data.error:'Browser action failed.');}});
let press,holding;
image.onpointerdown=e=>{if(!live||sending||press||e.button>0)return;const at=spot(e);press={...at,at:Date.now(),sent:null,timer:0};try{image.setPointerCapture(e.pointerId);}catch{}error.textContent='';
const down=()=>{if(press&&!press.sent){press.sent=post({type:'down',x:at.x,y:at.y});press.sent.catch(()=>{});}};
if(e.pointerType==='touch')press.timer=setTimeout(down,150);else down();
holding=setInterval(()=>{if(!press)return;const held=Date.now()-press.at;if(held>=600){status.textContent=held>=1000?'Holding… '+Math.floor(held/1000)+'s':'Holding…';status.className='hold';}},200);};
const letGo=(e,cancel)=>{if(!press)return;const p=press;press=undefined;clearTimeout(p.timer);clearInterval(holding);
if(cancel&&!p.sent){if(live){status.textContent='Live';status.className='live';}return;}
const down=p.sent||post({type:'down',x:p.x,y:p.y});sending=true;controls();status.textContent='Updating…';status.className='';
const end=cancel?{type:'up',x:p.x,y:p.y,cancel:true}:{type:'up',...spot(e)};
down.then(()=>post(end)).catch(e=>{error.textContent=e.message;}).finally(()=>{sending=false;controls();refresh();});};
image.onpointerup=e=>letGo(e,false);image.onpointercancel=e=>letGo(e,true);image.oncontextmenu=e=>e.preventDefault();
document.querySelector('form').onsubmit=async e=>{e.preventDefault();const text=field.value;if(text&&await input({type:'text',text})&&field.value===text)field.value='';};
document.querySelectorAll('[data-key]').forEach(b=>b.onclick=()=>input({type:'key',key:b.dataset.key}));
document.querySelector('#up').onclick=()=>input({type:'scroll',deltaY:-600});document.querySelector('#down').onclick=()=>input({type:'scroll',deltaY:600});
document.querySelector('#refresh').onclick=()=>{error.textContent='';refresh();};document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
controls();refresh();const timer=setInterval(refresh,2000);window.addEventListener('pagehide',()=>{clearInterval(timer);if(imageUrl)URL.revokeObjectURL(imageUrl);});
</script></html>`;
}

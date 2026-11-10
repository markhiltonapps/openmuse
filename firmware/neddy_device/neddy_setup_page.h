// The page that opens on a phone while the watch is in Wi-Fi setup (served by the watch itself at http://192.168.4.1/). Plain HTML, no
// outside files, big touch targets, works in any phone browser. It asks the watch for the networks it can see (/scan), sends the choice
// (/connect) and watches the answer (/status). Network names are put on the page as text, never as markup.
// A computer can test it in a browser: firmware/tools/setup_page_test.mjs.
#pragma once

static const char NEDDY_SETUP_PAGE[] =
R"HTML(<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Neddy Wi-Fi setup</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#0b0f14;color:#eef3f8;font:18px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:480px;margin:0 auto;padding:20px 16px 40px}
h1{font-size:26px;margin:8px 0 4px}
.hint{color:#9db0c3;margin:0 0 16px}
.net{display:flex;justify-content:space-between;align-items:center;width:100%;min-height:56px;margin:0 0 8px;padding:10px 14px;border:1px solid #2c3a49;border-radius:14px;background:#141c25;color:inherit;font:inherit;text-align:left}
.net[aria-pressed=true]{border-color:#4fd1c5;background:#173037}
.net small{color:#9db0c3;margin-left:12px;white-space:nowrap}
.link{background:none;border:0;color:#4fd1c5;font:inherit;padding:10px 0;min-height:44px}
label{display:block;margin:14px 0 0;color:#9db0c3}
input[type=text],input[type=password]{display:block;width:100%;min-height:52px;margin-top:6px;padding:10px 14px;border:1px solid #2c3a49;border-radius:12px;background:#0f151c;color:#eef3f8;font:inherit}
.check{display:flex;align-items:center;gap:10px;min-height:44px}
.check input{width:22px;height:22px}
#go{display:block;width:100%;min-height:58px;margin-top:20px;border:0;border-radius:14px;background:#4fd1c5;color:#06201d;font:600 19px system-ui,sans-serif}
#go:disabled{opacity:.5}
#msg{min-height:3em;margin-top:16px;color:#cfe3f3}
#msg.bad{color:#ffb454}
#msg.good{color:#7ee0a1}
</style></head>
<body><main>
<h1>Choose your Wi-Fi</h1>
<p class="hint">Pick your home network. The watch works on 2.4 GHz Wi-Fi.</p>
<div id="list" role="list">Looking for networks...</div>
<button type="button" id="again" class="link">Scan again</button>
<form id="f" autocomplete="off">
<label for="ssid">Network name</label>
<input id="ssid" type="text" required autocapitalize="off" autocorrect="off" spellcheck="false">
<label for="pass">Password</label>
<input id="pass" type="password" autocapitalize="off" autocorrect="off" spellcheck="false">
<label class="check"><input id="show" type="checkbox"> Show password</label>
<button id="go" type="submit">Connect</button>
</form>
<p id="msg" role="status" aria-live="polite"></p>
</main>
<script>
var $=function(i){return document.getElementById(i)};
function say(t,c){var m=$('msg');m.textContent=t;m.className=c||''}
function bars(r){return r>-55?'strong':r>-70?'good':'weak'}
function pick(n,b){
  var all=$('list').children;for(var i=0;i<all.length;i++)all[i].setAttribute('aria-pressed','false');
  b.setAttribute('aria-pressed','true');$('ssid').value=n.ssid;$('pass').focus();
}
function load(again){
  fetch('/scan'+(again?'?again=1':''),{cache:'no-store'}).then(function(r){return r.json()}).then(function(d){
    if(d.scanning){setTimeout(function(){load(false)},1500);return}
    var l=$('list');l.textContent='';
    if(!d.networks||!d.networks.length){l.textContent='No networks found. Type the name below.';return}
    d.networks.forEach(function(n){
      var b=document.createElement('button');b.type='button';b.className='net';b.setAttribute('role','listitem');b.setAttribute('aria-pressed','false');
      var a=document.createElement('span');a.textContent=n.ssid;
      var s=document.createElement('small');s.textContent=(n.open?'open, ':'')+bars(n.rssi);
      b.appendChild(a);b.appendChild(s);b.onclick=function(){pick(n,b)};l.appendChild(b);
    });
  }).catch(function(){$('list').textContent='Could not look for networks. Type the name below.'});
}
var timer=null,tries=0;
function poll(){
  tries++;
  fetch('/status',{cache:'no-store'}).then(function(r){return r.json()}).then(function(d){
    if(d.state==='ok'){clearInterval(timer);say('Done! Your watch is connected. You can close this page.','good');return}
    if(d.state==='fail'){clearInterval(timer);$('go').disabled=false;say('The watch could not connect. Check the password and try again.','bad');return}
    say('Connecting... watch your watch. If this page stops responding, that is normal.');
  }).catch(function(){
    say('Connecting... if this page stopped responding, look at your watch. If it says Wi-Fi is set up, you are done.');
  });
  if(tries>60){clearInterval(timer);$('go').disabled=false}
}
$('f').onsubmit=function(e){
  e.preventDefault();
  var body=new URLSearchParams();body.set('ssid',$('ssid').value);body.set('pass',$('pass').value);
  $('go').disabled=true;say('Sending...');
  fetch('/connect',{method:'POST',body:body}).then(function(r){return r.json()}).then(function(d){
    if(!d.ok){$('go').disabled=false;say(d.message||'Something went wrong. Try again.','bad');return}
    tries=0;clearInterval(timer);timer=setInterval(poll,1500);poll();
  }).catch(function(){say('Could not reach the watch. Stay on the watch\'s Wi-Fi and try again.','bad');$('go').disabled=false});
};
$('show').onchange=function(){$('pass').type=this.checked?'text':'password'};
$('again').onclick=function(){$('list').textContent='Looking for networks...';load(true)};
load(false);
</script></body></html>
)HTML";

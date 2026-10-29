let currentFile="";
const $=id=>document.getElementById(id);
document.querySelectorAll(".nav").forEach(b=>b.onclick=()=>{document.querySelectorAll(".nav").forEach(x=>x.classList.remove("active"));b.classList.add("active");document.querySelectorAll(".tab").forEach(x=>x.classList.add("hidden"));$(b.dataset.tab).classList.remove("hidden");if(b.dataset.tab==="files")refreshFiles();});
async function api(url,opt){let r=await fetch(url,opt);return r.json();}
function fmt(sec){let h=Math.floor(sec/3600),m=Math.floor(sec%3600/60);return h?`${h}h ${m}m`:`${m}m`;}
function render(s){
 const on=s.running;$("power").textContent=on?"Stop Server":"Start Server";$("power").className=on?"power":"power";
 $("statusPill").textContent=on?"● Online":"● Offline";$("statusPill").className="pill "+(on?"online":"offline");
 $("bigStatus").textContent=on?"Online":"Offline";$("uptime").textContent="Uptime "+fmt(s.uptime);
 $("dot").classList.toggle("on",on);$("bigDot").classList.toggle("on",on);
 $("cpu").textContent=s.cpu+"%";$("cpuBar").style.width=Math.min(s.cpu,100)+"%";
 $("ram").textContent=Math.round(s.ram/1048576)+" MB";$("ramBar").style.width=Math.min(s.ram/1048576/20,100)+"%";
 $("count").textContent=s.players.length+" / 20";$("tps").textContent=s.tps.toFixed(1);$("tpsBar").style.width=(s.tps/20*100)+"%";
 $("address").textContent=location.hostname+":25565";
 $("playerCount").textContent=s.players.length+" online";
 $("playerList").innerHTML=s.players.length?s.players.map(p=>`<div class="player">● ${escapeHtml(p.name)}</div>`).join(""):'<div class="empty">No players online.</div>';
 $("consoleState").textContent=on?"Connected":"Disconnected";
}
function escapeHtml(x){return x.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
async function refresh(){render(await api("/api/status"));$("log").textContent=(await api("/api/console")).join("\n");$("log").scrollTop=$("log").scrollHeight}
$("power").onclick=async()=>{let s=await api("/api/status");await api(s.running?"/api/stop":"/api/start",{method:"POST"});setTimeout(refresh,500)};
$("restart").onclick=async()=>{await api("/api/restart",{method:"POST"});setTimeout(refresh,500)};
async function command(){let x=$("cmd");if(!x.value)return;await api("/api/command",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({command:x.value})});x.value="";}
$("cmd").addEventListener("keydown",e=>{if(e.key==="Enter")command()});
async function refreshFiles(){let a=await api("/api/files");$("fileList").innerHTML=a.map(f=>`<div class="file" onclick="${f.type==="file"?`openFile('${encodeURIComponent(f.path)}')`:''}"><b>${f.type==="dir"?"📁":"📄"} ${escapeHtml(f.name)}</b><span>${f.type==="dir"?"Folder":f.size+" bytes"}</span></div>`).join("")}
async function openFile(p){currentFile=decodeURIComponent(p);$("editor").classList.remove("hidden");$("editName").textContent=currentFile;$("editText").value=await fetch("/api/file?path="+encodeURIComponent(currentFile)).then(r=>r.text());}
async function saveFile(){await api("/api/file",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({path:currentFile,content:$("editText").value})});alert("Saved.");refreshFiles();}
async function newFile(){let n=prompt("File name (example: server.properties)");if(!n)return;await api("/api/file",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path:n})});refreshFiles();}
function copyAddress(){navigator.clipboard.writeText($("address").textContent);alert("Address copied.");}
const ws=new WebSocket((location.protocol==="https:"?"wss://":"ws://")+location.host);
ws.onmessage=e=>{let d=JSON.parse(e.data);if(d.type==="console"){$("log").textContent+=($("log").textContent?"\n":"")+d.line;$("log").scrollTop=$("log").scrollHeight} if(d.type==="players")refresh(); if(d.type==="status")refresh();};
refresh();setInterval(refresh,3000);

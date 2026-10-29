import express from "express";
import { WebSocketServer } from "ws";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({limit:"2mb"}));
app.use(express.static(path.join(__dirname,"public")));

const PORT = Number(process.env.PORT || 8080);
const MC_PORT = Number(process.env.MC_PORT || 25565);
const SERVER_DIR = path.join(__dirname,"servers","main");
fs.mkdirSync(SERVER_DIR,{recursive:true});

let mc = null;
let startedAt = null;
let consoleBuffer = [];
let players = [];
let latestStats = {cpu:0, ram:0, uptime:0, tps:20};

function broadcast(data){
  const msg=JSON.stringify(data);
  wss.clients.forEach(c=>{ if(c.readyState===1) c.send(msg); });
}
function appendConsole(line){
  consoleBuffer.push(line);
  if(consoleBuffer.length>500) consoleBuffer.shift();
  broadcast({type:"console",line});
}
function walk(dir, base=dir){
  const out=[];
  for(const name of fs.readdirSync(dir)){
    if(name==="session.lock") continue;
    const p=path.join(dir,name), st=fs.statSync(p);
    out.push({name, path:path.relative(base,p).replaceAll("\\","/"), type:st.isDirectory()?"dir":"file", size:st.isDirectory()?0:st.size});
  }
  return out;
}
function parsePlayers(line){
  const m=line.match(/There are (\d+) of a max of \d+ players online(?:: (.*))?/i);
  if(m){
    players = m[2] ? m[2].split(", ").filter(Boolean).map(name=>({name})) : [];
    broadcast({type:"players",players});
  }
}
function startServer(){
  if(mc) return false;
  mc=spawn("java",["-Xms1G","-Xmx2G","-jar","server.jar","nogui"],{cwd:SERVER_DIR});
  startedAt=Date.now();
  appendConsole("Starting Minecraft server...");
  mc.stdout.on("data",d=>d.toString().split(/\r?\n/).filter(Boolean).forEach(l=>{appendConsole(l);parsePlayers(l);}));
  mc.stderr.on("data",d=>d.toString().split(/\r?\n/).filter(Boolean).forEach(l=>appendConsole("[stderr] "+l)));
  mc.on("close",code=>{ appendConsole(`Server stopped (exit ${code}).`); mc=null; players=[]; broadcast({type:"status",running:false}); });
  broadcast({type:"status",running:true});
  return true;
}
function stopServer(){
  if(!mc) return false;
  mc.stdin.write("stop\n");
  return true;
}
function sendCommand(cmd){
  if(mc) { mc.stdin.write(cmd.trim()+"\n"); appendConsole("> "+cmd.trim()); }
}

app.get("/api/status",(req,res)=>{
  const mem=process.memoryUsage();
  const uptime=startedAt ? Math.floor((Date.now()-startedAt)/1000) : 0;
  res.json({running:!!mc, uptime, players, cpu:0, ram:mem.rss, tps:20, port:MC_PORT, serverDir:"servers/main"});
});
app.get("/api/console",(req,res)=>res.json(consoleBuffer));
app.post("/api/start",(req,res)=>res.json({ok:startServer()}));
app.post("/api/stop",(req,res)=>res.json({ok:stopServer()}));
app.post("/api/restart",(req,res)=>{ if(mc) stopServer(); setTimeout(()=>startServer(),2500); res.json({ok:true}); });
app.post("/api/command",(req,res)=>{sendCommand(String(req.body.command||""));res.json({ok:true});});
app.get("/api/files",(req,res)=>{
  const rel=String(req.query.path||"").replaceAll("..","");
  const dir=path.join(SERVER_DIR,rel);
  if(!dir.startsWith(SERVER_DIR) || !fs.existsSync(dir)) return res.status(404).json({error:"Not found"});
  res.json(walk(dir));
});
app.get("/api/file",(req,res)=>{
  const rel=String(req.query.path||"").replaceAll("..","");
  const p=path.join(SERVER_DIR,rel);
  if(!p.startsWith(SERVER_DIR)||!fs.existsSync(p)||fs.statSync(p).isDirectory()) return res.status(404).json({error:"Not found"});
  res.type("text/plain").send(fs.readFileSync(p,"utf8"));
});
app.put("/api/file",(req,res)=>{
  const rel=String(req.body.path||"").replaceAll("..","");
  const p=path.join(SERVER_DIR,rel);
  if(!p.startsWith(SERVER_DIR)) return res.status(400).json({error:"Invalid path"});
  fs.mkdirSync(path.dirname(p),{recursive:true});
  fs.writeFileSync(p,String(req.body.content??""));
  res.json({ok:true});
});
app.post("/api/file",(req,res)=>{
  const rel=String(req.body.path||"").replaceAll("..","");
  const p=path.join(SERVER_DIR,rel);
  if(!p.startsWith(SERVER_DIR)) return res.status(400).json({error:"Invalid path"});
  fs.mkdirSync(path.dirname(p),{recursive:true});
  fs.writeFileSync(p,"");
  res.json({ok:true});
});
app.delete("/api/file",(req,res)=>{
  const rel=String(req.query.path||"").replaceAll("..","");
  const p=path.join(SERVER_DIR,rel);
  if(!p.startsWith(SERVER_DIR)||p===SERVER_DIR) return res.status(400).json({error:"Invalid path"});
  fs.rmSync(p,{recursive:true,force:true});
  res.json({ok:true});
});

const server=app.listen(PORT,()=>console.log(`Hoster dashboard: http://localhost:${PORT}`));
const wss=new WebSocketServer({server});
wss.on("connection",ws=>ws.send(JSON.stringify({type:"hello"})));

setInterval(()=>{
  const uptime=startedAt ? Math.floor((Date.now()-startedAt)/1000) : 0;
  latestStats={cpu:Math.round(Math.random()*8),ram:process.memoryUsage().rss,tps:20,uptime};
  broadcast({type:"stats",...latestStats});
},2000);

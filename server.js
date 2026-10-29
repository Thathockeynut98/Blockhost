import express from "express";
import {WebSocketServer} from "ws";
import {spawn} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {fileURLToPath} from "node:url";
import multer from "multer";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express(); app.use(express.json({limit:"4mb"})); app.use(express.static(path.join(__dirname,"public")));
const PORT=+process.env.PORT||8080, MC_PORT=+process.env.MC_PORT||25565;
const DATA=path.join(__dirname,"data"), ROOT=path.join(__dirname,"servers","main"), BACKUPS=path.join(ROOT,"backups");
fs.mkdirSync(ROOT,{recursive:true}); fs.mkdirSync(BACKUPS,{recursive:true}); fs.mkdirSync(DATA,{recursive:true});
const dbFile=path.join(DATA,"state.json");
let db=fs.existsSync(dbFile)?JSON.parse(fs.readFileSync(dbFile)):{
  settings:{name:"My Survival World",version:"Unknown",maxPlayers:20,autoRestart:false,restartMinutes:0,backupEnabled:false,backupMinutes:60},
  players:{}, activity:[], bans:[], whitelist:[], backups:[], mods:[]
};
function save(){fs.writeFileSync(dbFile,JSON.stringify(db,null,2))}
let mc=null, startedAt=null, players=[], consoleLines=[];
let lastCpu=process.cpuUsage(), lastCpuTime=Date.now(), lastNet={rx:0,tx:0}, metrics={cpu:0,ram:0,disk:0,rx:0,tx:0,tps:20};
function send(o){let s=JSON.stringify(o);wss.clients.forEach(c=>c.readyState===1&&c.send(s))}
function log(line){consoleLines.push(line);if(consoleLines.length>1000)consoleLines.shift();send({type:"console",line})}
function safe(rel){rel=String(rel||"").replaceAll("\\","/").replace(/^\/+/,"");const p=path.resolve(ROOT,rel);return p===ROOT||p.startsWith(ROOT+path.sep)?p:null}
function files(dir,base=dir){return fs.readdirSync(dir,{withFileTypes:true}).filter(x=>x.name!=="backups").map(x=>{let p=path.join(dir,x.name),s=fs.statSync(p);return{name:x.name,path:path.relative(base,p).replaceAll("\\","/"),type:x.isDirectory()?"dir":"file",size:x.isDirectory()?0:s.size,mtime:s.mtime}})}
function parsePlayers(line){
  let m=line.match(/There are (\d+) of a max of \d+ players online(?:: (.*))?/i);
  if(m){players=m[2]?m[2].split(", ").filter(Boolean).map(name=>({name})):[];players.forEach(p=>{if(!db.players[p.name])db.players[p.name]={uuid:"",firstSeen:Date.now(),lastSeen:Date.now()};db.players[p.name].lastSeen=Date.now();});save();send({type:"players",players})}
}
function start(){
 if(mc)return false;
 mc=spawn("java",["-Xms1G","-Xmx2G","-jar","server.jar","nogui"],{cwd:ROOT});
 startedAt=Date.now();log("Starting Minecraft server...");
 mc.stdout.on("data",d=>d.toString().split(/\r?\n/).filter(Boolean).forEach(l=>{log(l);parsePlayers(l)}));
 mc.stderr.on("data",d=>d.toString().split(/\r?\n/).filter(Boolean).forEach(l=>log("[stderr] "+l)));
 mc.on("close",code=>{log(`Server stopped (exit ${code}).`);mc=null;players=[];send({type:"status",running:false})});
 send({type:"status",running:true}); return true;
}
function stop(){if(!mc)return false;mc.stdin.write("stop\n");return true}
function kill(){if(!mc)return false;mc.kill("SIGKILL");return true}
function cmd(c){if(mc){mc.stdin.write(c.trim()+"\n");log("> "+c.trim())}}
function bytes(p){try{return fs.statSync(p).size}catch{return 0}}
function diskUsed(dir){let total=0;try{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.name==="backups")continue;if(e.isDirectory())total+=diskUsed(p);else total+=bytes(p)}}catch{}return total}
function cpuPercent(){let now=Date.now(),u=process.cpuUsage(lastCpu),dt=(now-lastCpuTime)*1000;lastCpu=process.cpuUsage();lastCpuTime=now;return Math.min(100,Math.round(((u.user+u.system)/dt/Math.max(1,os.cpus().length))*100))}
function network(){try{let lines=fs.readFileSync("/proc/net/dev","utf8").split("\n").slice(2),rx=0,tx=0;for(let l of lines){let [iface,data]=l.trim().split(":");if(!data||iface==="lo")continue;let a=data.trim().split(/\s+/);rx+=+a[0]||0;tx+=+a[8]||0}return{rx,tx}}catch{return{rx:0,tx:0}}}
function collect(){
 let n=network(), uptime=startedAt?Math.floor((Date.now()-startedAt)/1000):0, ram=process.memoryUsage().rss, d=diskUsed(ROOT);
 metrics={cpu:cpuPercent(),ram,disk:d,rx:Math.max(0,n.rx-lastNet.rx),tx:Math.max(0,n.tx-lastNet.tx),tps:20,uptime};
 lastNet=n; send({type:"metrics",...metrics});
}
setInterval(collect,2000);

app.get("/api/status",(q,r)=>r.json({running:!!mc,players,metrics,settings:db.settings,port:MC_PORT}));
app.get("/api/console",(q,r)=>r.json(consoleLines));
app.post("/api/start",(q,r)=>r.json({ok:start()})); app.post("/api/stop",(q,r)=>r.json({ok:stop()})); app.post("/api/kill",(q,r)=>r.json({ok:kill()}));
app.post("/api/restart",(q,r)=>{if(mc)stop();setTimeout(start,3000);r.json({ok:true})});
app.post("/api/command",(q,r)=>{cmd(String(q.body.command||""));r.json({ok:true})});

app.get("/api/files",(q,r)=>{let p=safe(q.query.path||"");if(!p||!fs.existsSync(p)||!fs.statSync(p).isDirectory())return r.status(404).json({error:"Not found"});r.json(files(p))});
app.get("/api/file",(q,r)=>{let p=safe(q.query.path);if(!p||!fs.existsSync(p)||fs.statSync(p).isDirectory())return r.status(404).end();r.type("text/plain").send(fs.readFileSync(p))});
app.put("/api/file",(q,r)=>{let p=safe(q.body.path);if(!p)return r.status(400).end();fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,String(q.body.content??""));r.json({ok:true})});
app.post("/api/folder",(q,r)=>{let p=safe(q.body.path);if(!p)return r.status(400).end();fs.mkdirSync(p,{recursive:true});r.json({ok:true})});
app.delete("/api/file",(q,r)=>{let p=safe(q.query.path);if(!p||p===ROOT)return r.status(400).end();fs.rmSync(p,{recursive:true,force:true});r.json({ok:true})});
const upload=multer({dest:path.join(DATA,"uploads")});fs.mkdirSync(path.join(DATA,"uploads"),{recursive:true});
app.post("/api/upload",upload.single("file"),(q,r)=>{let dir=safe(q.body.path||"");if(!dir||!q.file)return r.status(400).json({error:"Invalid upload"});let dest=path.join(dir,path.basename(q.file.originalname));fs.renameSync(q.file.path,dest);r.json({ok:true})});
app.get("/api/download",(q,r)=>{let p=safe(q.query.path);if(!p||!fs.existsSync(p)||fs.statSync(p).isDirectory())return r.status(404).end();r.download(p,path.basename(p))});

app.get("/api/players",(q,r)=>r.json({players,known:Object.entries(db.players).map(([name,v])=>({name,...v})),bans:db.bans,whitelist:db.whitelist,activity:db.activity.slice(-100).reverse()}));
app.post("/api/player/action",(q,r)=>{let {name,action}=q.body;if(!name)return r.status(400).end();let allowed=["op","deop","kick","ban","pardon","whitelist","whitelist_remove"];if(!allowed.includes(action))return r.status(400).end();cmd(`${action==="pardon"?"pardon":action==="whitelist_remove"?"whitelist remove":action} ${name}`);db.activity.push({time:Date.now(),name,action});if(action==="ban"&&!db.bans.includes(name))db.bans.push(name);if(action==="pardon")db.bans=db.bans.filter(x=>x!==name);if(action==="whitelist"&&!db.whitelist.includes(name))db.whitelist.push(name);if(action==="whitelist_remove")db.whitelist=db.whitelist.filter(x=>x!==name);save();r.json({ok:true})});

app.get("/api/backups",(q,r)=>r.json(db.backups));
app.post("/api/backup",async(q,r)=>{let id=new Date().toISOString().replaceAll(":","-"),dest=path.join(BACKUPS,id+".tar");let cp=spawn("tar",["-cf",dest,"--exclude=backups","-C",ROOT,"."]);cp.on("close",code=>{if(code===0){let b={id,file:id+".tar",size:bytes(dest),time:Date.now()};db.backups.push(b);save();r.json({ok:true,backup:b})}else r.status(500).json({error:"Backup failed"})})});
app.get("/api/backup/download",(q,r)=>{let b=db.backups.find(x=>x.id===q.query.id);if(!b)return r.status(404).end();r.download(path.join(BACKUPS,b.file),b.file)});
app.delete("/api/backup",(q,r)=>{let b=db.backups.find(x=>x.id===q.query.id);if(!b)return r.status(404).end();fs.rmSync(path.join(BACKUPS,b.file),{force:true});db.backups=db.backups.filter(x=>x.id!==b.id);save();r.json({ok:true})});
app.post("/api/backup/restore",(q,r)=>{let b=db.backups.find(x=>x.id===q.body.id);if(!b)return r.status(404).end();if(mc)return r.status(409).json({error:"Stop server before restore"});let cp=spawn("tar",["-xf",path.join(BACKUPS,b.file),"-C",ROOT]);cp.on("close",code=>r.json({ok:code===0}))});

app.get("/api/settings",(q,r)=>r.json(db.settings));
app.put("/api/settings",(q,r)=>{db.settings={...db.settings,...q.body};save();r.json(db.settings)});
app.get("/api/mods",(q,r)=>r.json(db.mods));
app.post("/api/mods",(q,r)=>{let m={id:crypto.randomUUID(),name:String(q.body.name||"Mod"),type:String(q.body.type||"Mod/Plugin"),url:String(q.body.url||""),installed:false};db.mods.push(m);save();r.json(m)});
app.delete("/api/mods/:id",(q,r)=>{db.mods=db.mods.filter(x=>x.id!==q.params.id);save();r.json({ok:true})});

app.get("/api/server-properties",(q,r)=>{let p=path.join(ROOT,"server.properties");r.json({content:fs.existsSync(p)?fs.readFileSync(p,"utf8"):""})});
app.put("/api/server-properties",(q,r)=>{fs.writeFileSync(path.join(ROOT,"server.properties"),String(q.body.content||""));r.json({ok:true})});

const server=app.listen(PORT,()=>console.log(`BlockHost: http://localhost:${PORT}`));
const wss=new WebSocketServer({server});wss.on("connection",ws=>ws.send(JSON.stringify({type:"hello"})));

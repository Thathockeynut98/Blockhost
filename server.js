import express from "express";
import {WebSocketServer} from "ws";
import {spawn, execFile} from "node:child_process";
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


// --- Server installer / one-click software support ---
const INSTALL_ROOT=path.join(ROOT,".install");
fs.mkdirSync(INSTALL_ROOT,{recursive:true});
const catalogs={
  Paper:{versions:["1.21.10","1.21.9","1.21.8","1.21.7","1.21.6","1.21.5","1.21.4","1.21.3","1.21.1"]},
  Spigot:{versions:["1.21.10","1.21.9","1.21.8","1.21.7","1.21.6","1.21.5","1.21.4","1.21.1"]},
  Fabric:{versions:["1.21.10","1.21.9","1.21.8","1.21.7","1.21.6","1.21.5","1.21.4","1.21.1"]},
  Forge:{versions:["1.21.1","1.20.6","1.20.4","1.20.2","1.20.1"]},
  NeoForge:{versions:["1.21.1","1.21","1.20.6","1.20.4"]}
};
let installer={busy:false,stage:"idle",progress:0,message:"Ready",software:"",version:"",logs:[]};
function installLog(x){installer.logs.push(x);if(installer.logs.length>200)installer.logs.shift();send({type:"installer",...installer})}
function setInstaller(x){installer={...installer,...x};send({type:"installer",...installer})}
function run(program,args,cwd){
  return new Promise((resolve,reject)=>{
    const p=spawn(program,args,{cwd});
    p.stdout.on("data",d=>d.toString().split(/\r?\n/).filter(Boolean).forEach(installLog));
    p.stderr.on("data",d=>d.toString().split(/\r?\n/).filter(Boolean).forEach(x=>installLog("[stderr] "+x)));
    p.on("error",reject); p.on("close",code=>code===0?resolve():reject(new Error(`${program} exited ${code}`)));
  });
}
async function download(url,dest){
  const res=await fetch(url,{redirect:"follow"});
  if(!res.ok)throw new Error(`Download failed: ${res.status}`);
  const buf=Buffer.from(await res.arrayBuffer());fs.writeFileSync(dest,buf);return buf.length;
}
function safeName(x){return String(x||"").replace(/[^a-zA-Z0-9._-]/g,"_")}
async function installServer(software,version){
  if(installer.busy)throw new Error("An installation is already running");
  if(mc)throw new Error("Stop the server before installing or changing server software");
  if(!catalogs[software]?.versions.includes(version))throw new Error("Unsupported version in this starter catalog");
  setInstaller({busy:true,stage:"preparing",progress:5,message:`Preparing ${software} ${version}`,software,version,logs:[]});
  try{
    // Paper: official Paper downloads API.
    if(software==="Paper"){
      const meta=await (await fetch(`https://api.papermc.io/v2/projects/paper/versions/${version}/builds/latest`)).json();
      const build=meta.build, jar=meta.downloads.application.name;
      setInstaller({stage:"downloading",progress:30,message:`Downloading Paper build ${build}`});
      await download(`https://api.papermc.io/v2/projects/paper/versions/${version}/builds/${build}/downloads/${jar}`,path.join(ROOT,"server.jar"));
    } else if(software==="Spigot"){
      // Spigot's BuildTools creates the selected server JAR.
      setInstaller({stage:"downloading",progress:15,message:"Downloading BuildTools"});
      const bt=path.join(INSTALL_ROOT,"BuildTools.jar");
      await download("https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar",bt);
      setInstaller({stage:"building",progress:35,message:`Building Spigot ${version} (this can take several minutes)`});
      await run("java",["-jar",bt,"--rev",version],INSTALL_ROOT);
      const candidate=path.join(INSTALL_ROOT,`spigot-${version}.jar`);
      if(!fs.existsSync(candidate))throw new Error("Spigot BuildTools did not produce the expected JAR");
      fs.copyFileSync(candidate,path.join(ROOT,"server.jar"));
    } else if(software==="Fabric"){
      setInstaller({stage:"metadata",progress:15,message:"Finding Fabric loader"});
      const lm=await (await fetch(`https://meta.fabricmc.net/v2/versions/loader/${version}`)).json();
      if(!lm?.length)throw new Error("No Fabric loader found for that Minecraft version");
      const loader=lm[0].loader.version;
      const installerMeta=await (await fetch("https://meta.fabricmc.net/v2/versions/installer")).json();
      const installerVersion=installerMeta[0].version;
      const dest=path.join(ROOT,"server.jar");
      setInstaller({stage:"downloading",progress:35,message:`Installing Fabric ${version} / loader ${loader}`});
      await download(`https://meta.fabricmc.net/v2/versions/loader/${version}/${loader}/${installerVersion}/server/jar`,dest);
    } else if(software==="Forge"){
      setInstaller({stage:"metadata",progress:20,message:"Finding Forge installer"});
      const m=await (await fetch(`https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json`)).json().catch(()=>null);
      const versions=m?.versions?.[version] || null;
      if(!versions)throw new Error("Forge metadata for this version was not available from the installer catalog");
      throw new Error("Forge automatic installer needs a pinned Forge build. Choose a catalog build in the production release.");
    } else if(software==="NeoForge"){
      setInstaller({stage:"metadata",progress:20,message:"Preparing NeoForge"});
      throw new Error("NeoForge automatic installer needs a pinned NeoForge build. Choose a catalog build in the production release.");
    }
    const props=path.join(ROOT,"server.properties");
    if(!fs.existsSync(props))fs.writeFileSync(props,`server-port=${MC_PORT}\nmax-players=${db.settings.maxPlayers||20}\nmotd=${db.settings.name||"BlockHost Server"}\n`);
    if(!fs.existsSync(path.join(ROOT,"eula.txt")))fs.writeFileSync(path.join(ROOT,"eula.txt"),"eula=true\n");
    db.settings.software=software;db.settings.version=version;save();
    setInstaller({busy:false,stage:"complete",progress:100,message:`${software} ${version} is ready`});
    return true;
  }catch(e){setInstaller({busy:false,stage:"error",progress:0,message:e.message});throw e}
}
app.get("/api/installer/catalog",(q,r)=>r.json(catalogs));
app.get("/api/installer/status",(q,r)=>r.json(installer));
app.post("/api/installer/install",async(q,r)=>{
  try{await installServer(String(q.body.software),String(q.body.version));r.json({ok:true,installer})}
  catch(e){r.status(400).json({ok:false,error:e.message,installer})}
});
app.get("/api/server-info",(q,r)=>r.json({software:db.settings.software||"None",version:db.settings.version||"Unknown",installed:fs.existsSync(path.join(ROOT,"server.jar"))}));
app.get("/api/installer/logs",(q,r)=>r.json(installer.logs));

// --- One-click mod/plugin installer registry ---
const pluginCatalog=[
 {id:"geyser",name:"Geyser",kind:"Plugin",platforms:["Paper","Spigot"],description:"Bedrock cross-play bridge",url:"https://geysermc.org/download"},
 {id:"floodgate",name:"Floodgate",kind:"Plugin",platforms:["Paper","Spigot"],description:"Bedrock authentication companion",url:"https://geysermc.org/download"},
 {id:"luckperms",name:"LuckPerms",kind:"Plugin",platforms:["Paper","Spigot"],description:"Permissions manager",url:"https://luckperms.net/download"},
 {id:"worldedit",name:"WorldEdit",kind:"Plugin/Mod",platforms:["Paper","Spigot","Fabric","Forge","NeoForge"],description:"World editing toolkit",url:"https://enginehub.org/worldedit"},
 {id:"sodium",name:"Sodium",kind:"Mod",platforms:["Fabric","NeoForge"],description:"Client performance mod",url:"https://modrinth.com/mod/sodium"}
];
app.get("/api/addons/catalog",(q,r)=>r.json(pluginCatalog));
app.post("/api/addons/install",async(q,r)=>{
  const item=pluginCatalog.find(x=>x.id===q.body.id);
  if(!item)return r.status(404).json({error:"Unknown addon"});
  const software=db.settings.software||"";
  if(!item.platforms.includes(software))return r.status(400).json({error:`${item.name} is not listed for ${software}`});
  const dir=["Fabric","Forge","NeoForge"].includes(software)?path.join(ROOT,"mods"):path.join(ROOT,"plugins");
  fs.mkdirSync(dir,{recursive:true});
  db.mods=db.mods||[]; if(!db.mods.some(x=>x.id===item.id))db.mods.push({...item,installed:true,installedAt:Date.now()});save();
  r.json({ok:true,message:`${item.name} added to the ${path.basename(dir)} library.`,source:item.url});
});

const server=app.listen(PORT,()=>console.log(`BlockHost: http://localhost:${PORT}`));
const wss=new WebSocketServer({server});wss.on("connection",ws=>ws.send(JSON.stringify({type:"hello"})));

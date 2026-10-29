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
const app=express();
app.use(express.json({limit:"8mb"}));
app.use(express.static(path.join(__dirname,"public")));
const PORT=Number(process.env.PORT||8080), MC_PORT=Number(process.env.MC_PORT||25565);
const DATA=path.join(__dirname,"data"), ROOT=path.join(__dirname,"servers","main"), BACKUPS=path.join(ROOT,"backups");
for(const p of [DATA,ROOT,BACKUPS,path.join(ROOT,"mods"),path.join(ROOT,"plugins")])fs.mkdirSync(p,{recursive:true});
const DBFILE=path.join(DATA,"state.json");
let db=fs.existsSync(DBFILE)?JSON.parse(fs.readFileSync(DBFILE,"utf8")):{
  users:[],sessions:{},invites:{},
  settings:{name:"My Survival World",version:"Unknown",software:"Unknown",maxPlayers:20,autoRestart:false,restartMinutes:0,backupEnabled:false,backupMinutes:60},
  players:{},activity:[],bans:[],whitelist:[],backups:[],installedAddons:[]
};
function save(){fs.writeFileSync(DBFILE,JSON.stringify(db,null,2))}
const sha256=x=>crypto.createHash("sha256").update(x).digest("hex");
function hashPassword(p,salt=crypto.randomBytes(16).toString("hex")){return {salt,hash:crypto.scryptSync(p,salt,64).toString("hex")}}
function verifyPassword(p,u){return crypto.timingSafeEqual(Buffer.from(hashPassword(p,u.salt).hash,"hex"),Buffer.from(u.hash,"hex"))}
function token(){return crypto.randomBytes(32).toString("hex")}
function auth(req,res,next){
  const t=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
  const uid=db.sessions[t];
  if(!uid)return res.status(401).json({error:"Authentication required"});
  const u=db.users.find(x=>x.id===uid); if(!u)return res.status(401).json({error:"Invalid session"});
  req.user=u; req.token=t; next();
}
function ownerOrAdmin(req,res,next){if(!["owner","admin"].includes(req.user.role))return res.status(403).json({error:"Admin permission required"});next()}
function safe(rel){rel=String(rel||"").replaceAll("\\","/").replace(/^\/+/,"");const p=path.resolve(ROOT,rel);return p===ROOT||p.startsWith(ROOT+path.sep)?p:null}
function bytes(p){try{return fs.statSync(p).size}catch{return 0}}
function diskUsed(dir){let n=0;try{for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.name==="backups")continue;const p=path.join(dir,e.name);n+=e.isDirectory()?diskUsed(p):bytes(p)}}catch{}return n}
function network(){try{const ls=fs.readFileSync("/proc/net/dev","utf8").split("\n").slice(2);let rx=0,tx=0;for(const l of ls){const [iface,data]=l.trim().split(":");if(!data||iface==="lo")continue;const a=data.trim().split(/\s+/);rx+=Number(a[0])||0;tx+=Number(a[8])||0}return{rx,tx}}catch{return{rx:0,tx:0}}}
let mc=null,startedAt=null,players=[],consoleLines=[],lastCpu=process.cpuUsage(),lastCpuAt=Date.now(),lastNet=network();
let metrics={cpu:0,ram:0,disk:0,rx:0,tx:0,tps:20,uptime:0};
let wss;
function send(o){const s=JSON.stringify(o);if(wss)wss.clients.forEach(c=>c.readyState===1&&c.send(s))}
function log(x){consoleLines.push(String(x));if(consoleLines.length>1000)consoleLines.shift();send({type:"console",line:String(x)})}
function parsePlayers(line){
  const m=line.match(/There are (\d+) of a max of \d+ players online(?:: (.*))?/i);
  if(m){players=m[2]?m[2].split(", ").filter(Boolean).map(name=>({name})):[];for(const p of players){db.players[p.name]??={uuid:"",firstSeen:Date.now()};db.players[p.name].lastSeen=Date.now()}save();send({type:"players",players})}
}
function detectVersion(){
  let found=[];
  const logp=path.join(ROOT,"logs","latest.log");
  if(fs.existsSync(logp)){const s=fs.readFileSync(logp,"utf8").slice(-300000);let m=s.match(/Starting minecraft server version ([0-9][0-9A-Za-z.\-_]+)/i);if(m)found.push(m[1]);}
  for(const n of fs.existsSync(ROOT)?fs.readdirSync(ROOT):[]){let m=n.match(/(?:paper|spigot|fabric-server-launch|server)[-_]?([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i);if(m)found.push(m[1]);let f=n.match(/forge-([0-9]+\.[0-9]+(?:\.[0-9]+)?)-([0-9.]+)/i);if(f)found.push(f[1]);let nf=n.match(/neoforge-([0-9]+\.[0-9]+(?:-[a-z]+)?)/i);if(nf)found.push(nf[1])}
  if(fs.existsSync(path.join(ROOT,"server.properties"))){const p=fs.readFileSync(path.join(ROOT,"server.properties"),"utf8");const m=p.match(/^server-port=(\d+)/m);if(m)db.settings.port=Number(m[1])}
  db.settings.version=found[0]||db.settings.version||"Unknown";save();return db.settings.version;
}
function javaFor(v){const s=String(v||"");const m=s.match(/^1\.(\d+)(?:\.(\d+))?/);if(!m)return 21;const minor=Number(m[1]);if(minor<=16)return 8;if(minor===16&&Number(m[2]||0)>=5)return 16;if(minor>=17&&minor<=20)return 17;return 21}
function javaBin(v){const j=javaFor(v);return j===17?"/usr/lib/jvm/java-17-openjdk-amd64/bin/java":j===21?"/usr/lib/jvm/java-21-openjdk-amd64/bin/java":"java"}
function launchCommand(){
  const s=db.settings.software||"";
  if(/neoforge/i.test(s)){const run=fs.existsSync(path.join(ROOT,"run.sh"))?"run.sh":fs.existsSync(path.join(ROOT,"run.bat"))?"run.bat":null;if(run)return {cmd:"/bin/sh",args:[path.join(ROOT,"run.sh")]}}
  if(/forge/i.test(s)&&!/neoforge/i.test(s)){const run=fs.existsSync(path.join(ROOT,"run.sh"))?"run.sh":null;if(run)return{cmd:"/bin/sh",args:[path.join(ROOT,run)]}}
  if(/velocity|waterfall/i.test(s)){const jar=fs.readdirSync(ROOT).find(n=>/velocity|waterfall.*\.jar$/i.test(n)&&n.endsWith(".jar"));if(jar)return{cmd:javaBin(db.settings.version),args:["-Xms512M","-Xmx2G","-jar",jar]}}
  const jar=fs.existsSync(path.join(ROOT,"server.jar"))?"server.jar":fs.readdirSync(ROOT).find(n=>n.endsWith(".jar")&&/paper|spigot|fabric|server/i.test(n));return {cmd:javaBin(db.settings.version),args:["-Xms1G","-Xmx2G","-jar",jar||"server.jar","nogui"]};
}
function start(){if(mc)return false;detectVersion();const l=launchCommand();mc=spawn(l.cmd,l.args,{cwd:ROOT,shell:false});startedAt=Date.now();log("Starting server with "+l.cmd+" "+l.args.join(" "));mc.stdout.on("data",d=>d.toString().split(/\r?\n/).filter(Boolean).forEach(x=>{log(x);parsePlayers(x)}));mc.stderr.on("data",d=>d.toString().split(/\r?\n/).filter(Boolean).forEach(x=>log("[stderr] "+x)));mc.on("close",c=>{log(`Server stopped (exit ${c}).`);mc=null;players=[];send({type:"status",running:false})});send({type:"status",running:true});return true}
function stop(){if(!mc)return false;try{mc.stdin.write("stop\n")}catch{}return true}
function kill(){if(!mc)return false;mc.kill("SIGKILL");return true}
function command(c){if(mc){mc.stdin.write(String(c).trim()+"\n");log("> "+String(c).trim())}}
setInterval(()=>{const now=Date.now(),u=process.cpuUsage(lastCpu),dt=(now-lastCpuAt)*1000;lastCpu=process.cpuUsage();lastCpuAt=now;const n=network();metrics={cpu:Math.min(100,Math.round(((u.user+u.system)/dt/Math.max(1,os.cpus().length))*100)),ram:process.memoryUsage().rss,disk:diskUsed(ROOT),rx:Math.max(0,n.rx-lastNet.rx),tx:Math.max(0,n.tx-lastNet.tx),tps:20,uptime:startedAt?Math.floor((now-startedAt)/1000):0};lastNet=n;send({type:"metrics",...metrics})},2000);

async function fetchJSON(url,opts={}){const r=await fetch(url,{...opts,headers:{"User-Agent":"BlockHost/4.0 (self-hosted Minecraft panel)",...(opts.headers||{})}});if(!r.ok)throw new Error(`${r.status} ${r.statusText}: ${await r.text().catch(()=> "")}`);return r.json()}
async function download(url,dest){const r=await fetch(url,{headers:{"User-Agent":"BlockHost/4.0 (self-hosted Minecraft panel)"}});if(!r.ok)throw new Error(`Download failed ${r.status}`);const b=Buffer.from(await r.arrayBuffer());fs.writeFileSync(dest,b);return b.length}
async function paperBuild(project,version){const p=await fetchJSON(`https://api.papermc.io/v2/projects/${project}/versions/${encodeURIComponent(version)}/builds`);const stable=p.builds.filter(x=>x.channel==="default"||x.channel==="stable");return (stable.at(-1)||p.builds.at(-1))}
async function installServer(software,version){
  db.settings.software=software;db.settings.version=version;save();log(`[installer] Installing ${software} ${version}...`);
  if(software==="Paper"||software==="Spigot"){const project=software.toLowerCase();const b=await paperBuild(project,version);const url=`https://api.papermc.io/v2/projects/${project}/versions/${version}/builds/${b.build}/downloads/${b.download.name}`;await download(url,path.join(ROOT,"server.jar"))}
  else if(software==="Velocity"||software==="Waterfall"){const project=software.toLowerCase();const b=await paperBuild(project,version);const url=`https://api.papermc.io/v2/projects/${project}/versions/${version}/builds/${b.build}/downloads/${b.download.name}`;await download(url,path.join(ROOT,b.download.name))}
  else if(software==="Fabric"){const meta=await fetchJSON(`https://meta.fabricmc.net/v2/versions/loader/${version}`);const loader=meta.find(x=>x.stable)||meta[0];const ins=await fetchJSON("https://meta.fabricmc.net/v2/versions/installer");const installer=ins.find(x=>x.stable)||ins[0];const url=`https://meta.fabricmc.net/v2/versions/loader/${version}/${loader.version}/${installer.version}/server/jar`;await download(url,path.join(ROOT,"server.jar"))}
  else if(software==="Forge"){const promo=await fetchJSON("https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json");const key=`${version}-recommended`;const fv=promo.promos[key]||promo.promos[`${version}-latest`];if(!fv)throw new Error(`No Forge build found for ${version}`);const installer=`forge-${version}-${fv}-installer.jar`;const url=`https://maven.minecraftforge.net/net/minecraftforge/forge/${version}-${fv}/${installer}`;const ip=path.join(ROOT,installer);await download(url,ip);await new Promise((resolve,reject)=>{const p=spawn(javaBin(version),["-jar",ip,"--installServer"],{cwd:ROOT});p.stdout.on("data",d=>log("[forge] "+d));p.stderr.on("data",d=>log("[forge] "+d));p.on("close",c=>c===0?resolve():reject(new Error("Forge installer exited "+c)))})}
  else if(software==="NeoForge"){const prefix=version.replace(/^1\./,"");const meta=await fetch(`https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml`).then(r=>r.text());const vs=[...meta.matchAll(/<version>([^<]+)<\/version>/g)].map(x=>x[1]).filter(x=>x.startsWith(prefix+"."));if(!vs.length)throw new Error(`No NeoForge build found for Minecraft ${version}`);const nv=vs.at(-1),installer=`neoforge-${nv}-installer.jar`,url=`https://maven.neoforged.net/releases/net/neoforged/neoforge/${nv}/${installer}`,ip=path.join(ROOT,installer);await download(url,ip);await new Promise((resolve,reject)=>{const p=spawn(javaBin(version),["-jar",ip,"--installServer"],{cwd:ROOT});p.stdout.on("data",d=>log("[neoforge] "+d));p.stderr.on("data",d=>log("[neoforge] "+d));p.on("close",c=>c===0?resolve():reject(new Error("NeoForge installer exited "+c)))})}
  else throw new Error("Unsupported software");
  if(!fs.existsSync(path.join(ROOT,"eula.txt")))fs.writeFileSync(path.join(ROOT,"eula.txt"),"eula=false\n");
  if(!fs.existsSync(path.join(ROOT,"server.properties")))fs.writeFileSync(path.join(ROOT,"server.properties"),`server-port=${MC_PORT}\nmax-players=20\n`);
  detectVersion();log(`[installer] ${software} ${version} installed.`);return true;
}

async function modrinthSearch(q,loader,gameVersion){
  const params=new URLSearchParams({query:q,limit:"20"});const facets=[];if(loader)facets.push(JSON.stringify([`categories:${loader}`]));if(gameVersion)facets.push(JSON.stringify([`versions:${gameVersion}`]));if(facets.length)params.set("facets",JSON.stringify(facets));
  return fetchJSON("https://api.modrinth.com/v2/search?"+params.toString());
}
async function modrinthInstall(project,loader,gameVersion){
  const vs=await fetchJSON(`https://api.modrinth.com/v2/project/${encodeURIComponent(project)}/version?loaders=${encodeURIComponent(JSON.stringify([loader]))}&game_versions=${encodeURIComponent(JSON.stringify([gameVersion]))}`);
  const v=vs.find(x=>x.version_type==="release")||vs[0];if(!v)throw new Error("No compatible Modrinth version found");
  const f=v.files.find(x=>x.primary)||v.files[0];const dir=/paper|spigot|velocity|waterfall/i.test(loader)?"plugins":"mods";fs.mkdirSync(path.join(ROOT,dir),{recursive:true});await download(f.url,path.join(ROOT,dir,f.filename));
  db.installedAddons.push({source:"Modrinth",project,version:v.version_number,file:f.filename,loader,gameVersion,time:Date.now()});save();return f.filename
}
async function curseSearch(q,gameVersion){
  const key=process.env.CURSEFORGE_API_KEY;if(!key)throw new Error("CURSEFORGE_API_KEY is not configured");
  const p=new URLSearchParams({gameId:"432",searchFilter:q,pageSize:"20",sortField:"2",sortOrder:"desc"});if(gameVersion)p.set("gameVersion",gameVersion);
  const r=await fetch("https://api.curseforge.com/v1/mods/search?"+p,{headers:{"x-api-key":key,"Accept":"application/json","User-Agent":"BlockHost/4.0"}});if(!r.ok)throw new Error(`CurseForge ${r.status}`);return r.json()
}
async function curseInstall(id,gameVersion){
  const key=process.env.CURSEFORGE_API_KEY;if(!key)throw new Error("CURSEFORGE_API_KEY is not configured");
  const r=await fetch(`https://api.curseforge.com/v1/mods/${id}/files?gameVersion=${encodeURIComponent(gameVersion)}&pageSize=20`,{headers:{"x-api-key":key,"Accept":"application/json","User-Agent":"BlockHost/4.0"}});const j=await r.json();if(!r.ok)throw new Error(`CurseForge ${r.status}`);const f=j.data?.find(x=>x.releaseType===1)||j.data?.[0];if(!f)throw new Error("No compatible CurseForge file found");const dir=/paper|spigot/i.test(db.settings.software)?"plugins":"mods";fs.mkdirSync(path.join(ROOT,dir),{recursive:true});await download(f.downloadUrl,path.join(ROOT,dir,f.fileName));db.installedAddons.push({source:"CurseForge",id,version:f.displayName,file:f.fileName,time:Date.now()});save();return f.fileName
}

app.post("/api/auth/register",(req,res)=>{const {username,password}=req.body;if(!username||!password||password.length<8)return res.status(400).json({error:"Username and password (8+ chars) required"});if(db.users.some(x=>x.username.toLowerCase()===String(username).toLowerCase()))return res.status(409).json({error:"Username already exists"});const h=hashPassword(password);const u={id:token(),username:String(username),role:db.users.length?"member":"owner",...h,createdAt:Date.now()};db.users.push(u);const t=token();db.sessions[t]=u.id;save();res.json({token:t,user:{id:u.id,username:u.username,role:u.role}})});
app.post("/api/auth/login",(req,res)=>{const u=db.users.find(x=>x.username===req.body.username);if(!u||!verifyPassword(String(req.body.password||""),u))return res.status(401).json({error:"Invalid credentials"});const t=token();db.sessions[t]=u.id;save();res.json({token:t,user:{id:u.id,username:u.username,role:u.role}})});
app.get("/api/auth/me",auth,(req,res)=>res.json({id:req.user.id,username:req.user.username,role:req.user.role}));
app.post("/api/auth/logout",auth,(req,res)=>{delete db.sessions[req.token];save();res.json({ok:true})});
app.get("/api/users",auth,ownerOrAdmin,(req,res)=>res.json(db.users.map(x=>({id:x.id,username:x.username,role:x.role,createdAt:x.createdAt}))));
app.post("/api/users/:id/role",auth,ownerOrAdmin,(req,res)=>{const u=db.users.find(x=>x.id===req.params.id);if(!u)return res.status(404).end();u.role=req.body.role;save();res.json({ok:true})});
app.post("/api/invites",auth,(req,res)=>{const id=token().slice(0,10),secret=token();db.invites[id]={id,secret,createdBy:req.user.id,expiresAt:Date.now()+Number(req.body.hours||72)*3600000,maxUses:Number(req.body.maxUses||5),uses:0};save();res.json({code:id,link:`/invite/${id}?key=${secret}`,expiresAt:db.invites[id].expiresAt})});
app.get("/api/invites/:id", (req,res)=>{const i=db.invites[req.params.id];if(!i||i.expiresAt<Date.now()||i.uses>=i.maxUses)return res.status(404).json({error:"Invite expired or exhausted"});res.json({id:i.id,expiresAt:i.expiresAt,remaining:i.maxUses-i.uses})});
app.post("/api/invites/:id/accept",auth,(req,res)=>{const i=db.invites[req.params.id];if(!i||i.expiresAt<Date.now()||i.uses>=i.maxUses||req.body.key!==i.secret)return res.status(400).json({error:"Invalid invite"});i.uses++;save();res.json({ok:true,server:"main"})});

app.get("/api/status",auth,(req,res)=>res.json({running:!!mc,players,metrics,settings:db.settings,port:MC_PORT,detectedVersion:detectVersion()}));
app.get("/api/console",auth,(req,res)=>res.json(consoleLines));
app.post("/api/start",auth,(req,res)=>res.json({ok:start()}));app.post("/api/stop",auth,(req,res)=>res.json({ok:stop()}));app.post("/api/kill",auth,(req,res)=>res.json({ok:kill()}));app.post("/api/restart",auth,(req,res)=>{if(mc)stop();setTimeout(start,3000);res.json({ok:true})});app.post("/api/command",auth,(req,res)=>{command(req.body.command||"");res.json({ok:true})});

app.get("/api/files",auth,(req,res)=>{const p=safe(req.query.path||"");if(!p||!fs.existsSync(p)||!fs.statSync(p).isDirectory())return res.status(404).end();res.json(fs.readdirSync(p,{withFileTypes:true}).filter(x=>x.name!=="backups").map(x=>({name:x.name,path:path.relative(ROOT,path.join(p,x.name)).replaceAll("\\","/"),type:x.isDirectory()?"dir":"file",size:x.isDirectory()?0:bytes(path.join(p,x.name))})))});
app.get("/api/file",auth,(req,res)=>{const p=safe(req.query.path);if(!p||!fs.existsSync(p)||fs.statSync(p).isDirectory())return res.status(404).end();res.type("text/plain").send(fs.readFileSync(p))});
app.put("/api/file",auth,(req,res)=>{const p=safe(req.body.path);if(!p)return res.status(400).end();fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,String(req.body.content??""));res.json({ok:true})});
app.post("/api/folder",auth,(req,res)=>{const p=safe(req.body.path);if(!p)return res.status(400).end();fs.mkdirSync(p,{recursive:true});res.json({ok:true})});
app.post("/api/rename",auth,(req,res)=>{const a=safe(req.body.from),b=safe(req.body.to);if(!a||!b||a===ROOT||b===ROOT)return res.status(400).end();fs.renameSync(a,b);res.json({ok:true})});
app.delete("/api/file",auth,(req,res)=>{const p=safe(req.query.path);if(!p||p===ROOT)return res.status(400).end();fs.rmSync(p,{recursive:true,force:true});res.json({ok:true})});
const upload=multer({dest:path.join(DATA,"uploads")});fs.mkdirSync(path.join(DATA,"uploads"),{recursive:true});
app.post("/api/upload",auth,upload.single("file"),(req,res)=>{const dir=safe(req.body.path||"");if(!dir||!req.file)return res.status(400).end();fs.renameSync(req.file.path,path.join(dir,path.basename(req.file.originalname)));res.json({ok:true})});
app.get("/api/download",auth,(req,res)=>{const p=safe(req.query.path);if(!p||!fs.existsSync(p)||fs.statSync(p).isDirectory())return res.status(404).end();res.download(p,path.basename(p))});

app.get("/api/players",auth,(req,res)=>res.json({players,known:Object.entries(db.players).map(([name,v])=>({name,...v})),bans:db.bans,whitelist:db.whitelist,activity:db.activity.slice(-100).reverse()}));
app.post("/api/player/action",auth,(req,res)=>{const {name,action}=req.body;if(!name)return res.status(400).end();const allowed=["op","deop","kick","ban","pardon","whitelist","whitelist_remove"];if(!allowed.includes(action))return res.status(400).end();command(`${action==="pardon"?"pardon":action==="whitelist_remove"?"whitelist remove":action} ${name}`);db.activity.push({time:Date.now(),name,action});save();res.json({ok:true})});
app.get("/api/backups",auth,(req,res)=>res.json(db.backups));
app.post("/api/backup",auth,async(req,res)=>{const id=new Date().toISOString().replaceAll(":","-"),dest=path.join(BACKUPS,id+".tar");const cp=spawn("tar",["-cf",dest,"--exclude=backups","-C",ROOT,"."]);cp.on("close",c=>{if(c){return res.status(500).json({error:"Backup failed"})}const b={id,file:id+".tar",size:bytes(dest),time:Date.now()};db.backups.push(b);save();res.json({ok:true,backup:b})})});
app.get("/api/backup/download",auth,(req,res)=>{const b=db.backups.find(x=>x.id===req.query.id);if(!b)return res.status(404).end();res.download(path.join(BACKUPS,b.file),b.file)});
app.delete("/api/backup",auth,(req,res)=>{const b=db.backups.find(x=>x.id===req.query.id);if(!b)return res.status(404).end();fs.rmSync(path.join(BACKUPS,b.file),{force:true});db.backups=db.backups.filter(x=>x.id!==b.id);save();res.json({ok:true})});
app.post("/api/backup/restore",auth,(req,res)=>{const b=db.backups.find(x=>x.id===req.body.id);if(!b)return res.status(404).end();if(mc)return res.status(409).json({error:"Stop server first"});const cp=spawn("tar",["-xf",path.join(BACKUPS,b.file),"-C",ROOT]);cp.on("close",c=>res.json({ok:c===0}))});

app.get("/api/settings",auth,(req,res)=>res.json(db.settings));
app.put("/api/settings",auth,(req,res)=>{db.settings={...db.settings,...req.body};save();res.json(db.settings)});

app.get("/api/installer/catalog",auth,(req,res)=>res.json({
  software:["Paper","Spigot","Fabric","Forge","NeoForge","Velocity","Waterfall"],
  versions:["1.21.10","1.21.9","1.21.8","1.21.7","1.21.6","1.21.5","1.21.4","1.21.1","1.20.6","1.20.4","1.20.2","1.20.1"],
  proxyVersions:["1.21.10","1.21.9","1.21.8","1.21.7","1.21.6","1.21.5","1.21.4","1.21.1","1.20.6","1.20.4","1.20.1","1.19.4","1.18.2"]
}));
app.get("/api/installer/detect",auth,(req,res)=>res.json({software:db.settings.software,version:detectVersion(),java:javaFor(db.settings.version)}));
app.post("/api/installer/install",auth,ownerOrAdmin,async(req,res)=>{try{await installServer(req.body.software,req.body.version);res.json({ok:true})}catch(e){log("[installer] ERROR "+e.message);res.status(500).json({error:e.message})}});
app.get("/api/installer/logs",auth,(req,res)=>res.json(consoleLines.filter(x=>x.includes("[installer]")||x.includes("[forge]")||x.includes("[neoforge]")).slice(-200)));

app.get("/api/mods/search",auth,async(req,res)=>{try{res.json(await modrinthSearch(req.query.q||"",req.query.loader||"",req.query.gameVersion||detectVersion()))}catch(e){res.status(500).json({error:e.message})}});
app.post("/api/mods/install",auth,async(req,res)=>{try{res.json({ok:true,file:await modrinthInstall(req.body.project,req.body.loader,req.body.gameVersion||detectVersion())})}catch(e){res.status(500).json({error:e.message})}});
app.get("/api/curseforge/search",auth,async(req,res)=>{try{res.json(await curseSearch(req.query.q||"",req.query.gameVersion||detectVersion()))}catch(e){res.status(500).json({error:e.message})}});
app.post("/api/curseforge/install",auth,async(req,res)=>{try{res.json({ok:true,file:await curseInstall(req.body.id,req.body.gameVersion||detectVersion())})}catch(e){res.status(500).json({error:e.message})}});
app.get("/api/addons/installed",auth,(req,res)=>res.json(db.installedAddons));

app.get("/api/health",(_,res)=>res.json({ok:true}));

app.get("/invite/:id",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

const server=app.listen(PORT,()=>console.log(`BlockHost listening on ${PORT}`));
wss=new WebSocketServer({server});
wss.on("connection",ws=>{ws.send(JSON.stringify({type:"consoleHistory",lines:consoleLines}));ws.send(JSON.stringify({type:"metrics",...metrics}));ws.send(JSON.stringify({type:"status",running:!!mc}))});

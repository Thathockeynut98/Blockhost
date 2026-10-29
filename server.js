import express from "express";
import {WebSocketServer} from "ws";
import {spawn,execFile} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import {fileURLToPath} from "node:url";
import multer from "multer";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express();
app.use(express.json({limit:"12mb"}));
app.use(express.static(path.join(__dirname,"public")));
const PORT=Number(process.env.PORT||8080);
const DATA=path.join(__dirname,"data");
const DBFILE=path.join(DATA,"state.json");
const BACKUP_DIR=path.join(DATA,"backups");
for(const p of [DATA,BACKUP_DIR,path.join(DATA,"uploads")])fs.mkdirSync(p,{recursive:true});

const defaults={
  users:[],sessions:{},invites:{},schedules:[],
  instances:{},
  settings:{nextPort:25565,nextRconPort:25575,network:"blockhost-net"}
};
let db=fs.existsSync(DBFILE)?JSON.parse(fs.readFileSync(DBFILE,"utf8")):defaults;
for(const [k,v] of Object.entries(defaults))if(db[k]===undefined)db[k]=v;
if(!db.settings.network)db.settings.network="blockhost-net";
const save=()=>fs.writeFileSync(DBFILE,JSON.stringify(db,null,2));
const idify=s=>String(s||"").toLowerCase().trim().replace(/[^a-z0-9_-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,42)||"server";
const now=()=>Date.now();
const token=()=>crypto.randomBytes(32).toString("hex");
const hashPassword=(p,salt=crypto.randomBytes(16).toString("hex"))=>({salt,hash:crypto.scryptSync(p,salt,64).toString("hex")});
const verify=(p,u)=>crypto.timingSafeEqual(Buffer.from(hashPassword(p,u.salt).hash,"hex"),Buffer.from(u.hash,"hex"));
const safeNum=(x,d,min,max)=>{let n=Number(x);if(!Number.isFinite(n))n=d;return Math.max(min,Math.min(max,n))};

function ensureDefault(){
  if(Object.keys(db.instances).length)return;
  db.instances.main={id:"main",name:"Survival",template:"survival",software:"Paper",version:"1.21.10",port:25565,rconPort:25575,memory:4096,cpu:2,disk:20,container:null,status:"stopped",permissions:[],eulaAccepted:false,autoStart:false,createdAt:now(),updatedAt:now()};
  save();
}
ensureDefault();

const templates={
  survival:{name:"Survival",type:"Survival",software:"Paper",memory:4096,cpu:2,disk:20,description:"Balanced survival server with plugins enabled."},
  creative:{name:"Creative",type:"Creative",software:"Paper",memory:3072,cpu:2,disk:15,description:"Creative build server with a lightweight footprint."},
  modded:{name:"Modded",type:"Modded",software:"Fabric",memory:6144,cpu:4,disk:30,description:"Modded server template for Fabric, Forge, or NeoForge."},
  proxy:{name:"Proxy",type:"Proxy",software:"Velocity",memory:2048,cpu:1,disk:5,description:"Velocity network gateway for backend servers."},
  vanilla:{name:"Vanilla",type:"Vanilla",software:"Vanilla",memory:3072,cpu:2,disk:15,description:"Official vanilla Minecraft server."}
};
const softwareType={Paper:"PAPER",Spigot:"SPIGOT",Fabric:"FABRIC",Forge:"FORGE",NeoForge:"NEOFORGE",Vanilla:"VANILLA"};
const proxySoftware=new Set(["Velocity","Waterfall"]);
function volumeName(id){return `blockhost_${id.replace(/[^a-zA-Z0-9_-]/g,"_")}`}
function containerName(id){return `blockhost-${id.replace(/[^a-zA-Z0-9_-]/g,"-")}`}
function runtime(id){return db.instances[id]}
function imageFor(x){return proxySoftware.has(x.software)?"itzg/mc-proxy:java21":"itzg/minecraft-server:java21"}
function docker(args,{input}={}){return new Promise((resolve,reject)=>{const p=spawn("docker",args,{stdio:[input!==undefined?"pipe":"ignore","pipe","pipe"]});let out="",err="";p.stdout.on("data",d=>out+=d);p.stderr.on("data",d=>err+=d);if(input!==undefined){p.stdin.write(input);p.stdin.end()}p.on("close",c=>c===0?resolve(out.trim()):reject(new Error(err.trim()||`docker exited ${c}`)))});}
async function dockerJSON(args){return JSON.parse(await docker(args))}
async function ensureNetwork(){try{await docker(["network","inspect",db.settings.network])}catch{await docker(["network","create",db.settings.network])}}
async function volumeExists(v){try{await docker(["volume","inspect",v]);return true}catch{return false}}
async function ensureVolume(x){if(!(await volumeExists(volumeName(x.id))))await docker(["volume","create",volumeName(x.id)])}
async function containerInspect(x){try{return await dockerJSON(["inspect",containerName(x.id)])}catch{return null}}
async function statusOf(x){const c=await containerInspect(x);if(!c)return "stopped";const s=c[0].State;if(s.Running)return "running";if(s.Restarting)return "restarting";if(s.Status==="created")return "created";return "stopped"}
async function updateStatus(x){x.status=await statusOf(x);x.updatedAt=now();return x.status}
async function allocPort(requested){const used=new Set(Object.values(db.instances).map(x=>x.port));if(requested&&Number.isInteger(Number(requested))&&!used.has(Number(requested)))return Number(requested);let p=Math.max(25565,Number(db.settings.nextPort)||25565);while(used.has(p))p++;db.settings.nextPort=p+1;return p}
async function allocRcon(requested){const used=new Set(Object.values(db.instances).map(x=>x.rconPort));if(requested&&Number.isInteger(Number(requested))&&!used.has(Number(requested)))return Number(requested);let p=Math.max(25575,Number(db.settings.nextRconPort)||25575);while(used.has(p))p++;db.settings.nextRconPort=p+1;return p}
function envArgs(x){const e=["--env","EULA=TRUE","--env",`MEMORY=${x.memory}M`];if(proxySoftware.has(x.software)){e.push("--env",`TYPE=${x.software.toUpperCase()}`,"--env",`SERVER_PORT=${x.port}`);if(x.software==="Velocity")e.push("--env","VELOCITY_VERSION=latest");else e.push("--env","WATERFALL_VERSION=latest");}else{e.push("--env",`TYPE=${softwareType[x.software]||"VANILLA"}`,"--env",`VERSION=${x.version}`,"--env",`SERVER_PORT=25565`,`--env`,`ONLINE_MODE=${x.proxyBackend?"FALSE":"TRUE"}`);e.push("--env","ENABLE_RCON=true", "--env",`RCON_PORT=25575`,"--env",`RCON_PASSWORD=${x.rconPassword}`);if(x.maxPlayers)e.push("--env",`MAX_PLAYERS=${x.maxPlayers}`);if(x.gamemode)e.push("--env",`MODE=${x.gamemode}`)}return e}
async function runContainer(x){await ensureNetwork();await ensureVolume(x);const old=await containerInspect(x);if(old)await docker(["rm","-f",containerName(x.id)]).catch(()=>{});
  const args=["run","-d","--name",containerName(x.id),"--network",db.settings.network,"--restart","unless-stopped","--cpus",String(x.cpu),"--memory",`${x.memory}m`,`--memory-swap`,`${x.memory}m`,`-p`,`${x.port}:${x.software==="Waterfall"?25577:25565}/tcp`];
  if(!proxySoftware.has(x.software))args.push("-p",`${x.rconPort}:25575/tcp`);
  args.push(...envArgs(x),"-v",`${volumeName(x.id)}:${proxySoftware.has(x.software)?"/server":"/data"}`);
  args.push(imageFor(x));
  await docker(args);x.status="running";x.container=containerName(x.id);x.startedAt=now();x.updatedAt=now();save();return x;
}
async function stopContainer(x){try{await docker(["stop","-t","30",containerName(x.id)])}catch{}await updateStatus(x);save()}
async function killContainer(x){try{await docker(["kill",containerName(x.id)])}catch{}await updateStatus(x);save()}
async function removeContainer(x){try{await docker(["rm","-f",containerName(x.id)])}catch{}x.container=null;x.status="stopped";save()}
async function containerStats(x){try{const raw=await docker(["stats","--no-stream","--format","{{json .}}",containerName(x.id)]);const s=JSON.parse(raw.split(/\r?\n/).filter(Boolean)[0]);const cpu=parseFloat(String(s.CPUPerc||"0").replace("%",""));const mem=parseSize(s.MemUsage?.split("/")[0]||"0");const net=(String(s.NetIO||"0B / 0B").split("/"));let disk=0;try{const ins=await dockerJSON(["inspect","--size",containerName(x.id)]);disk=Number(ins[0]?.SizeRw||0)}catch{}return{cpu:cpu||0,ram:mem,rx:parseSize(net[0]),tx:parseSize(net[1]),disk}}catch{return{cpu:0,ram:0,rx:0,tx:0,disk:0}}}
function parseSize(v){const m=String(v).trim().match(/^([\d.]+)\s*([KMGT]?i?B)?$/i);if(!m)return 0;const u=(m[2]||"B").toUpperCase();const k=u.startsWith("KI")?1024:u.startsWith("MI")?1024**2:u.startsWith("GI")?1024**3:u.startsWith("TI")?1024**4:u==="KB"?1000:u==="MB"?1000**2:u==="GB"?1000**3:u==="TB"?1000**4:1;return Number(m[1])*k}

const sha256=x=>crypto.createHash("sha256").update(x).digest("hex");
function auth(req,res,next){const t=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");const uid=db.sessions[t];const u=db.users.find(x=>x.id===uid);if(!u)return res.status(401).json({error:"Authentication required"});req.user=u;req.token=t;next()}
function admin(req,res,next){if(!["owner","admin"].includes(req.user.role))return res.status(403).json({error:"Admin permission required"});next()}
function canAccess(u,x){return u.role==="owner"||u.role==="admin"||(x.permissions||[]).some(p=>p.userId===u.id)}
function instanceAuth(req,res,next){const id=String(req.headers["x-instance-id"]||req.query.instance||req.body?.instance||"");const x=db.instances[id];if(!x)return res.status(400).json({error:"Select a server instance"});if(!canAccess(req.user,x))return res.status(403).json({error:"No access to this server"});req.instance=x;next()}

app.get("/api/mods/search",auth,instanceAuth,async(req,res)=>{try{const q=encodeURIComponent(req.query.q||"");const r=await fetch(`https://api.modrinth.com/v2/search?query=${q}&limit=12`);res.json(await r.json())}catch(e){res.status(500).json({error:e.message})}});
app.get("/api/health",(_,res)=>res.json({ok:true,version:"6.0.0"}));
app.post("/api/auth/register",(req,res)=>{const u=String(req.body.username||"").trim();const p=String(req.body.password||"");if(u.length<3||p.length<8)return res.status(400).json({error:"Username must be 3+ chars and password 8+ chars"});if(db.users.some(x=>x.username.toLowerCase()===u.toLowerCase()))return res.status(409).json({error:"Username already exists"});const h=hashPassword(p);const user={id:crypto.randomUUID(),username:u,role:db.users.length?"member":"owner",...h,createdAt:now()};db.users.push(user);const t=token();db.sessions[t]=user.id;save();res.json({token:t,user:{id:user.id,username:user.username,role:user.role}})});
app.post("/api/auth/login",(req,res)=>{const u=db.users.find(x=>x.username.toLowerCase()===String(req.body.username||"").toLowerCase());if(!u||!verify(String(req.body.password||""),u))return res.status(401).json({error:"Invalid credentials"});const t=token();db.sessions[t]=u.id;save();res.json({token:t,user:{id:u.id,username:u.username,role:u.role}})});
app.get("/api/auth/me",auth,(req,res)=>res.json({id:req.user.id,username:req.user.username,role:req.user.role}));
app.post("/api/auth/logout",auth,(req,res)=>{delete db.sessions[req.token];save();res.json({ok:true})});

app.get("/api/templates",auth,(_,res)=>res.json(templates));
app.get("/api/instances",auth,async(req,res)=>{const out=[];for(const x of Object.values(db.instances))if(canAccess(req.user,x)){await updateStatus(x);out.push({...x,permissions:undefined})}save();res.json(out)});
app.get("/api/instances/:id",auth,(req,res)=>{const x=db.instances[req.params.id];if(!x||!canAccess(req.user,x))return res.status(404).json({error:"Not found"});res.json(x)});
app.post("/api/instances",auth,admin,async(req,res)=>{const t=templates[req.body.template]||templates.survival;const id=idify(req.body.id||req.body.name);if(db.instances[id])return res.status(409).json({error:"That server ID already exists"});const port=await allocPort(req.body.port);const rconPort=await allocRcon(req.body.rconPort);const x={id,name:req.body.name||t.name,template:req.body.template||"survival",type:req.body.type||t.type,software:req.body.software||t.software,version:req.body.version||"1.21.10",port,rconPort,memory:safeNum(req.body.memory,t.memory,512,65536),cpu:safeNum(req.body.cpu,t.cpu,0.25,32),disk:safeNum(req.body.disk,t.disk,1,1000),maxPlayers:safeNum(req.body.maxPlayers,20,1,5000),gamemode:req.body.gamemode||"survival",permissions:[],eulaAccepted:false,autoStart:!!req.body.autoStart,status:"stopped",container:null,rconPassword:crypto.randomBytes(18).toString("hex"),createdAt:now(),updatedAt:now()};db.instances[id]=x;save();if(req.body.install!==false){try{await runContainer(x)}catch(e){x.status="error";x.lastError=e.message;save();return res.status(500).json({error:`Created server but container failed: ${e.message}`,instance:x})}}res.json(x)});
app.put("/api/instances/:id",auth,admin,async(req,res)=>{const x=db.instances[req.params.id];if(!x)return res.status(404).end();if(["port","memory","cpu","software","version"].some(k=>req.body[k]!==undefined)&&await statusOf(x)==="running")return res.status(409).json({error:"Stop the server before changing software, version, port, CPU, or RAM"});if(req.body.port!==undefined&&Object.values(db.instances).some(y=>y.id!==x.id&&y.port===Number(req.body.port)))return res.status(409).json({error:"Port already allocated"});for(const k of ["name","type","software","version","maxPlayers","gamemode","autoStart"])if(req.body[k]!==undefined)x[k]=req.body[k];for(const k of ["memory","cpu","disk","port","rconPort"])if(req.body[k]!==undefined)x[k]=Number(req.body[k]);x.updatedAt=now();save();res.json(x)});
app.delete("/api/instances/:id",auth,admin,async(req,res)=>{const x=db.instances[req.params.id];if(!x)return res.status(404).end();await removeContainer(x);try{await docker(["volume","rm",volumeName(x.id)])}catch{}delete db.instances[x.id];db.schedules=db.schedules.filter(s=>s.instanceId!==x.id);save();res.json({ok:true})});
app.post("/api/instances/:id/access",auth,admin,(req,res)=>{const x=db.instances[req.params.id];if(!x)return res.status(404).end();const uid=String(req.body.userId||"");x.permissions??=[];x.permissions=x.permissions.filter(p=>p.userId!==uid);if(req.body.grant)x.permissions.push({userId:uid,permissions:req.body.permissions||["view","console","start_stop","files","players","backups","mods"]});save();res.json(x.permissions)});
app.post("/api/instances/:id/start",auth,async(req,res)=>{const x=db.instances[req.params.id];if(!x||!canAccess(req.user,x))return res.status(403).end();try{res.json(await runContainer(x))}catch(e){res.status(500).json({error:e.message})}});
app.post("/api/instances/:id/stop",auth,async(req,res)=>{const x=db.instances[req.params.id];if(!x||!canAccess(req.user,x))return res.status(403).end();await stopContainer(x);res.json(x)});
app.post("/api/instances/:id/restart",auth,async(req,res)=>{const x=db.instances[req.params.id];if(!x||!canAccess(req.user,x))return res.status(403).end();await stopContainer(x);try{res.json(await runContainer(x))}catch(e){res.status(500).json({error:e.message})}});
app.post("/api/instances/:id/kill",auth,async(req,res)=>{const x=db.instances[req.params.id];if(!x||!canAccess(req.user,x))return res.status(403).end();await killContainer(x);res.json(x)});
app.get("/api/status",auth,instanceAuth,async(req,res)=>{const x=req.instance;x.status=await statusOf(x);const st=await containerStats(x);res.json({instance:x,status:x.status,running:x.status==="running",metrics:{...st,tps:null,uptime:x.startedAt?Math.floor((now()-x.startedAt)/1000):0},limits:{memory:x.memory,cpu:x.cpu,disk:x.disk}})});
app.get("/api/console",auth,instanceAuth,async(req,res)=>{try{const out=await docker(["logs","--tail","300",containerName(req.instance)]);res.json(out.split(/\r?\n/).filter(Boolean))}catch{res.json([])}});
app.post("/api/command",auth,instanceAuth,async(req,res)=>{const c=String(req.body.command||"").trim();if(!c)return res.status(400).end();try{await docker(["exec",containerName(req.instance),"rcon-cli",...c.split(/\s+/)]);res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});

async function volumeCmd(x,args,input){await ensureVolume(x);const root=proxySoftware.has(x.software)?"/server":"/data";return docker(["run","--rm",...(input!==undefined?["-i"]:[]),"-v",`${volumeName(x.id)}:${root}`,"alpine","sh","-lc",args],{input})}
function vroot(x){return proxySoftware.has(x.software)?"/server":"/data"}
function vpath(x,p){const s=String(p||"").replaceAll("\\","/").replace(/^\/+/,"");if(s.includes(".."))return null;return `${vroot(x)}/${s}`}
const upload=multer({dest:path.join(DATA,"uploads")});
app.post("/api/upload",auth,instanceAuth,upload.single("file"),async(req,res)=>{if(!req.file)return res.status(400).end();const dir=vpath(req.instance,req.body.path||"");const b=fs.readFileSync(req.file.path).toString("base64");fs.unlinkSync(req.file.path);try{await volumeCmd(req.instance,`mkdir -p '${dir}'; echo '${b}' | base64 -d > '${dir}/${path.basename(req.file.originalname).replaceAll("'","'\\''")}'`);res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});

const BACKUP_VOLUME="blockhost_backups";
async function ensureBackupVolume(){if(!(await volumeExists(BACKUP_VOLUME)))await docker(["volume","create",BACKUP_VOLUME])}
async function makeBackup(x){const stamp=new Date().toISOString().replaceAll(":","-");const file=`${x.id}-${stamp}.tar.gz`;await ensureVolume(x);await ensureBackupVolume();await docker(["run","--rm","-v",`${volumeName(x.id)}:/data:ro`,"-v",`${BACKUP_VOLUME}:/backup`,"alpine","tar","-czf",`/backup/${file}`,"-C","/data","."]);const out=await docker(["run","--rm","-v",`${BACKUP_VOLUME}:/backup`,"alpine","sh","-lc",`stat -c %s /backup/${file}`]);const b={id:crypto.randomUUID(),instanceId:x.id,file,time:now(),size:Number(out)||0};db.backups??=[];db.backups.push(b);save();return b}
function streamBackup(file,res){const p=spawn("docker",["run","--rm","-v",`${BACKUP_VOLUME}:/backup:ro`,"alpine","cat",`/backup/${file}`],{stdio:["ignore","pipe","pipe"]});res.setHeader("Content-Type","application/gzip");res.setHeader("Content-Disposition",`attachment; filename="${path.basename(file)}"`);p.stdout.pipe(res);p.on("close",c=>{if(c!==0&&!res.headersSent)res.status(500).end()})}
app.get("/api/backups",auth,instanceAuth,(req,res)=>res.json((db.backups||[]).filter(b=>b.instanceId===req.instance.id).reverse()));
app.post("/api/backup",auth,instanceAuth,async(req,res)=>{try{const b=await makeBackup(req.instance);res.json(b)}catch(e){res.status(500).json({error:e.message})}});
app.get("/api/backup/download",auth,async(req,res)=>{const b=(db.backups||[]).find(x=>x.id===req.query.id);if(!b)return res.status(404).end();const x=db.instances[b.instanceId];if(!x||!canAccess(req.user,x))return res.status(403).end();try{await ensureBackupVolume();streamBackup(b.file,res)}catch(e){res.status(500).json({error:e.message})}});
app.post("/api/backup/restore",auth,instanceAuth,async(req,res)=>{const b=(db.backups||[]).find(x=>x.id===req.body.id&&x.instanceId===req.instance.id);if(!b)return res.status(404).end();try{await ensureBackupVolume();await stopContainer(req.instance);await volumeCmd(req.instance,`rm -rf ${vroot(req.instance)}/* ${vroot(req.instance)}/.[!.]* ${vroot(req.instance)}/..?* || true`);await docker(["run","--rm","-v",`${volumeName(req.instance)}:${vroot(req.instance)}`,"-v",`${BACKUP_VOLUME}:/backup:ro`,"alpine","tar","-xzf",`/backup/${b.file}`,"-C",vroot(req.instance)]);res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});
app.delete("/api/backup",auth,instanceAuth,async(req,res)=>{const b=(db.backups||[]).find(x=>x.id===req.query.id&&x.instanceId===req.instance.id);if(!b)return res.status(404).end();try{await ensureBackupVolume();await docker(["run","--rm","-v",`${BACKUP_VOLUME}:/backup`,"alpine","rm","-f",`/backup/${b.file}`]);db.backups=db.backups.filter(y=>y.id!==b.id);save();res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});

app.get("/api/schedules",auth,admin,(req,res)=>res.json(db.schedules));
app.post("/api/schedules",auth,admin,(req,res)=>{const x=db.instances[req.body.instanceId];if(!x)return res.status(400).json({error:"Invalid instance"});const s={id:crypto.randomUUID(),instanceId:x.id,type:req.body.type,intervalMinutes:safeNum(req.body.intervalMinutes,1440,1,525600),enabled:req.body.enabled!==false,nextRun:now()+safeNum(req.body.intervalMinutes,1440,1,525600)*60000};db.schedules.push(s);save();res.json(s)});
app.put("/api/schedules/:id",auth,admin,(req,res)=>{const s=db.schedules.find(x=>x.id===req.params.id);if(!s)return res.status(404).end();if(req.body.intervalMinutes!==undefined)s.intervalMinutes=safeNum(req.body.intervalMinutes,s.intervalMinutes,1,525600);if(req.body.enabled!==undefined)s.enabled=!!req.body.enabled;s.nextRun=now()+s.intervalMinutes*60000;save();res.json(s)});
app.delete("/api/schedules/:id",auth,admin,(req,res)=>{db.schedules=db.schedules.filter(x=>x.id!==req.params.id);save();res.json({ok:true})});
async function scheduler(){for(const s of db.schedules){if(!s.enabled||s.nextRun>now())continue;const x=db.instances[s.instanceId];if(!x)continue;try{if(s.type==="backup")await makeBackup(x);if(s.type==="restart"){await stopContainer(x);await runContainer(x)}}catch(e){x.lastError=e.message}finally{s.nextRun=now()+s.intervalMinutes*60000;save()}}}
setInterval(scheduler,15000);setInterval(async()=>{for(const x of Object.values(db.instances)){try{await updateStatus(x)}catch{}}save()},30000);

app.get("/api/settings",auth,(req,res)=>res.json(db.settings));
app.get("/api/users",auth,admin,(req,res)=>res.json(db.users.map(x=>({id:x.id,username:x.username,role:x.role,createdAt:x.createdAt}))));
app.post("/api/users/:id/role",auth,admin,(req,res)=>{const u=db.users.find(x=>x.id===req.params.id);if(!u)return res.status(404).end();u.role=["member","admin"].includes(req.body.role)?req.body.role:"member";save();res.json({ok:true})});

app.post("/api/invites",auth,instanceAuth,(req,res)=>{const key=token();const invite={id:crypto.randomUUID(),instanceId:req.instance.id,keyHash:sha256(key),expiresAt:now()+safeNum(req.body.hours,72,1,720)*3600000,maxUses:safeNum(req.body.maxUses,5,1,1000),uses:0,permissions:req.body.permissions||["view","console","start_stop"]};db.invites[invite.id]=invite;save();res.json({id:invite.id,key,link:`/invite/${invite.id}?key=${key}`})});
app.post("/api/invites/:id/accept",auth,async(req,res)=>{const i=db.invites[req.params.id],x=i&&db.instances[i.instanceId];if(!i||!x||i.expiresAt<now()||i.uses>=i.maxUses||sha256(String(req.body.key||""))!==i.keyHash)return res.status(400).json({error:"Invite is invalid, expired, or exhausted"});x.permissions??=[];x.permissions=x.permissions.filter(p=>p.userId!==req.user.id);x.permissions.push({userId:req.user.id,permissions:i.permissions});i.uses++;save();res.json({ok:true,instance:x.id})});

app.get("/api/players",auth,instanceAuth,async(req,res)=>{try{const out=await docker(["exec",containerName(req.instance),"rcon-cli","list"]);const m=out.match(/There are (\d+) of a max of (\d+) players online(?:: (.*))?/i);res.json({count:Number(m?.[1]||0),max:Number(m?.[2]||req.instance.maxPlayers||0),players:m?.[3]?m[3].split(", ").filter(Boolean):[]})}catch(e){res.json({count:0,max:req.instance.maxPlayers||0,players:[],error:e.message})}});
app.post("/api/player/action",auth,instanceAuth,async(req,res)=>{const allowed=["op","deop","kick","ban","pardon","whitelist add","whitelist remove"];const action=String(req.body.action||"");const name=String(req.body.name||"");if(!allowed.includes(action)||!name)return res.status(400).end();try{await docker(["exec",containerName(req.instance),"rcon-cli",...action.split(" "),name]);res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});
app.post("/api/mods/install",auth,instanceAuth,async(req,res)=>{try{const project=encodeURIComponent(req.body.project||"");const loader=req.instance.software.toLowerCase();const version=req.instance.version;const r=await fetch(`https://api.modrinth.com/v2/project/${project}/version?game_versions=%5B%22${encodeURIComponent(version)}%22%5D&loaders=%5B%22${encodeURIComponent(loader)}%22%5D`);if(!r.ok)throw Error(`Modrinth ${r.status}`);const versions=await r.json();const v=versions[0];const f=v?.files?.find(z=>z.primary)||v?.files?.[0];if(!f)throw Error("No compatible file found");const bin=Buffer.from(await (await fetch(f.url)).arrayBuffer());const dir=(loader==="paper"||loader==="spigot")?"plugins":"mods";const b64=bin.toString("base64");await volumeCmd(req.instance,`mkdir -p ${vroot(req.instance)}/${dir}; echo '${b64}' | base64 -d > ${vroot(req.instance)}/${dir}/${path.basename(f.filename).replaceAll("'","'\\''")}`);res.json({ok:true,file:f.filename})}catch(e){res.status(500).json({error:e.message})}});
app.get("/api/installer/catalog",auth,async(_,res)=>res.json({software:["Vanilla","Paper","Fabric","Forge","NeoForge","Velocity","Waterfall"],versions:["1.21.10","1.21.9","1.21.8","1.21.7","1.21.6","1.21.5","1.21.4","1.21.1","1.20.6","1.20.4","1.20.1"],note:"Containerized installers use itzg images and pull the selected version at first start."}));
app.get("/api/metrics",auth,instanceAuth,async(req,res)=>res.json(await containerStats(req.instance)));

app.get("/api/proxy/backends",auth,instanceAuth,(req,res)=>{if(!proxySoftware.has(req.instance.software))return res.status(400).json({error:"Current instance is not a proxy"});res.json(req.instance.backends||[])});
app.put("/api/proxy/backends",auth,instanceAuth,async(req,res)=>{if(!proxySoftware.has(req.instance.software))return res.status(400).json({error:"Current instance is not a proxy"});req.instance.backends=(req.body.backends||[]).map(b=>({name:idify(b.name),instanceId:b.instanceId})).filter(b=>db.instances[b.instanceId]&&b.instanceId!==req.instance.id);for(const b of req.instance.backends){const backend=db.instances[b.instanceId];backend.proxyBackend=true;}
  if(req.instance.software==="Velocity"){const rootText=`config-version = "2.7"\nbind = "0.0.0.0:${req.instance.port}"\nmotd = "BlockHost Network"\nshow-max-players = 500\nonline-mode = true\nplayer-info-forwarding-mode = "modern"\nforwarding-secret-file = "forwarding.secret"\nping-passthrough = "DESCRIPTION"\n\n[servers]\n${req.instance.backends.map(b=>`${b.name} = "${containerName(b.instanceId)}:25565"`).join("\n")}\ntry = [${req.instance.backends.map(b=>`"${b.name}"`).join(", ")}]\n`;
    const encoded=Buffer.from(rootText).toString("base64");await volumeCmd(req.instance,`echo '${encoded}' | base64 -d > /data/velocity.toml; echo '${crypto.randomBytes(24).toString("hex")}' > /data/forwarding.secret`)}
  save();res.json(req.instance.backends)});

app.get("/invite/:id",(_,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

const server=app.listen(PORT,()=>console.log(`BlockHost 6 listening on ${PORT}`));
const wss=new WebSocketServer({server});
wss.on("connection",ws=>{ws.send(JSON.stringify({type:"hello",version:"6.0.0"}))});

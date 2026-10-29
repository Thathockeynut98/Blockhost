import express from "express";
import {WebSocketServer} from "ws";
import {spawn,execFile} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import {fileURLToPath} from "node:url";
import multer from "multer";
import {publicAccessRouter} from "./public-access.js";
import {groups,definitions,validateSettings,parseProperties,mergeProperties} from "./settings-schema.js";

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
const softwareType={Paper:"PAPER",Spigot:"SPIGOT",Fabric:"FABRIC",Forge:"FORGE",NeoForge:"NEOFORGE",Purpur:"PURPUR",Pufferfish:"PUFFERFISH",Leaf:"LEAF",Folia:"FOLIA",Vanilla:"VANILLA"};
const proxySoftware=new Set(["Velocity","Waterfall"]);
function volumeName(id){return `blockhost_${id.replace(/[^a-zA-Z0-9_-]/g,"_")}`}
function containerName(id){return `blockhost-${id.replace(/[^a-zA-Z0-9_-]/g,"-")}`}
function runtime(id){return db.instances[id]}
function imageFor(x){return proxySoftware.has(x.software)?"itzg/mc-proxy:java21":"itzg/minecraft-server:java21"}
function docker(args,{input}={}){return new Promise((resolve,reject)=>{const p=spawn("docker",args,{stdio:[input!==undefined?"pipe":"ignore","pipe","pipe"]});let out="",err="";p.stdout.on("data",d=>out+=d);p.stderr.on("data",d=>err+=d);if(input!==undefined){p.stdin.write(input);p.stdin.end()}p.on("close",c=>c===0?resolve((args[0]==="logs"?(out+err):out).trim()):reject(new Error(err.trim()||`docker exited ${c}`)))});}
async function dockerJSON(args){return JSON.parse(await docker(args))}
async function ensureNetwork(){try{await docker(["network","inspect",db.settings.network])}catch{await docker(["network","create",db.settings.network])}}
async function volumeExists(v){try{await docker(["volume","inspect",v]);return true}catch{return false}}
async function ensureVolume(x){if(!(await volumeExists(volumeName(x.id))))await docker(["volume","create",volumeName(x.id)])}
async function containerInspect(x){try{return await dockerJSON(["inspect",containerName(x.id)])}catch{return null}}
async function statusOf(x){const c=await containerInspect(x);if(!c)return "stopped";const s=c[0].State;if(s.Running)return "running";if(s.Restarting)return "restarting";if(s.Status==="created")return "created";return "stopped"}
async function updateStatus(x){x.status=await statusOf(x);x.updatedAt=now();return x.status}
async function allocPort(requested){const used=new Set(Object.values(db.instances).map(x=>x.port));if(requested&&Number.isInteger(Number(requested))&&!used.has(Number(requested)))return Number(requested);let p=Math.max(25565,Number(db.settings.nextPort)||25565);while(used.has(p))p++;db.settings.nextPort=p+1;return p}
async function allocRcon(requested){const used=new Set(Object.values(db.instances).map(x=>x.rconPort));if(requested&&Number.isInteger(Number(requested))&&!used.has(Number(requested)))return Number(requested);let p=Math.max(25575,Number(db.settings.nextRconPort)||25575);while(used.has(p))p++;db.settings.nextRconPort=p+1;return p}
function envArgs(x){const e=["--env",`EULA=${x.eulaAccepted===true?"TRUE":"FALSE"}`,"--env",`MEMORY=${x.memory}M`];if(proxySoftware.has(x.software)){e.push("--env",`TYPE=${x.software.toUpperCase()}`,"--env",`SERVER_PORT=${x.port}`);if(x.software==="Velocity")e.push("--env","VELOCITY_VERSION=latest");else e.push("--env","WATERFALL_VERSION=latest");}else{if(x.imported&&x.jar){e.push("--env","TYPE=CUSTOM","--env",`CUSTOM_SERVER=/data/${x.jar.replaceAll("'","'")}`)}else{e.push("--env",`TYPE=${softwareType[x.software]||"VANILLA"}`,"--env",`VERSION=${x.version}`);}e.push("--env",`SERVER_PORT=25565`,`--env`,`ONLINE_MODE=${x.proxyBackend?"FALSE":"TRUE"}`);e.push("--env","ENABLE_RCON=true", "--env",`RCON_PORT=25575`,"--env",`RCON_PASSWORD=${x.rconPassword}`);}return e}
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
app.post("/api/instances",auth,admin,async(req,res)=>{if(req.body.eulaAccepted!==true)return res.status(400).json({error:"You must explicitly accept the Minecraft EULA to create a server"});const t=templates[req.body.template]||templates.survival;const id=idify(req.body.id||req.body.name);if(db.instances[id])return res.status(409).json({error:"That server ID already exists"});const port=await allocPort(req.body.port);const rconPort=await allocRcon(req.body.rconPort);const x={id,name:req.body.name||t.name,template:req.body.template||"survival",type:req.body.type||t.type,software:req.body.software||t.software,version:req.body.version||"1.21.10",port,rconPort,memory:safeNum(req.body.memory,t.memory,512,65536),cpu:safeNum(req.body.cpu,t.cpu,0.25,32),disk:safeNum(req.body.disk,t.disk,1,1000),maxPlayers:safeNum(req.body.maxPlayers,20,1,5000),gamemode:req.body.gamemode||"survival",permissions:[],eulaAccepted:req.body.eulaAccepted===true,autoStart:!!req.body.autoStart,status:"stopped",container:null,rconPassword:crypto.randomBytes(18).toString("hex"),createdAt:now(),updatedAt:now()};db.instances[id]=x;save();if(req.body.install!==false){try{await runContainer(x)}catch(e){x.status="error";x.lastError=e.message;save();return res.status(500).json({error:`Created server but container failed: ${e.message}`,instance:x})}}res.json(x)});
app.put("/api/instances/:id",auth,admin,async(req,res)=>{const x=db.instances[req.params.id];if(!x)return res.status(404).end();if(["port","memory","cpu","software","version"].some(k=>req.body[k]!==undefined)&&await statusOf(x)==="running")return res.status(409).json({error:"Stop the server before changing software, version, port, CPU, or RAM"});if(req.body.port!==undefined&&Object.values(db.instances).some(y=>y.id!==x.id&&y.port===Number(req.body.port)))return res.status(409).json({error:"Port already allocated"});for(const k of ["name","type","software","version","maxPlayers","gamemode","autoStart"])if(req.body[k]!==undefined)x[k]=req.body[k];for(const k of ["memory","cpu","disk","port","rconPort"])if(req.body[k]!==undefined)x[k]=Number(req.body[k]);x.updatedAt=now();save();res.json(x)});
app.delete("/api/instances/:id",auth,admin,async(req,res)=>{const x=db.instances[req.params.id];if(!x)return res.status(404).end();await removeContainer(x);try{await docker(["volume","rm",volumeName(x.id)])}catch{}delete db.instances[x.id];db.schedules=db.schedules.filter(s=>s.instanceId!==x.id);save();res.json({ok:true})});
app.post("/api/instances/:id/access",auth,admin,(req,res)=>{const x=db.instances[req.params.id];if(!x)return res.status(404).end();const uid=String(req.body.userId||"");x.permissions??=[];x.permissions=x.permissions.filter(p=>p.userId!==uid);if(req.body.grant)x.permissions.push({userId:uid,permissions:req.body.permissions||["view","console","start_stop","files","players","backups","mods"]});save();res.json(x.permissions)});
app.post("/api/instances/:id/start",auth,async(req,res)=>{const x=db.instances[req.params.id];if(!x||!canAccess(req.user,x))return res.status(403).end();try{res.json(await runContainer(x))}catch(e){res.status(500).json({error:e.message})}});
app.post("/api/instances/:id/stop",auth,async(req,res)=>{const x=db.instances[req.params.id];if(!x||!canAccess(req.user,x))return res.status(403).end();await stopContainer(x);res.json(x)});
app.post("/api/instances/:id/restart",auth,async(req,res)=>{const x=db.instances[req.params.id];if(!x||!canAccess(req.user,x))return res.status(403).end();await stopContainer(x);try{res.json(await runContainer(x))}catch(e){res.status(500).json({error:e.message})}});
app.post("/api/instances/:id/kill",auth,async(req,res)=>{const x=db.instances[req.params.id];if(!x||!canAccess(req.user,x))return res.status(403).end();await killContainer(x);res.json(x)});
app.get("/api/status",auth,instanceAuth,async(req,res)=>{const x=req.instance;x.status=await statusOf(x);const st=await containerStats(x);res.json({instance:x,status:x.status,running:x.status==="running",metrics:{...st,tps:null,uptime:x.startedAt?Math.floor((now()-x.startedAt)/1000):0},limits:{memory:x.memory,cpu:x.cpu,disk:x.disk}})});
function readContainerLogs(name){
 return new Promise((resolve,reject)=>{
  const p=spawn("docker",["logs","--timestamps","--tail","300",name],{stdio:["ignore","pipe","pipe"]});
  const chunks=[];let stderr="";let bytes=0;const maxBytes=1024*1024;
  function collect(stream,isError){
   stream.on("data",chunk=>{
    if(isError)stderr+=chunk.toString();
    if(bytes<maxBytes){chunks.push(chunk.toString().slice(0,maxBytes-bytes));bytes+=chunk.length;}
   });
  }
  collect(p.stdout,false);collect(p.stderr,true);
  p.on("error",reject);
  p.on("close",code=>{
   if(code!==0)return reject(new Error(stderr.trim()||"docker logs exited "+code));
   resolve(chunks.join("").split(/\\r?\\n/).filter(Boolean).slice(-300));
  });
 });
}
app.get("/api/console",auth,instanceAuth,async(req,res)=>{
 try{res.json(await readContainerLogs(containerName(req.instance.id)))}
 catch(e){res.status(502).json({error:"Unable to retrieve Docker logs: "+e.message})}
});
app.post("/api/command",auth,instanceAuth,async(req,res)=>{const c=String(req.body.command||"").trim();if(!c)return res.status(400).end();try{await docker(["exec",containerName(req.instance.id),"rcon-cli",...c.split(/\s+/)]);res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});

async function volumeCmd(x,args,input){await ensureVolume(x);const root=proxySoftware.has(x.software)?"/server":"/data";return docker(["run","--rm",...(input!==undefined?["-i"]:[]),"-v",`${volumeName(x.id)}:${root}`,"alpine","sh","-lc",args],{input})}
function vroot(x){return proxySoftware.has(x.software)?"/server":"/data"}
function vpath(x,p){const s=String(p||"").replaceAll("\\","/").replace(/^\/+/,"");if(s.includes(".."))return null;return `${vroot(x)}/${s}`}

/* File manager: operate on the same persistent Docker volume mounted by Minecraft.
   All paths are relative to /data (or /server for proxy instances). */
function fileRelative(value,{allowRoot=false}={}){
 const p=String(value??"").replaceAll("\\","/").replace(/^\/+|\/+$/g,"");
 if(!p&&allowRoot)return "";
 if(!p||p.length>1024||p.split("/").some(x=>!x||x==="."||x===".."||/[\x00-\x1f]/.test(x)))throw new Error("Invalid file path");
 return p;
}
function shellArg(s){return "'"+String(s).replaceAll("'","'\\''")+"'";}
function fileError(res,e){res.status(400).json({error:e.message||"File operation failed"});}
app.get("/api/files",auth,instanceAuth,async(req,res)=>{
 try{
  const rel=fileRelative(req.query.path,{allowRoot:true});
  const base=vroot(req.instance),target=base+(rel?"/"+rel:"");
  const command="cd "+shellArg(target)+" && find . -mindepth 1 -maxdepth 1 -exec stat -c '%F|%s|%n' {} \\;";
  const out=await volumeCmd(req.instance,command);
  const rows=out.split(/\r?\n/).filter(Boolean).map(line=>{
   const m=line.match(/^([^|]+)\|(\d+)\|\.\x2f(.*)$/);
   if(!m)return null;
   const name=m[3],type=m[1].includes("directory")?"dir":m[1].includes("regular file")?"file":"other";
   return {name,type,size:Number(m[2]),path:rel?rel+"/"+name:name};
  }).filter(x=>x&&x.type!=="other");
  rows.sort((a,b)=>(a.type==="dir"?0:1)-(b.type==="dir"?0:1)||a.name.localeCompare(b.name));
  res.json(rows);
 }catch(e){fileError(res,e)}
});
app.get("/api/file",auth,instanceAuth,async(req,res)=>{
 try{
  const rel=fileRelative(req.query.path);
  const target=vroot(req.instance)+"/"+rel;
  const limit=2*1024*1024;
  const command="test -f "+shellArg(target)+" && test $(wc -c < "+shellArg(target)+") -le "+limit+" && cat "+shellArg(target);
  const content=await volumeCmd(req.instance,command);
  if(content.includes("\\u0000"))return res.status(415).send("Binary files cannot be edited as text");
  res.type("text/plain; charset=utf-8").send(content);
 }catch(e){fileError(res,e)}
});
app.put("/api/file",auth,instanceAuth,express.json({limit:"2mb"}),async(req,res)=>{
 try{
  const rel=fileRelative(req.body.path),content=req.body.content;
  if(typeof content!=="string"||Buffer.byteLength(content,"utf8")>2*1024*1024)throw new Error("Text content exceeds 2 MB");
  if(content.includes("\\u0000"))throw new Error("Binary content is not supported");
  const target=vroot(req.instance)+"/"+rel;
  const parent=target.slice(0,target.lastIndexOf("/"));
  // Write to a temporary file and rename to avoid partial saves.
  const command="mkdir -p "+shellArg(parent)+" && cat > "+shellArg(target+".blockhost-tmp")+" && mv "+shellArg(target+".blockhost-tmp")+" "+shellArg(target);
  await volumeCmd(req.instance,command,content);
  res.json({ok:true});
 }catch(e){fileError(res,e)}
});
app.post("/api/folder",auth,instanceAuth,async(req,res)=>{
 try{
  const rel=fileRelative(req.body.path);
  await volumeCmd(req.instance,"mkdir -p "+shellArg(vroot(req.instance)+"/"+rel));
  res.json({ok:true});
 }catch(e){fileError(res,e)}
});


/* Download, rename and delete files from the selected Minecraft data volume. */
function safeFileLocation(x,relative){
 const rel=fileRelative(relative);
 const root=vroot(x);
 return {rel,root,full:root+"/"+rel};
}
function safeVolumeTarget(root,rel){
 // Reject symlinks at any component, including the final path.
 const pieces=rel.split("/");
 let cmd="set -e; ";
 let prefix=root;
 for(const piece of pieces){
  prefix+="/"+piece;
  cmd+="test ! -L "+shellArg(prefix)+"; ";
 }
 return cmd;
}
app.get("/api/file/download",auth,instanceAuth,async(req,res)=>{
 let child;
 try{
  const {rel,root,full}=safeFileLocation(req.instance,req.query.path);
  const volume=volumeName(req.instance.id);
  await ensureVolume(req.instance);
  const isDir=(await volumeCmd(req.instance,safeVolumeTarget(root,rel)+"test -d "+shellArg(full)+" && echo yes || true")).trim()==="yes";
  const filename=rel.split("/").at(-1)+(isDir?".tar.gz":"");
  const safeName=filename.replace(/[^a-zA-Z0-9._-]/g,"_");
  const command=safeVolumeTarget(root,rel)+"test -e "+shellArg(full)+"; "+
   (isDir?"cd "+shellArg(root)+" && tar -czf - "+shellArg(rel):
    "test -f "+shellArg(full)+" && cat "+shellArg(full));
  res.setHeader("Content-Type",isDir?"application/gzip":"application/octet-stream");
  res.setHeader("Content-Disposition",'attachment; filename="'+safeName+'"');
  child=spawn("docker",["run","--rm","-v",volume+":"+root+":ro","alpine","sh","-lc",command],{stdio:["ignore","pipe","pipe"]});
  let err="";
  child.stderr.on("data",d=>err+=d.toString());
  child.on("error",e=>{if(!res.headersSent)res.status(500).end(e.message);else res.destroy(e)});
  child.on("close",code=>{if(code!==0){if(!res.headersSent)res.status(500).end(err||"Download failed");else res.destroy()}else res.end()});
  child.stdout.pipe(res,{end:false});
  res.on("close",()=>{if(!child.killed)child.kill()});
 }catch(e){if(child)child.kill();if(!res.headersSent)fileError(res,e)}
});
app.post("/api/file/rename",auth,instanceAuth,async(req,res)=>{
 try{
  const {rel,root,full}=safeFileLocation(req.instance,req.body.path);
  const name=String(req.body.newName||"");
  if(!name||name==="."||name===".."||name.includes("/")||name.includes("\\")||/[\\x00-\\x1f]/.test(name))throw new Error("Invalid new name");
  const parent=rel.split("/").slice(0,-1).join("/");
  const next=(parent?parent+"/":"")+name;
  const target=root+"/"+next;
  const cmd=safeVolumeTarget(root,rel)+safeVolumeTarget(root,next)+
   "test -e "+shellArg(full)+"; test ! -e "+shellArg(target)+"; mv "+shellArg(full)+" "+shellArg(target);
  await volumeCmd(req.instance,cmd);
  res.json({ok:true,path:next});
 }catch(e){fileError(res,e)}
});
app.delete("/api/file",auth,instanceAuth,async(req,res)=>{
 try{
  const {rel,root,full}=safeFileLocation(req.instance,req.body?.path);
  if(req.body?.confirm!==rel)throw new Error("Deletion confirmation does not match the selected path");
  const cmd=safeVolumeTarget(root,rel)+"test -e "+shellArg(full)+"; rm -rf -- "+shellArg(full);
  await volumeCmd(req.instance,cmd);
  res.json({ok:true});
 }catch(e){fileError(res,e)}
});

const upload=multer({dest:path.join(DATA,"uploads"),limits:{fileSize:8*1024*1024*1024}});
const folderUpload=multer({dest:path.join(DATA,"folder-uploads"),limits:{fileSize:8*1024*1024*1024,files:100000}});
function safeRelativeUploadPath(value){
  const normalized=String(value||"").replaceAll("\\","/").replace(/^\/+/,"");
  if(!normalized||normalized.split("/").some(part=>!part||part==="."||part===".."))return null;
  return normalized;
}
function restoreUploadedFolder(files,temp){
  for(const file of files){
    const rel=safeRelativeUploadPath(file.originalname);
    if(!rel)throw new Error(`Invalid folder entry: ${file.originalname}`);
    const dest=path.join(temp,rel);
    if(!dest.startsWith(path.resolve(temp)+path.sep))throw new Error("Invalid folder path");
    fs.mkdirSync(path.dirname(dest),{recursive:true});
    fs.renameSync(file.path,dest);
  }
}

function detectImportedSoftware(root){
  const names=fs.readdirSync(root,{withFileTypes:true}).map(x=>x.name.toLowerCase());
  if(fs.existsSync(path.join(root,"velocity.toml")))return "Velocity";
  if(fs.existsSync(path.join(root,"waterfall.yml"))||fs.existsSync(path.join(root,"bungee.yml")))return "Waterfall";
  if(names.some(n=>n.includes("neoforge"))||fs.existsSync(path.join(root,"user_jvm_args.txt"))&&fs.existsSync(path.join(root,"libraries")))return "NeoForge";
  if(names.some(n=>n.includes("forge"))||fs.existsSync(path.join(root,"libraries","net","minecraftforge")))return "Forge";
  if(fs.existsSync(path.join(root,"fabric-server-launch.jar"))||fs.existsSync(path.join(root,"libraries","net","fabricmc")))return "Fabric";
  if(names.some(n=>n.startsWith("paper")&&n.endsWith(".jar")))return "Paper";
  if(names.some(n=>n.startsWith("spigot")&&n.endsWith(".jar")))return "Spigot";
  return "Vanilla";
}
function findImportRoot(base){
  const hasServerFile=(d)=>{const n=fs.readdirSync(d,{withFileTypes:true}).map(x=>x.name.toLowerCase());return n.includes("server.properties")||n.some(x=>x.endsWith(".jar"))||n.includes("velocity.toml")||n.includes("waterfall.yml")||n.includes("bungee.yml")};
  if(hasServerFile(base))return base;
  const dirs=fs.readdirSync(base,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>path.join(base,x.name));
  const candidate=dirs.find(hasServerFile);
  return candidate||base;
}
function parseImportedProperties(root){
  const out={};const f=path.join(root,"server.properties");if(!fs.existsSync(f))return out;
  for(const line of fs.readFileSync(f,"utf8").split(/\r?\n/)){if(!line||line.startsWith("#"))continue;const i=line.indexOf("=");if(i<1)continue;out[line.slice(0,i).trim()]=line.slice(i+1).trim()}
  return out;
}
async function copyDirectoryToVolume(x,src){
  await ensureVolume(x);
  return new Promise((resolve,reject)=>{
    const tar=spawn("tar",["-cf","-","-C",src,"."]);const dockerP=spawn("docker",["run","--rm","-i","-v",`${volumeName(x.id)}:/data`,"alpine","tar","-xf","-","-C","/data"],{stdio:["pipe","pipe","pipe"]});
    let err="";tar.stderr.on("data",d=>err+=d);dockerP.stderr.on("data",d=>err+=d);tar.stdout.pipe(dockerP.stdin);
    let done=false;const finish=(e)=>{if(done)return;done=true;e?reject(e):resolve()};tar.on("error",finish);dockerP.on("error",finish);tar.on("close",c=>{if(c!==0)finish(new Error(err||`tar exited ${c}`));else dockerP.stdin.end()});dockerP.on("close",c=>{if(c!==0)finish(new Error(err||`docker import exited ${c}`));else finish()});
  });
}
app.post("/api/instances/import-folder",auth,admin,folderUpload.array("serverFiles",100000),async(req,res)=>{
  if(!req.files?.length)return res.status(400).json({error:"Choose an existing Minecraft server folder."});
  const temp=path.join(DATA,"imports",crypto.randomUUID());fs.mkdirSync(temp,{recursive:true});
  try{
    restoreUploadedFolder(req.files,temp);
    const root=findImportRoot(temp);const detected=detectImportedSoftware(root);const props=parseImportedProperties(root);
    const software=["Velocity","Waterfall","Paper","Spigot","Fabric","Forge","NeoForge","Purpur","Pufferfish","Leaf","Folia","Vanilla"].includes(req.body.software)?req.body.software:detected;
    const folderName=path.basename(String(req.files[0].originalname).replaceAll("\\","/").split("/")[0])||"Imported Server";
    const id=idify(req.body.id||req.body.name||folderName);if(db.instances[id])throw new Error("That server ID already exists");
    const port=await allocPort(req.body.port||props["server-port"]);const rconPort=await allocRcon(req.body.rconPort);const eulaFile=path.join(root,"eula.txt");const existingEula=fs.existsSync(eulaFile)&&/eula\s*=\s*true/i.test(fs.readFileSync(eulaFile,"utf8"));const accepted=existingEula||String(req.body.acceptEula)==="true";
    if(!accepted)throw new Error("This server does not contain an accepted eula.txt. Confirm the Minecraft EULA in the import dialog.");
    if(!existingEula)fs.writeFileSync(eulaFile,"# Generated by BlockHost\neula=true\n");
    let jar=fs.readdirSync(root).find(n=>n.toLowerCase().endsWith(".jar"));if(!jar&&!proxySoftware.has(software))throw new Error("No server JAR was found in the selected folder.");
    const t=Object.values(templates).find(x=>x.software===software)||templates.survival;
    const x={id,name:req.body.name||folderName,template:"imported",type:req.body.type||"Imported",software,version:req.body.version||"Imported",port,rconPort,memory:safeNum(req.body.memory,t.memory,512,65536),cpu:safeNum(req.body.cpu,t.cpu,0.25,32),disk:safeNum(req.body.disk,t.disk,1,1000),maxPlayers:safeNum(req.body.maxPlayers,Number(props["max-players"])||20,1,5000),gamemode:req.body.gamemode||props.gamemode||"survival",permissions:[],eulaAccepted:true,autoStart:false,status:"stopped",container:null,rconPassword:crypto.randomBytes(18).toString("hex"),imported:true,jar:jar||null,createdAt:now(),updatedAt:now()};
    db.instances[id]=x;save();await copyDirectoryToVolume(x,root);save();
    res.json({...x,importedSoftware:detected,detectedPort:props["server-port"]||null,importSource:"folder"});
  }catch(e){res.status(400).json({error:e.message})}finally{try{fs.rmSync(temp,{recursive:true,force:true})}catch{}for(const f of req.files||[]){try{fs.unlinkSync(f.path)}catch{}}}
});
app.post("/api/instances/import",auth,admin,upload.single("archive"),async(req,res)=>{
  if(!req.file)return res.status(400).json({error:"Choose a .zip, .tar, or .tar.gz server archive."});
  const temp=path.join(DATA,"imports",crypto.randomUUID());fs.mkdirSync(temp,{recursive:true});
  try{
    const name=req.file.originalname.toLowerCase();
    if(name.endsWith(".zip"))await new Promise((resolve,reject)=>execFile("unzip",["-q",req.file.path,"-d",temp],e=>e?reject(e):resolve()));
    else if(name.endsWith(".tar.gz")||name.endsWith(".tgz"))await new Promise((resolve,reject)=>execFile("tar",["-xzf",req.file.path,"-C",temp],e=>e?reject(e):resolve()));
    else if(name.endsWith(".tar"))await new Promise((resolve,reject)=>execFile("tar",["-xf",req.file.path,"-C",temp],e=>e?reject(e):resolve()));
    else throw new Error("Unsupported archive. Use ZIP, TAR, or TAR.GZ.");
    const root=findImportRoot(temp);const detected=detectImportedSoftware(root);const props=parseImportedProperties(root);
    const software=["Velocity","Waterfall","Paper","Spigot","Fabric","Forge","NeoForge","Purpur","Pufferfish","Leaf","Folia","Vanilla"].includes(req.body.software)?req.body.software:detected;
    const id=idify(req.body.id||req.body.name||path.basename(req.file.originalname).replace(/\.(zip|tar|gz|tgz)$/gi,""));if(db.instances[id])throw new Error("That server ID already exists");
    const port=await allocPort(req.body.port||props["server-port"]);const rconPort=await allocRcon(req.body.rconPort);const eulaFile=path.join(root,"eula.txt");const existingEula=fs.existsSync(eulaFile)&&/eula\s*=\s*true/i.test(fs.readFileSync(eulaFile,"utf8"));const accepted=existingEula||String(req.body.acceptEula)==="true";
    if(!accepted)throw new Error("This server does not contain an accepted eula.txt. Confirm the Minecraft EULA in the import dialog.");
    if(!existingEula)fs.writeFileSync(eulaFile,"# Generated by BlockHost\neula=true\n");
    let jar=fs.readdirSync(root).find(n=>n.toLowerCase().endsWith(".jar"));if(!jar&&!proxySoftware.has(software))throw new Error("No server JAR was found in the imported archive.");
    const t=Object.values(templates).find(x=>x.software===software)||templates.survival;
    const x={id,name:req.body.name||path.basename(req.file.originalname).replace(/\.(zip|tar|gz|tgz)$/gi,""),template:"imported",type:req.body.type||"Imported",software,version:req.body.version||"Imported",port,rconPort,memory:safeNum(req.body.memory,t.memory,512,65536),cpu:safeNum(req.body.cpu,t.cpu,0.25,32),disk:safeNum(req.body.disk,t.disk,1,1000),maxPlayers:safeNum(req.body.maxPlayers,Number(props["max-players"])||20,1,5000),gamemode:req.body.gamemode||props.gamemode||"survival",permissions:[],eulaAccepted:true,autoStart:false,status:"stopped",container:null,rconPassword:crypto.randomBytes(18).toString("hex"),imported:true,jar:jar||null,createdAt:now(),updatedAt:now()};
    db.instances[id]=x;save();await copyDirectoryToVolume(x,root);save();
    res.json({...x,importedSoftware:detected,detectedPort:props["server-port"]||null});
  }catch(e){res.status(400).json({error:e.message})}finally{try{fs.rmSync(temp,{recursive:true,force:true})}catch{}try{fs.unlinkSync(req.file.path)}catch{}}
});
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

app.get("/api/players",auth,instanceAuth,async(req,res)=>{try{const out=await docker(["exec",containerName(req.instance.id),"rcon-cli","list"]);const m=out.match(/There are (\d+) of a max of (\d+) players online(?:: (.*))?/i);res.json({count:Number(m?.[1]||0),max:Number(m?.[2]||req.instance.maxPlayers||0),players:m?.[3]?m[3].split(", ").filter(Boolean):[]})}catch(e){res.json({count:0,max:req.instance.maxPlayers||0,players:[],error:e.message})}});
app.post("/api/player/action",auth,instanceAuth,async(req,res)=>{const allowed=["op","deop","kick","ban","pardon","whitelist add","whitelist remove"];const action=String(req.body.action||"");const name=String(req.body.name||"");if(!allowed.includes(action)||!name)return res.status(400).end();try{await docker(["exec",containerName(req.instance.id),"rcon-cli",...action.split(" "),name]);res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});
app.post("/api/mods/install",auth,instanceAuth,async(req,res)=>{try{const project=encodeURIComponent(req.body.project||"");const loader=req.instance.software.toLowerCase();const version=req.instance.version;const r=await fetch(`https://api.modrinth.com/v2/project/${project}/version?game_versions=%5B%22${encodeURIComponent(version)}%22%5D&loaders=%5B%22${encodeURIComponent(loader)}%22%5D`);if(!r.ok)throw Error(`Modrinth ${r.status}`);const versions=await r.json();const v=versions[0];const f=v?.files?.find(z=>z.primary)||v?.files?.[0];if(!f)throw Error("No compatible file found");const bin=Buffer.from(await (await fetch(f.url)).arrayBuffer());const dir=(loader==="paper"||loader==="spigot")?"plugins":"mods";const b64=bin.toString("base64");await volumeCmd(req.instance,`mkdir -p ${vroot(req.instance)}/${dir}; echo '${b64}' | base64 -d > ${vroot(req.instance)}/${dir}/${path.basename(f.filename).replaceAll("'","'\\''")}`);res.json({ok:true,file:f.filename})}catch(e){res.status(500).json({error:e.message})}});
app.get("/api/installer/catalog",auth,async(_,res)=>res.json({software:["Vanilla","Paper","Purpur","Pufferfish","Leaf","Folia","Spigot","Fabric","Forge","NeoForge","Velocity","Waterfall"],versions:["LATEST","1.21.11","1.21.10","1.21.9","1.21.8","1.21.7","1.21.6","1.21.5","1.21.4","1.21.3","1.21.2","1.21.1","1.21","1.20.6","1.20.5","1.20.4","1.20.3","1.20.2","1.20.1","1.20","1.19.4","1.19.3","1.19.2","1.19.1","1.19","1.18.2","1.18.1","1.18","1.17.1","1.17","1.16.5","1.16.4","1.16.3","1.16.2","1.16.1","1.16","1.15.2","1.15.1","1.15","1.14.4","1.14.3","1.14.2","1.14.1","1.14","1.13.2","1.13.1","1.13","1.12.2","1.12.1","1.12","1.11.2","1.11.1","1.11","1.10.2","1.10.1","1.10","1.9.4","1.9.3","1.9.2","1.9.1","1.9","1.8.9","1.8.8","1.8.7","1.8.6","1.8.5","1.8.4","1.8.3","1.8.2","1.8.1","1.8"],note:"Containerized installers use itzg images and pull the selected version at first start."}));
app.get("/api/metrics",auth,instanceAuth,async(req,res)=>res.json(await containerStats(req.instance)));
// Live telemetry is sampled per instance; network rates are derived from cumulative Docker counters.
const telemetryCache=new Map();
async function rconTelemetry(x,command){
 try{return await Promise.race([
  docker(["exec",containerName(x.id),"rcon-cli",...command.split(" ")]),
  new Promise((_,reject)=>setTimeout(()=>reject(new Error("RCON timeout")),1800))
 ])}catch{return null}
}
app.get("/api/telemetry",auth,instanceAuth,async(req,res)=>{
 const x=req.instance;
 const running=(await statusOf(x))==="running";
 const prev=telemetryCache.get(x.id);
 if(prev&&Date.now()-prev.at<2500)return res.json(prev.data);
 if(!running){telemetryCache.delete(x.id);return res.json({running:false,players:null,maxPlayers:null,tps:null,mspt:null,rxRate:0,txRate:0,metrics:{cpu:0,ram:0},timestamp:Date.now()})}
 const metrics=await containerStats(x);
 const timestamp=Date.now();
 const elapsed=prev?Math.max(0.001,(timestamp-prev.at)/1000):0;
 const rxRate=elapsed?Math.max(0,(metrics.rx-prev.data.rxTotal)/elapsed):0;
 const txRate=elapsed?Math.max(0,(metrics.tx-prev.data.txTotal)/elapsed):0;
 const [list,tpsText,msptText]=await Promise.all([rconTelemetry(x,"list"),rconTelemetry(x,"tps"),rconTelemetry(x,"mspt")]);
 const playerMatch=list?.match(/There are (\d+) of a max of (\d+) players online/i);
 const tpsMatch=tpsText?.match(/(?:TPS from last[^:]*:|TPS:)\s*[^\d]*(\d+(?:\.\d+)?)/i);
 const msptMatch=msptText?.match(/(?:MSPT[^:]*:|Mean tick time:)\s*[^\d]*(\d+(?:\.\d+)?)/i);
 const data={running:true,players:playerMatch?Number(playerMatch[1]):null,maxPlayers:playerMatch?Number(playerMatch[2]):null,tps:tpsMatch?Number(tpsMatch[1]):null,mspt:msptMatch?Number(msptMatch[1]):null,rxRate,txRate,rxTotal:metrics.rx,txTotal:metrics.tx,metrics:{cpu:metrics.cpu,ram:metrics.ram},timestamp};
 telemetryCache.set(x.id,{at:timestamp,data});
 res.json(data);
});


app.get("/api/proxy/backends",auth,instanceAuth,(req,res)=>{if(!proxySoftware.has(req.instance.software))return res.status(400).json({error:"Current instance is not a proxy"});res.json(req.instance.backends||[])});
app.put("/api/proxy/backends",auth,instanceAuth,async(req,res)=>{if(!proxySoftware.has(req.instance.software))return res.status(400).json({error:"Current instance is not a proxy"});req.instance.backends=(req.body.backends||[]).map(b=>({name:idify(b.name),instanceId:b.instanceId})).filter(b=>db.instances[b.instanceId]&&b.instanceId!==req.instance.id);for(const b of req.instance.backends){const backend=db.instances[b.instanceId];backend.proxyBackend=true;}
  if(req.instance.software==="Velocity"){const rootText=`config-version = "2.7"\nbind = "0.0.0.0:${req.instance.port}"\nmotd = "BlockHost Network"\nshow-max-players = 500\nonline-mode = true\nplayer-info-forwarding-mode = "modern"\nforwarding-secret-file = "forwarding.secret"\nping-passthrough = "DESCRIPTION"\n\n[servers]\n${req.instance.backends.map(b=>`${b.name} = "${containerName(b.instanceId)}:25565"`).join("\n")}\ntry = [${req.instance.backends.map(b=>`"${b.name}"`).join(", ")}]\n`;
    const encoded=Buffer.from(rootText).toString("base64");await volumeCmd(req.instance,`echo '${encoded}' | base64 -d > /data/velocity.toml; echo '${crypto.randomBytes(24).toString("hex")}' > /data/forwarding.secret`)}
  save();res.json(req.instance.backends)});


const mcPropertiesPath="/data/server.properties";
app.post("/api/instances/:id/accept-eula",auth,admin,async(req,res)=>{
 const x=db.instances[req.params.id];if(!x)return res.status(404).json({error:"Server not found"});
 if(req.body.acceptEula!==true)return res.status(400).json({error:"Explicit EULA acceptance required"});
 x.eulaAccepted=true;x.updatedAt=now();save();
 try{await runContainer(x);res.json({ok:true,restarted:true})}
 catch(e){res.status(500).json({error:"Acceptance saved but restart failed: "+e.message})}
});
app.get("/api/instances/:id/minecraft-settings",auth,async(req,res)=>{
 const x=db.instances[req.params.id];if(!x||!canAccess(req.user,x))return res.status(404).json({error:"Server not found"});
 if(proxySoftware.has(x.software))return res.status(400).json({error:"Proxy servers do not use server.properties"});
 try{
  const raw=await volumeCmd(x,"test -f /data/server.properties && cat /data/server.properties || true");
  const current=parseProperties(raw),values={};
  for(const [key,d] of Object.entries(definitions))values[key]=current[key]??String(d.defaultValue);
  res.json({groups: Object.fromEntries(Object.entries(groups).map(([name,defs])=>[name,defs.map(([key])=>definitions[key])])),values,exists:raw.length>0});
 }catch(e){res.status(500).json({error:e.message})}
});
app.put("/api/instances/:id/minecraft-settings",auth,admin,async(req,res)=>{
 const x=db.instances[req.params.id];if(!x)return res.status(404).json({error:"Server not found"});
 if(proxySoftware.has(x.software))return res.status(400).json({error:"Proxy servers do not use server.properties"});
 if(await statusOf(x)==="running"||await statusOf(x)==="restarting")return res.status(409).json({error:"Stop the Minecraft server before editing server.properties"});
 try{
  const updates=validateSettings(req.body.settings);
  const original=await volumeCmd(x,"test -f /data/server.properties && cat /data/server.properties || true");
  const merged=mergeProperties(original,updates);
  await volumeCmd(x,"cat > /data/server.properties",merged);
  if(updates["gamemode"]!==undefined)x.gamemode=updates["gamemode"];
  if(updates["max-players"]!==undefined)x.maxPlayers=Number(updates["max-players"]);
  x.updatedAt=now();save();
  res.json({ok:true,restartRequired:true});
 }catch(e){res.status(/Invalid|Unsupported|out of range|must be/.test(e.message)?400:500).json({error:e.message})}
});


/* Import a stopped itzg Minecraft container from a named Docker volume.
 * Copies its data into a new BlockHost-managed volume; source remains untouched.
 * Bind mounts are intentionally excluded from this first safe implementation.
 */
app.get("/api/docker-import/candidates",auth,admin,async(req,res)=>{
 try{
  const ids=(await docker(["ps","-a","--format","{{.ID}}"])).split(/\r?\n/).filter(Boolean);
  const candidates=[];
  for(const id of ids){
   const c=(await dockerJSON(["inspect",id]))[0];
   if(!/^itzg\/minecraft-server(?::|@|$)/.test(c.Config?.Image||""))continue;
   if(Object.values(db.instances).some(x=>containerName(x.id)===c.Name?.slice(1)))continue;
   const m=(c.Mounts||[]).find(m=>m.Destination==="/data");
   candidates.push({id:c.Id,name:c.Name?.slice(1),state:c.State?.Status,image:c.Config.Image,
    volume:m?.Type==="volume"?m.Name:null,eligible:!!(m?.Type==="volume"&&c.State?.Status==="exited")});
  }
  res.json(candidates);
 }catch(e){res.status(500).json({error:e.message})}
});
app.post("/api/docker-import",auth,admin,async(req,res)=>{
 const id=String(req.body.containerId||"");
 if(!/^[a-f0-9]{12,64}$/.test(id))return res.status(400).json({error:"Choose a valid container"});
 if(req.body.confirmCopy!==true||req.body.eulaAccepted!==true)return res.status(400).json({error:"Confirm data copy and explicitly accept the Minecraft EULA"});
 let x=null;
 try{
  const c=(await dockerJSON(["inspect",id]))[0];
  if(!/^itzg\/minecraft-server(?::|@|$)/.test(c.Config?.Image||""))return res.status(400).json({error:"Only itzg/minecraft-server containers are supported"});
  if(c.State?.Status!=="exited")return res.status(409).json({error:"Stop the source container before importing"});
  if(Object.values(db.instances).some(i=>containerName(i.id)===c.Name?.slice(1)))return res.status(409).json({error:"Already managed by BlockHost"});
  const mount=(c.Mounts||[]).find(m=>m.Destination==="/data");
  if(!mount||mount.Type!=="volume"||!mount.Name)return res.status(400).json({error:"Source must have a named Docker volume mounted at /data. Bind mounts are not yet supported."});
  const env=Object.fromEntries((c.Config.Env||[]).map(v=>{const p=v.indexOf("=");return [v.slice(0,p),v.slice(p+1)]}));
  const name=String(req.body.name||c.Name?.slice(1)||"Imported Minecraft").trim().slice(0,80);
  if(!name)return res.status(400).json({error:"Server name required"});
  const base=idify(name);let newId=base,n=2;
  while(db.instances[newId])newId=base.slice(0,35)+"-"+n++;
  const port=await allocPort(),rconPort=await allocRcon();
  const type=String(env.TYPE||"VANILLA").toUpperCase();
  const supported={VANILLA:"Vanilla",PAPER:"Paper",SPIGOT:"Spigot",PURPUR:"Purpur",PUFFERFISH:"Pufferfish",LEAF:"Leaf",FOLIA:"Folia",FABRIC:"Fabric",FORGE:"Forge",NEOFORGE:"NeoForge"};
  if(!supported[type])return res.status(400).json({error:"Unsupported server type: "+type});
  x={id:newId,name,template:"survival",type:"Imported",software:supported[type],version:String(env.VERSION||"LATEST").slice(0,40),
    port,rconPort,memory:safeNum((()=>{const m=String(env.MEMORY||"3072M").match(/^([0-9]+)\\s*([GMK])?/i);if(!m)return 3072;const n=Number(m[1]);return m[2]?.toUpperCase()==="G"?n*1024:m[2]?.toUpperCase()==="K"?Math.ceil(n/1024):n})(),3072,512,65536),cpu:2,disk:20,
    maxPlayers:safeNum(env.MAX_PLAYERS,20,1,5000),gamemode:env.MODE||"survival",
    permissions:[],eulaAccepted:true,autoStart:false,status:"stopped",container:null,
    rconPassword:crypto.randomBytes(18).toString("hex"),imported:true,
    importedFrom:{name:c.Name?.slice(1),volume:mount.Name},createdAt:now(),updatedAt:now()};
  await ensureVolume(x);
  // Only read from the source volume. Never modify or remove its container or volume.
  await docker(["run","--rm","-v",mount.Name+":/source:ro","-v",volumeName(x.id)+":/data",
    "alpine","sh","-c","cp -a /source/. /data/"]);
  db.instances[x.id]=x;save();
  res.json({ok:true,instance:x,sourcePreserved:true});
 }catch(e){
  if(x&&!db.instances[x.id])await docker(["volume","rm",volumeName(x.id)]).catch(()=>{});
  res.status(500).json({error:e.message});
 }
});

app.use("/api/public-access",publicAccessRouter({docker,auth,admin,db,save}));

app.get("/invite/:id",(_,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

const server=app.listen(PORT,()=>console.log(`BlockHost 6 listening on ${PORT}`));
const wss=new WebSocketServer({server});
wss.on("connection",ws=>{ws.send(JSON.stringify({type:"hello",version:"6.0.0"}))});

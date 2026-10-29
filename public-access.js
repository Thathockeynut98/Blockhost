import express from "express";
export function publicAccessRouter({docker,auth,admin,db,save}){
 const router=express.Router(), CF="blockhost-public-cloudflare", PL="blockhost-public-playit";
 const inspect=async n=>{try{return JSON.parse(await docker(["inspect",n]))[0]}catch{return null}};
 const remove=async n=>{if(await inspect(n))await docker(["rm","-f",n])};
 const logs=async n=>{try{return await docker(["logs","--tail","100",n])}catch{return ""}};
 const settings=()=>db.publicAccess||(db.publicAccess={});
 router.use(auth,admin);
 router.get("/status",async(req,res)=>{try{
  const [cf,pl,l]=await Promise.all([inspect(CF),inspect(PL),logs(CF)]);
  res.json({cloudflare:{running:!!cf?.State?.Running,url:cf?.State?.Running?(l.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)||[])[0]||null:null,email:settings().email||""},playit:{running:!!pl?.State?.Running,address:settings().address||"",port:settings().port||25566}});
 }catch(e){res.status(500).json({error:e.message})}});
 router.post("/cloudflare/start",async(req,res)=>{try{
  const email=String(req.body.email||"").trim();
  if(!email.includes("@")||email.length>254)return res.status(400).json({error:"Enter an allowed email address"});
  await remove(CF);
  await docker(["run","-d","--name",CF,"--restart","unless-stopped","--network","container:blockhost","cloudflare/cloudflared:latest","tunnel","--no-autoupdate","--url","http://127.0.0.1:8080","--allowed-mail",email]);
  settings().email=email;save();res.json({ok:true});
 }catch(e){res.status(500).json({error:e.message})}});
 router.post("/cloudflare/stop",async(req,res)=>{try{await remove(CF);res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});
 router.post("/playit/start",async(req,res)=>{try{
  const secret=String(req.body.secret||"").trim(),port=Number(req.body.port);
  if(!secret||secret.length>1024)return res.status(400).json({error:"Enter a Playit agent secret"});
  if(!Number.isInteger(port)||port<1||port>65535)return res.status(400).json({error:"Invalid port"});
  await remove(PL);
  await docker(["run","-d","--name",PL,"--restart","unless-stopped","--add-host","host.docker.internal:host-gateway","-e","SECRET_KEY="+secret,"ghcr.io/playit-cloud/playit-agent:latest"]);
  settings().port=port;save();res.json({ok:true});
 }catch(e){res.status(500).json({error:e.message})}});
 router.post("/playit/stop",async(req,res)=>{try{await remove(PL);res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});
 router.post("/playit/address",async(req,res)=>{const a=String(req.body.address||"").trim();if(!a||a.length>200||a.includes("/"))return res.status(400).json({error:"Enter a Playit hostname"});settings().address=a;save();res.json({ok:true})});
 return router;
}

// Minecraft Java server.properties settings exposed by BlockHost.
// Values are validated server-side; unknown properties are preserved.
export const groups = {
 General: [
  ["motd","MOTD","text","A Minecraft Server"],
  ["max-players","Max players","integer",20,1,5000],
  ["gamemode","Gamemode","select","survival",["survival","creative","adventure","spectator"]],
  ["difficulty","Difficulty","select","easy",["peaceful","easy","normal","hard"]],
  ["hardcore","Hardcore","boolean",false],
  ["pvp","PvP","boolean",true],
  ["white-list","Whitelist","boolean",false],
  ["enforce-whitelist","Enforce whitelist","boolean",false]
 ],
 Gameplay: [
  ["allow-flight","Allow flight","boolean",false],
  ["allow-nether","Allow Nether","boolean",true],
  ["enable-command-block","Command blocks","boolean",false],
  ["force-gamemode","Force gamemode","boolean",false],
  ["spawn-protection","Spawn protection","integer",16,0,10000],
  ["player-idle-timeout","Idle timeout (minutes)","integer",0,0,1440],
  ["spawn-monsters","Spawn monsters","boolean",true],
  ["spawn-animals","Spawn animals","boolean",true],
  ["spawn-npcs","Spawn NPCs","boolean",true]
 ],
 World: [
  ["level-name","World folder name","text","world"],
  ["level-seed","World seed","text",""],
  ["level-type","World type","select","minecraft:normal",["minecraft:normal","minecraft:flat","minecraft:large_biomes","minecraft:amplified"]],
  ["generate-structures","Generate structures","boolean",true],
  ["max-world-size","Max world size","integer",29999984,1,29999984]
 ],
 Performance: [
  ["view-distance","View distance","integer",10,2,32],
  ["simulation-distance","Simulation distance","integer",10,2,32],
  ["entity-broadcast-range-percentage","Entity broadcast range %","integer",100,10,1000],
  ["max-tick-time","Maximum tick time (ms)","integer",60000,-1,2147483647],
  ["network-compression-threshold","Compression threshold","integer",256,-1,65535]
 ],
 Network: [
  ["online-mode","Online authentication","boolean",true],
  ["enable-status","Server list status","boolean",true],
  ["hide-online-players","Hide online players","boolean",false],
  ["prevent-proxy-connections","Prevent proxy connections","boolean",false],
  ["rate-limit","Packet rate limit","integer",0,0,100000]
 ]
};
export const definitions = Object.fromEntries(Object.values(groups).flat().map(([key,label,type,defaultValue,extra,max])=>[key,{key,label,type,defaultValue,options:type==="select"?extra:undefined,min:type==="integer"?extra:undefined,max:type==="integer"?max:undefined}]));
export function validateSettings(input) {
 if(!input || typeof input!=="object" || Array.isArray(input))throw Error("Invalid settings object");
 const result={};
 for(const [key,value] of Object.entries(input)){
  const d=definitions[key];if(!d)throw Error("Unsupported setting: "+key);
  if(d.type==="boolean"){if(typeof value!=="boolean")throw Error(key+" must be true or false");result[key]=String(value);}
  else if(d.type==="integer"){if(!Number.isInteger(value)||value<d.min||value>d.max)throw Error(key+" is out of range");result[key]=String(value);}
  else if(d.type==="select"){if(!d.options.includes(value))throw Error("Invalid "+key);result[key]=value;}
  else {if(typeof value!=="string"||value.length>300||/[\r\n\0]/.test(value))throw Error("Invalid "+key);result[key]=value;}
 }
 return result;
}
export function parseProperties(content){
 const values={};for(const line of content.split(/\r?\n/)){if(/^\s*[#!]/.test(line))continue;const m=line.match(/^\s*([^=\s]+)\s*=(.*)$/);if(m)values[m[1]]=m[2];}return values;
}
export function mergeProperties(content,updates){
 const seen=new Set();const lines=content.split(/\r?\n/).map(line=>{const m=line.match(/^(\s*)([^=\s]+)(\s*=).*/);if(m&&Object.hasOwn(updates,m[2])){seen.add(m[2]);return m[1]+m[2]+m[3]+updates[m[2]];}return line;});
 for(const [key,value] of Object.entries(updates))if(!seen.has(key))lines.push(key+"="+value);
 return lines.join("\n").replace(/\n*$/,"\n");
}

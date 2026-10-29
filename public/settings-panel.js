// Expanded Minecraft Java settings panel; existing server.properties entries are preserved.
let settingsDirty=false, settingsLoaded=false;
function renderSetting(def,value){
 const id="mc-"+def.key;
 const common='data-setting="'+def.key+'" id="'+id+'"';
 let control;
 if(def.type==="boolean")control='<input type="checkbox" '+common+(value==="true"?" checked":"")+'>';
 else if(def.type==="select")control='<select '+common+'>'+def.options.map(v=>'<option value="'+escAttr(v)+'"'+(value===v?" selected":"")+'>'+esc(v)+'</option>').join('')+'</select>';
 else control='<input '+common+' type="'+(def.type==="integer"?"number":"text")+'" '+(def.type==="integer"?'min="'+def.min+'" max="'+def.max+'"':'')+' value="'+escAttr(value)+'">';
 return '<label class="mc-field"><span>'+esc(def.label)+'</span>'+control+'</label>';
}
async function loadMinecraftSettings(){
 const root=$('minecraftSettings');if(!root)return;
 root.innerHTML='<p>Loading Minecraft configuration…</p>';
 try{
  const data=await api('/api/instances/'+encodeURIComponent(INSTANCE)+'/minecraft-settings');
  const nav=$('minecraftSettingsNav');nav.innerHTML='';
  root.innerHTML='';
  for(const [group,defs] of Object.entries(data.groups)){
   const slug='mcgroup-'+group.toLowerCase();
   nav.insertAdjacentHTML('beforeend','<button class="ghost" type="button" onclick="document.getElementById(\''+slug+'\').scrollIntoView({behavior:\'smooth\'})">'+esc(group)+'</button>');
   const fields=defs.map(def=>renderSetting(def,data.values[def.key]??String(def.defaultValue))).join('');
   root.insertAdjacentHTML('beforeend','<div class="card" id="'+slug+'"><h3>'+esc(group)+'</h3><div class="formGrid">'+fields+'</div></div>');
  }
  root.querySelectorAll('[data-setting]').forEach(el=>el.addEventListener('change',()=>{settingsDirty=true;$('mcSaveState').textContent='Unsaved changes';}));
  $('mcSaveState').textContent='Changes to server.properties require a restart. World generation settings affect new worlds only.';
  settingsDirty=false;settingsLoaded=true;
 }catch(e){root.innerHTML='<div class="card">Unable to load settings: '+esc(e.message)+'</div>';}
}
async function saveMinecraftSettings(){
 if(!settingsLoaded)return;
 const settings={};
 for(const el of $('minecraftSettings').querySelectorAll('[data-setting]')){
  settings[el.dataset.setting]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;
 }
 try{
  await api('/api/instances/'+encodeURIComponent(INSTANCE)+'/minecraft-settings','PUT',{settings});
  settingsDirty=false;$('mcSaveState').textContent='Saved. Restart the Minecraft server to apply changes.';
 }catch(e){alert(e.message);}
}
window.addEventListener('beforeunload',e=>{if(settingsDirty){e.preventDefault();e.returnValue='';}});

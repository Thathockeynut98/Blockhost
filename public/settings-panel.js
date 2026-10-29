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

async function acceptExistingEula(){
 if(!$('existingEula').checked){alert('Please read and explicitly accept the Minecraft EULA first.');return;}
 if(!confirm('Recreate the Minecraft container with EULA=TRUE? The existing Docker data volume will be preserved.'))return;
 try{
  await api('/api/instances/'+encodeURIComponent(INSTANCE)+'/accept-eula','POST',{acceptEula:true});
  $('existingEula').checked=false;alert('EULA saved. Minecraft container recreated. Check the Console for startup logs.');await refresh();
 }catch(e){alert(e.message);}
}

async function loadDockerCandidates(){
 const root=$('dockerCandidates');root.textContent='Searching Docker containers…';
 try{
  const items=await api('/api/docker-import/candidates');
  if(!items.length){root.textContent='No supported Minecraft Docker containers found.';return;}
  root.innerHTML=items.map(c=>'<div class="card"><b>'+esc(c.name)+'</b> · '+esc(c.state)+'<p>'+esc(c.image)+'</p><p>Data volume: '+esc(c.volume||'Unsupported mount')+'</p><button '+(c.eligible?'':'disabled')+' onclick="importDockerContainer(\''+c.id+'\')">Copy into BlockHost</button>'+(c.eligible?'':'<p>Source must be stopped and use a named volume at /data.</p>')+'</div>').join('');
 }catch(e){root.textContent='Docker discovery failed: '+e.message;}
}
async function importDockerContainer(containerId){
 const name=prompt('Name for the imported BlockHost server:');
 if(!name||!name.trim())return;
 if(!confirm('Have you read and accepted the Minecraft EULA for this imported server? The source container must be stopped. A COPY of its data will be created; the original remains unchanged.'))return;
 try{
  const r=await api('/api/docker-import','POST',{containerId,name:name.trim(),confirmCopy:true,eulaAccepted:true});
  INSTANCE=r.instance.id;localStorage.setItem('blockhost_instance',INSTANCE);
  await loadInstances();await refresh();await loadMinecraftSettings();
  alert('Imported successfully! Review settings, then start the imported server from BlockHost. Original Docker container was preserved.');
 }catch(e){alert('Import failed: '+e.message);}
}

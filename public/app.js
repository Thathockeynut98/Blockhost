let TOKEN=localStorage.getItem('blockhost_token')||'',ME=null,INSTANCE=localStorage.getItem('blockhost_instance')||'',currentFile='',wizardState={};
const $=id=>document.getElementById(id);
async function raw(url,opt={}){opt.headers={...(opt.headers||{}),...(TOKEN?{Authorization:'Bearer '+TOKEN}:{}),...(INSTANCE?{'X-Instance-Id':INSTANCE}:{})};const r=await fetch(url,opt);let j=null;try{j=await r.json()}catch{}if(r.status===401){logout();throw Error('Please sign in')}if(!r.ok)throw Error(j?.error||'Request failed');return j}
async function api(url,method='GET',body){return raw(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined})}
async function login(){try{const j=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('user').value,password:$('pass').value})}).then(x=>x.json());if(!j.token)throw Error(j.error);TOKEN=j.token;localStorage.setItem('blockhost_token',TOKEN);boot()}catch(e){$('authMsg').textContent=e.message}}
async function register(){try{const j=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('user').value,password:$('pass').value})}).then(x=>x.json());if(!j.token)throw Error(j.error);TOKEN=j.token;localStorage.setItem('blockhost_token',TOKEN);boot()}catch(e){$('authMsg').textContent=e.message}}
async function boot(){try{ME=await raw('/api/auth/me');$('auth').classList.add('hidden');$('app').classList.remove('hidden');$('who').textContent=ME.username+' · '+ME.role;await load()}catch(e){console.error(e)}}
function logout(){TOKEN='';localStorage.removeItem('blockhost_token');location.reload()}
async function load(){await loadInstances();await refresh();await loadSetup();await loadBackups();await loadSchedules();await loadUsers();if(dbTab==='proxy')loadBackends()}
async function loadInstances(){const xs=await raw('/api/instances');if(!xs.length)return;$('instanceSelect').innerHTML=xs.map(x=>`<option value="${x.id}">${esc(x.name)} · ${esc(x.type)}</option>`).join('');if(!xs.some(x=>x.id===INSTANCE))INSTANCE=xs[0].id;localStorage.setItem('blockhost_instance',INSTANCE);$('instanceSelect').value=INSTANCE}
async function switchInstance(id){if(settingsDirty&&!confirm('Discard unsaved Minecraft settings?'))return;INSTANCE=id;localStorage.setItem('blockhost_instance',id);await refresh();if(dbTab==='settings')loadMinecraftSettings();if(dbTab==='console')refreshConsole(true)}
async function refresh(){const s=await raw('/api/status');const x=s.instance;$('hero').innerHTML=`<div class="eyebrow">${esc(x.type)} SERVER</div><h2>${esc(x.name)}</h2><p>${esc(x.software)} · Minecraft ${esc(x.version)} · ${x.memory} MB RAM · ${x.cpu} CPU · public port ${x.port}</p><span class="pill">Docker: ${esc(x.container||'not created')}</span>`;$('status').textContent=s.status;$('playersCount').textContent='—';$('cpu').textContent=s.metrics.cpu.toFixed(1)+'%';$('cpuLimit').textContent='limit '+x.cpu+' CPU';$('ram').textContent=Math.round(s.metrics.ram/1048576)+' MB';$('ramLimit').textContent='limit '+x.memory+' MB';$('net').textContent=Math.round((s.metrics.rx+s.metrics.tx)/1024)+' KB/s';$('port').textContent=x.port;$('containerName').textContent=x.container||'—';$('cpuBar').style.width=Math.min(100,s.metrics.cpu/Math.max(.1,x.cpu*100)*100)+'%';$('installRam').value=x.memory;$('installCpu').value=x.cpu;$('setName').value=x.name;$('setPort').value=x.port;$('setRam').value=x.memory;$('setCpu').value=x.cpu;$('setMax').value=x.maxPlayers||20;$('setMode').value=x.gamemode||'survival';try{const c=await raw('/api/console');$('dashConsole').textContent=c.slice(-60).join('\n')}catch{}} 
async function serverAction(a){try{await api(`/api/instances/${INSTANCE}/${a}`,'POST');setTimeout(refresh,500)}catch(e){alert(e.message)}}
let dbTab='dashboard';function tab(id){if(dbTab==='console')stopConsolePolling();dbTab=id;document.querySelectorAll('.tab').forEach(x=>x.classList.add('hidden'));$(id).classList.remove('hidden');if(id==='files')listFiles();if(id==='backups')loadBackups();if(id==='schedules')loadSchedules();if(id==='proxy')loadBackends();if(id==='players')loadPlayers();if(id==='settings')loadMinecraftSettings();if(id==='console')startConsolePolling()}
async function loadSetup(){const c=await raw('/api/installer/catalog');$('soft').innerHTML=c.software.map(x=>`<option>${x}</option>`).join('');$('ver').innerHTML=c.versions.map(x=>`<option>${x}</option>`).join('');const s=await raw('/api/status');$('soft').value=s.instance.software;$('ver').value=s.instance.version;$('templateInfo').textContent=templatesText(s.instance.template)}
function templatesText(t){return ({survival:'Survival · Paper · 4GB · 2 CPU',creative:'Creative · Paper · 3GB · 2 CPU',modded:'Modded · Fabric · 6GB · 4 CPU',proxy:'Proxy · Velocity · 2GB · 1 CPU',vanilla:'Vanilla · Vanilla · 3GB · 2 CPU'})[t]||'Custom server'}
async function applyInstall(){try{await api(`/api/instances/${INSTANCE}`,'PUT',{software:$('soft').value,version:$('ver').value,memory:Number($('installRam').value),cpu:Number($('installCpu').value)});await serverAction('start')}catch(e){alert(e.message)}}
let currentFolder='';
const textFilePattern=/\.(properties|yml|yaml|json|toml|txt|log|conf|cfg|ini|xml|md|sh|bat|cmd|js|ts|java|html|css)$/i;
async function listFiles(p=''){
 currentFolder=p;
 const area=$('fileList');area.textContent='Loading server files...';
 try{
  const files=await raw('/api/files?path='+encodeURIComponent(p));
  area.innerHTML='<div class="muted">/data/'+esc(p)+(p?'/':'')+'</div>'+
   (p?'<div class="file"><a href="#" onclick="listFiles('+JSON.stringify(p.split('/').slice(0,-1).join('/')).replaceAll('"','&quot;')+');return false">⬅ Parent folder</a></div>':'')+
   (files.length?files.map(x=>'<div class="file"><a href="#" data-path="'+escAttr(x.path)+'" data-kind="'+x.type+'">'+(x.type==='dir'?'📁 ':'📄 ')+esc(x.name)+'</a><span>'+ (x.type==='file'?formatBytes(x.size):'Folder')+'</span><span class="row"><button class="ghost" data-action="download" data-path="'+escAttr(x.path)+'">Download</button><button class="ghost" data-action="rename" data-path="'+escAttr(x.path)+'">Rename</button><button class="danger" data-action="delete" data-path="'+escAttr(x.path)+'">Delete</button></span></div>').join(''):'<p class="muted">This folder is empty.</p>');
  area.querySelectorAll('a[data-path]').forEach(link=>link.addEventListener('click',e=>{e.preventDefault();const path=link.dataset.path;if(link.dataset.kind==='dir')listFiles(path);else openText(path)}));
  area.querySelectorAll('button[data-action]').forEach(button=>button.addEventListener('click',async()=>{
   const action=button.dataset.action,path=button.dataset.path;
   if(action==='download')await downloadServerFile(path);
   if(action==='rename')await renameServerFile(path);
   if(action==='delete')await deleteServerFile(path);
  }));
 }catch(e){area.textContent='Unable to list server files: '+e.message;}
}

async function downloadServerFile(path){
 try{
  const response=await fetch('/api/file/download?path='+encodeURIComponent(path),{headers:{Authorization:'Bearer '+TOKEN,'X-Instance-Id':INSTANCE}});
  if(!response.ok)throw Error(await response.text());
  const blob=await response.blob(),url=URL.createObjectURL(blob);
  const disposition=response.headers.get('content-disposition')||'';
  const match=disposition.match(/filename="([^"]+)"/);
  const name=match?match[1]:path.split('/').pop();
  const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
 }catch(e){alert('Download failed: '+e.message)}
}
async function renameServerFile(path){
 const oldName=path.split('/').pop();
 const newName=prompt('Rename '+path+' to:',oldName);
 if(newName===null||newName===oldName)return;
 if(!newName||newName==='.'||newName==='..'||/[\\/]/.test(newName))return alert('Enter a valid name without slashes.');
 if(!confirm('Rename '+path+' to '+newName+'?'))return;
 try{await api('/api/file/rename','POST',{path,newName});if(currentFile===path){currentFile='';$('filePath').value='';$('editor').value='';}await listFiles(currentFolder)}
 catch(e){alert('Rename failed: '+e.message)}
}
async function deleteServerFile(path){
 if(!confirm('Permanently delete '+path+'? If this is a folder, EVERYTHING inside it will be deleted. This cannot be undone.'))return;
 const typed=prompt('To confirm permanent deletion, type the full path exactly:\\n'+path);
 if(typed!==path)return alert('Deletion cancelled: confirmation did not match.');
 try{await api('/api/file','DELETE',{path,confirm:path});if(currentFile===path||currentFile.startsWith(path+'/')){currentFile='';$('filePath').value='';$('editor').value='';}await listFiles(currentFolder)}
 catch(e){alert('Delete failed: '+e.message)}
}
async function openText(p){
 currentFile=p;$('filePath').value=p;
 if(!textFilePattern.test(p)){alert('This may be a binary file (such as a plugin .jar or Minecraft world data). Text editing is disabled for this file.');return;}
 try{
  const r=await fetch('/api/file?path='+encodeURIComponent(p),{headers:{Authorization:'Bearer '+TOKEN,'X-Instance-Id':INSTANCE}});
  if(!r.ok)throw Error(await r.text());
  $('editor').value=await r.text();
 }catch(e){alert('Unable to open file: '+e.message);}
}
async function openFile(){openText($('filePath').value)}
async function saveFile(){
 const p=currentFile||$('filePath').value;
 if(!p)return alert('Select a text file first.');
 if(!textFilePattern.test(p))return alert('Only text configuration files can be edited.');
 try{await api('/api/file','PUT',{path:p,content:$('editor').value});alert('Saved '+p+'. Restart Minecraft if required for changes to take effect.');listFiles(currentFolder)}
 catch(e){alert('Unable to save file: '+e.message)}
}
async function newFolder(){
 const name=prompt('New folder name inside '+(currentFolder||'/data'));
 if(!name)return;
 if(name.includes('/')||name.includes('\\')||name==='.'||name==='..')return alert('Enter a single folder name.');
 try{await api('/api/folder','POST',{path:(currentFolder?currentFolder+'/':'')+name});listFiles(currentFolder)}catch(e){alert(e.message)}
}
async function uploadFile(){
 const f=$('fileUpload').files[0];if(!f)return;
 const fd=new FormData();fd.append('file',f);fd.append('path',currentFolder);
 try{await raw('/api/upload',{method:'POST',body:fd});$('fileUpload').value='';listFiles(currentFolder)}catch(e){alert('Upload failed: '+e.message)}
}
let consolePollTimer=null,consoleFetching=false,consoleInstance='';
async function refreshConsole(force=false){
 const output=$('consoleOutput');if(!output||consoleFetching||!INSTANCE)return;
 consoleFetching=true;
 try{
  const instance=INSTANCE;
  const lines=await raw('/api/console');
  if(instance!==INSTANCE)return;
  const content=lines.length?lines.join('\\n'):'No container logs yet. Start the server or check its status in Overview.';
  if(force||output.textContent!==content){
   output.textContent=content;
   if($('consoleAutoScroll')?.checked)output.scrollTop=output.scrollHeight;
  }
  $('consoleState').textContent='Logs updated · '+new Date().toLocaleTimeString()+' · '+lines.length+' lines';
 }catch(e){output.textContent='Unable to read Minecraft logs: '+e.message;$('consoleState').textContent='Console error';}
 finally{consoleFetching=false;}
}
function stopConsolePolling(){if(consolePollTimer){clearInterval(consolePollTimer);consolePollTimer=null;}}
function startConsolePolling(){stopConsolePolling();refreshConsole(true);consolePollTimer=setInterval(()=>{if(dbTab==='console'&&!document.hidden)refreshConsole()},2000);}
async function sendCmd(){
 const c=$('cmd').value.trim();if(!c)return;
 try{await api('/api/command','POST',{command:c});$('cmd').value='';setTimeout(()=>refreshConsole(true),500)}
 catch(e){alert('Command failed: '+e.message);refreshConsole(true)}
}
async function loadPlayers(){const names=await raw('/api/console');$('playerList').innerHTML='<p class=muted>Use the console to run <code>list</code> for the current player count. Full player actions remain available through RCON commands.</p>'}
async function searchMods(){const j=await raw('/api/mods/search?q='+encodeURIComponent($('modq').value)).catch(()=>null);if(!j){$('modResults').innerHTML='<div class=card>Modrinth search is available in the next integration module.</div>';return}$('modResults').innerHTML=(j.hits||[]).map(x=>`<div class="card result"><div><b>${esc(x.title)}</b><p>${esc(x.description||'')}</p></div><button onclick="installMod('${x.project_id}')">Install</button></div>`).join('')}
async function installMod(id){alert('Install endpoint can be enabled for this instance after selecting its loader.')} 
async function makeBackup(){try{await api('/api/backup','POST');loadBackups()}catch(e){alert(e.message)}}async function loadBackups(){try{const j=await raw('/api/backups');$('backupList').innerHTML=j.map(x=>`<div class=file><span>${x.file} · ${formatBytes(x.size)}</span><span><a href="/api/backup/download?id=${x.id}&instance=${INSTANCE}" target=_blank>Download</a> <button class=danger onclick="deleteBackup('${x.id}')">Delete</button></span></div>`).join('')||'<div class=card>No backups yet.</div>'}catch{}}
async function deleteBackup(id){await api('/api/backup?instance='+INSTANCE+'&id='+encodeURIComponent(id),'DELETE');loadBackups()}
async function loadSchedules(){try{const j=await raw('/api/schedules');$('scheduleList').innerHTML=j.map(s=>`<div class=card><b>${s.type}</b> · every ${s.intervalMinutes} min · ${s.enabled?'enabled':'disabled'} · ${s.instanceId}<button class=ghost onclick="deleteSchedule('${s.id}')">Remove</button></div>`).join('')}catch{}}
async function addSchedule(){await api('/api/schedules','POST',{instanceId:INSTANCE,type:$('scheduleType').value,intervalMinutes:Number($('scheduleMinutes').value)});loadSchedules()}async function deleteSchedule(id){await api('/api/schedules/'+id,'DELETE');loadSchedules()}
let backends=[];async function loadBackends(){try{backends=await raw('/api/proxy/backends');renderBackends()}catch(e){$('backendList').innerHTML='<p class=muted>Switch to a Velocity or Waterfall instance to configure a proxy network.</p>'}}function renderBackends(){$('backendList').innerHTML=backends.map((b,i)=>`<div class=row><input value="${escAttr(b.name)}" onchange="backends[${i}].name=this.value"><select onchange="backends[${i}].instanceId=this.value">${instanceOptions(b.instanceId)}</select><button class=danger onclick="backends.splice(${i},1);renderBackends()">×</button></div>`).join('')}async function addBackend(){backends.push({name:'backend-'+(backends.length+1),instanceId:''});renderBackends()}async function saveBackends(){try{await api('/api/proxy/backends','PUT',{backends});alert('Proxy configuration saved. Restart the proxy to apply it.')}catch(e){alert(e.message)}}
function instanceOptions(sel){const opts=[...$('instanceSelect').options].map(o=>`<option value="${o.value}" ${o.value===sel?'selected':''}>${o.text}</option>`).join('');return opts}
async function invite(){const j=await api('/api/invites','POST',{hours:Number($('invHours').value),maxUses:Number($('invUses').value)});$('inviteOut').innerHTML=`<div class=card><b>Share this link</b><p>${location.origin+j.link}</p></div>`}
async function saveSettings(){try{await api(`/api/instances/${INSTANCE}`,'PUT',{name:$('setName').value,port:Number($('setPort').value),memory:Number($('setRam').value),cpu:Number($('setCpu').value),maxPlayers:Number($('setMax').value),gamemode:$('setMode').value});refresh()}catch(e){alert(e.message)}}
async function loadUsers(){if(!ME||!['owner','admin'].includes(ME.role))return;try{const j=await raw('/api/users');$('users').innerHTML=j.map(u=>`<div class=file><span>${esc(u.username)} · ${u.role}</span><button onclick="grant('${u.id}')">Grant access</button></div>`).join('')}catch{}}async function grant(id){await api(`/api/instances/${INSTANCE}/access`,'POST',{userId:id,grant:true});alert('Access granted')}

function importServer(){$('importModal').classList.remove('hidden');$('importMsg').textContent='';$('importFile').value='';$('importFolder').value='';toggleImportSource()}
function closeImport(){$('importModal').classList.add('hidden')}
function toggleImportSource(){const folder=$('importSource').value==='folder';$('importFolderLabel').classList.toggle('hidden',!folder);$('importArchiveLabel').classList.toggle('hidden',folder)}
async function submitImport(){
  const folderMode=$('importSource').value==='folder';
  const files=folderMode?[...$('importFolder').files]:[$('importFile').files[0]];
  if(!files.length||!files[0]){$('importMsg').textContent=folderMode?'Choose an existing Minecraft server folder first.':'Choose a server archive first.';return}
  const fd=new FormData();
  if(folderMode){for(const file of files)fd.append('serverFiles',file,file.webkitRelativePath||file.name)}else fd.append('archive',files[0]);
  for(const [key,value] of Object.entries({name:$('importName').value,software:$('importSoft').value==='auto'?'':$('importSoft').value,version:$('importVersion').value,memory:$('importRam').value,cpu:$('importCpu').value,port:$('importPort').value,maxPlayers:$('importMax').value,acceptEula:$('importEula').checked?'true':'false'}))fd.append(key,value);
  $('importMsg').textContent=folderMode?'Reading and importing the selected Windows folder… this can take a while for large worlds.':'Uploading and importing server files… this can take a while for large worlds.';
  try{const x=await raw(folderMode?'/api/instances/import-folder':'/api/instances/import',{method:'POST',body:fd});INSTANCE=x.id;localStorage.setItem('blockhost_instance',INSTANCE);closeImport();await load();alert(`Imported ${x.name} successfully. Detected software: ${x.importedSoftware}.`)}catch(e){$('importMsg').textContent=e.message}}

function wizard(){wizardState={step:1,template:'survival',name:'',software:'Paper',version:'1.21.10',memory:4096,cpu:2,disk:20,port:'auto'};$('wizard').classList.remove('hidden');renderWizard()}function closeWizard(){$('wizard').classList.add('hidden')}
function renderWizard(){const s=wizardState;const b=$('wizardBody');if(s.step===1){b.innerHTML=`<h2>Choose a template</h2><div class=templateGrid>${Object.entries({survival:'Survival',creative:'Creative',modded:'Modded',proxy:'Proxy',vanilla:'Vanilla'}).map(([k,n])=>`<div class="template ${s.template===k?'selected':''}" onclick="pickTemplate('${k}')"><h3>${n}</h3><p>${templatesText(k)}</p></div>`).join('')}</div><div class=actions><button onclick="nextWizard()">Continue</button></div>`}else if(s.step===2){b.innerHTML=`<h2>Runtime</h2><div class=formGrid><label>Server name<input id=wName value="${s.name||templatesText(s.template).split(' · ')[0]}"></label><label>Software<select id=wSoft>${['Vanilla','Paper','Fabric','Forge','NeoForge','Velocity','Waterfall'].map(x=>`<option ${x===s.software?'selected':''}>${x}</option>`).join('')}</select></label><label>Minecraft version<input id=wVer value="${s.version}"></label></div><div class=actions><button class=ghost onclick="prevWizard()">Back</button><button onclick="nextWizard()">Continue</button></div>`}else if(s.step===3){b.innerHTML=`<h2>Resources</h2><div class=formGrid><label>RAM MB<input id=wRam type=number value="${s.memory}"></label><label>CPU cores<input id=wCpu type=number step=.25 value="${s.cpu}"></label><label>Disk GB<input id=wDisk type=number value="${s.disk}"></label><label>Port<input id=wPort value="${s.port}"></label></div><div class=actions><button class=ghost onclick="prevWizard()">Back</button><button onclick="nextWizard()">Continue</button></div>`}else{b.innerHTML=`<h2>Review</h2><div class=review><p><b>${esc(s.name)}</b></p><p>${s.software} · ${s.version}</p><p>${s.memory} MB RAM · ${s.cpu} CPU · ${s.disk} GB disk · port ${s.port==='auto'?'automatic':s.port}</p><p>Docker isolation: enabled</p><p>Private network: ${dbTab}</p></div><label class=row><input id=wEula type=checkbox> I accept the Minecraft EULA for this server.</label><div class=actions><button class=ghost onclick="prevWizard()">Back</button><button onclick="createFromWizard()">Create server</button></div>`}}
function pickTemplate(k){wizardState.template=k;const t={survival:['Paper',4096,2,20],creative:['Paper',3072,2,15],modded:['Fabric',6144,4,30],proxy:['Velocity',2048,1,5],vanilla:['Vanilla',3072,2,15]}[k];wizardState.software=t[0];wizardState.memory=t[1];wizardState.cpu=t[2];wizardState.disk=t[3];renderWizard()}
function collectWizard(){if(wizardState.step===2){wizardState.name=$('wName').value;wizardState.software=$('wSoft').value;wizardState.version=$('wVer').value}if(wizardState.step===3){wizardState.memory=Number($('wRam').value);wizardState.cpu=Number($('wCpu').value);wizardState.disk=Number($('wDisk').value);wizardState.port=$('wPort').value==='auto'?'':Number($('wPort').value)}}function nextWizard(){collectWizard();wizardState.step++;renderWizard()}function prevWizard(){collectWizard();wizardState.step--;renderWizard()}
async function createFromWizard(){if(!$('wEula').checked){alert('You must accept the EULA to create a Minecraft server.');return}try{const s={name:wizardState.name,template:wizardState.template,software:wizardState.software,version:wizardState.version,memory:wizardState.memory,cpu:wizardState.cpu,disk:wizardState.disk,port:wizardState.port||undefined,eulaAccepted:$('wEula').checked};const x=await api('/api/instances','POST',s);INSTANCE=x.id;localStorage.setItem('blockhost_instance',INSTANCE);closeWizard();await load()}catch(e){alert(e.message)}}
function esc(x){return String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}function escAttr(x){return esc(x).replace(/`/g,'&#96;')}function formatBytes(n){if(n<1024)return n+' B';let u=['KB','MB','GB','TB'],i=-1;do{n/=1024;i++}while(n>=1024&&i<u.length-1);return n.toFixed(1)+' '+u[i]}
if(TOKEN)boot();

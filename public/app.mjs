import {analyze,MAX_SIZE,fileExt} from '/analyze.mjs';
const svg={
  home:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  folder:'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/>',
  calendar:'<rect x="4" y="6" width="16" height="15" rx="2"/><path d="M8 3v6m8-6v6M4 11h16m-12 5h2m4 0h2"/>',
  doc:'<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6"/>',
  image:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m3 16 5-4 4 3 4-5 5 5"/>',
  sheet:'<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16m-16 5h16m-10-5v10"/>',
  other:'<path d="M5 8h14l1 12H4zM3 4h18v4H3zM10 12h4"/>',
  drive:'<rect x="4" y="12" width="16" height="8" rx="2"/><path d="m4 14 3-9h10l3 9m-12 2h1"/>',
  user:'<circle cx="12" cy="8" r="3"/><path d="M5 20v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  chevRight:'<path d="m9 5 7 7-7 7"/>',
  search:'<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
  upload:'<path d="M12 16V4m-4 4 4-4 4 4M4 15v5h16v-5"/>',
  arrow:'<path d="M4 12h15m-6-6 6 6-6 6"/>',
  cloud:'<path d="M7 17H6a4 4 0 1 1 .6-8 6 6 0 0 1 11.5-1.1A4.6 4.6 0 0 1 19 17h-2m-5 3v-9m-3 3 3-3 3 3"/>',
  spark:'<path d="M12 2c0 6 4 10 10 10-6 0-10 4-10 10 0-6-4-10-10-10 6 0 10-4 10-10Z"/>',
  check:'<path d="m5 12 4 4 10-10"/>', plus:'<path d="M12 5v14M5 12h14"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',download:'<path d="M12 4v12m-4-4 4 4 4-4M4 16v4h16v-4"/>',
  trash:'<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 3v7m4-7v7"/>',
  more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'
};
const I=(key)=>'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(svg[key]??'')+'</svg>';
const esc=(str)=>String(str??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=(id)=>document.getElementById(id);
const CATS={
  doc:{label:'文档资料',icon:'doc',tone:'#7254cc',tint:'#efe9ff',accent:'#ad92ec'},
  image:{label:'图片素材',icon:'image',tone:'#b14976',tint:'#fcebf3',accent:'#e8a5c2'},
  sheet:{label:'表格数据',icon:'sheet',tone:'#24816b',tint:'#e5f5ef',accent:'#83c8b4'},
  other:{label:'其他文件',icon:'other',tone:'#96601d',tint:'#fff2e2',accent:'#eab87a'},
};
const KINDS={'工作':CATS.doc,'学习':CATS.sheet,'生活':CATS.image,'其他':CATS.other};
const views={home:['概览','home'],library:['全部资料','folder'],favorites:['我的收藏','star'],plan:['每日计划','calendar'],search:['搜索结果','search']};
const css=(x)=>'style="--tone:'+x.tone+';--tint:'+x.tint+';--accent:'+x.accent+'"';
const dayString=(d=new Date())=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const now=dayString();
const dateFmt=new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long'});
const dateShort=new Intl.DateTimeFormat('zh-CN',{month:'short',day:'numeric'});
const readDate=(day)=>new Date(day+'T12:00:00');
const initial=location.hash.slice(1);
const state={view:initial!=='search'&&(Object.hasOwn(views,initial)||Object.hasOwn(CATS,initial))?initial:'home',files:[],tasks:[],day:now,sort:'new',q:'',searchIds:new Set(),searching:false,searchError:'',loading:true,error:'',importing:false};
const dialog=$('dialog');
let toastTimer, searchTimer, searchRevision=0, loadRevision=0;
const fileUrl=(id)=>'/api/files/'+encodeURIComponent(id);
const taskUrl=(id)=>'/api/tasks'+(id?'/'+encodeURIComponent(id):'')+'?day='+state.day;
async function api(url,method='GET',body){
  const options={method};
  if(body instanceof FormData)options.body=body;
  else if(body!==undefined){options.body=JSON.stringify(body);options.headers={'Content-Type':'application/json'};}
  const res=await fetch(url,options);
  let value;try{value=await res.json();}catch{throw Error('资料库没有返回有效结果，请稍后重试。');}
  if(!res.ok)throw Error(value.error||'操作未完成，请稍后重试。');
  return value;
}
function toast(message){
  clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,4400);
}
function formatSize(n){
  if(n<1024)return n+' B';
  if(n<1024*1024)return (n/1024).toFixed(n<10*1024?1:0)+' KB';
  return (n/(1024*1024)).toFixed(1)+' MB';
}
const iconButton=(action,id,key,label,extra='')=>'<button type="button" class="icon-button '+extra+'" data-action="'+action+'" data-id="'+esc(id)+'" aria-label="'+esc(label)+'" title="'+esc(label)+'">'+I(key)+'</button>';
function hideMenu(){
  $('sidebar').classList.remove('open');$('shade').hidden=true;$('mobile-menu').setAttribute('aria-expanded','false');
}
function setView(view,{clear=true}={}){
  if(!Object.hasOwn(views,view)&&!Object.hasOwn(CATS,view))return;
  if(clear){state.q='';$('search').value='';++searchRevision;clearTimeout(searchTimer);}
  state.view=view;
  if(view!=='search')history.replaceState(null,'',view==='home'?location.pathname:'#'+view);
  hideMenu();render();
}
function nav(){
  const count=(id)=>state.files.filter(f=>f.category===id).length;
  const navBtn=(id,label,icon,n)=>'<button class="nav-item '+(state.view===id?'active':'')+'" '+(state.view===id?'aria-current="page" ':'')+'data-view="'+id+'">'+icon+'<span>'+label+'</span>'+(n===undefined?'':'<span class="count">'+n+'</span>')+'</button>';
  $('main-nav').innerHTML=Object.entries(views).filter(([id])=>id!=='search').map(([id,[label,icon]])=>navBtn(id,label,I(icon))).join('');
  $('category-nav').innerHTML=Object.entries(CATS).map(([id,c])=>navBtn(id,c.label,'<span class="category-dot" '+css(c)+'></span>',count(id))).join('');
  $('quick-grid').innerHTML=Object.entries(CATS).map(([id,c])=>'<button class="quick-card" '+css(c)+' data-view="'+id+'"><span class="category-icon">'+I(c.icon)+'</span><span><b>'+c.label+'</b><small>'+count(id)+' 个文件</small></span><span class="quick-arrow">'+I('chevRight')+'</span></button>').join('');
  const real=state.files.filter(f=>!f.sample), size=real.reduce((sum,f)=>sum+f.size,0);
  $('storage-count').textContent=state.loading?'—':real.length+' 个文件';
  const demo=state.files.some(f=>f.sample);
  $('storage-info').innerHTML=state.loading?'正在加载资料…':'已存储 '+formatSize(size)+(demo?' <button class="subtle" data-action="samples" style="font-size:11px">清除示例</button>':'');
}
function renderFiles(){
  const view=state.view, home=view==='home';
  $('files-title').textContent=home?'最近文件':(views[view]?.[0]||CATS[view]?.label);
  let files=state.files.filter(f=>Object.hasOwn(CATS,view)?f.category===view:view==='favorites'?f.favorite:view==='search'?state.searchIds.has(f.id):true);
  const byDate=(a,b)=>b.created-a.created;
  files.sort(home||state.sort==='new'?byDate:state.sort==='old'?(a,b)=>a.created-b.created:(a,b)=>a.name.localeCompare(b.name,'zh-CN'));
  $('files-desc').textContent=home?'最近添加到资料库的文件':view==='search'?(state.searching?'正在搜索文件名、标签和已提取的正文…':'关键词「'+state.q+'」 · '+files.length+' 个结果'):files.length+' 个文件';
  $('file-more').hidden=!home;$('sort').hidden=home;
  const list=$('file-list');
  if(state.loading){list.innerHTML='<div class="empty">正在打开资料库…</div>';return;}
  if(state.error){list.innerHTML='<div class="empty"><b>'+esc(state.error)+'</b><button class="secondary" data-action="retry">重新加载</button></div>';return;}
  if(view==='search'&&(state.searching||state.searchError)){list.innerHTML='<div class="empty">'+esc(state.searchError||'正在查找匹配的资料…')+'</div>';return;}
  if(!files.length){
    list.innerHTML='<div class="empty"><b>'+ (view==='search'?'没有匹配的文件':view==='favorites'?'还没有收藏':'这里还没有文件')+'</b>'+
      (view==='search'?'试试更短的关键词，或用空格分隔多个词。':view==='favorites'?'点一下文件旁的星标，就能在这里找到它。':'拖入一个文件，或点击「上传文件」开始整理。')+'</div>';return;
  }
  list.innerHTML=(home?files.slice(0,5):files).map(f=>{
    const c=CATS[f.category]??CATS.other;
    const detail=[(fileExt(f.name)||'文件').toUpperCase(),f.sample?'示例':formatSize(f.size),dateShort.format(f.created)].join(' · ');
    return '<div class="file-row" '+css(c)+'><button class="file-open" data-action="file" data-id="'+esc(f.id)+'"><span class="file-icon">'+I(c.icon)+'</span><span class="file-label"><span class="file-name" title="'+esc(f.name)+'">'+esc(f.name)+'</span><span class="file-meta">'+esc(detail)+'</span></span></button><span class="badge">'+c.label+'</span>'+iconButton('favorite',f.id,'star',f.favorite?'取消收藏':'收藏',f.favorite?'is-favorite':'')+iconButton('file',f.id,'more','文件详情')+'</div>';
  }).join('');
}
function renderPlan(){
  const panel=$('plan-panel'),home=state.view==='home',day=home?now:state.day;
  const tasks=state.tasks.filter(t=>t.day===day).sort((a,b)=>(a.time||'99:99').localeCompare(b.time||'99:99')||a.created-b.created);
  const done=tasks.filter(t=>t.done).length, percent=tasks.length?Math.round(100*done/tasks.length):0;
  panel.innerHTML='<div class="plan-title"><span class="plan-title-icon">'+I('calendar')+'</span><h2 id="plan-title">'+(home?'今日计划':'每日计划')+'</h2></div>'+
    (home?'<p class="plan-date">'+esc(dateFmt.format(readDate(day)))+'</p>':'<label class="sr-only" for="plan-day">计划日期</label><input class="date-input" id="plan-day" type="date" value="'+day+'">')+
    '<div class="progress-area"><div class="progress-label"><span>完成进度 · '+done+'/'+tasks.length+'</span><span>'+percent+'%</span></div><progress max="100" value="'+percent+'" aria-label="计划完成进度"></progress></div><div class="task-list">'+
    (state.loading?'<div class="empty">正在加载计划…</div>':state.error?'<div class="empty">'+esc(state.error)+'</div>':tasks.length?tasks.map(t=>'<div class="task-row '+(t.done?'done':'')+'"><button class="task-check" type="button" role="checkbox" aria-checked="'+t.done+'" data-action="toggle-task" data-id="'+esc(t.id)+'" aria-label="'+esc(t.title)+'">'+(t.done?I('check'):'')+'</button><button class="task-body" data-action="edit-task" data-id="'+esc(t.id)+'"><b>'+esc(t.title)+'</b><small>'+esc(t.time||'全天')+'</small></button><span class="badge" '+css(KINDS[t.kind]??CATS.other)+'>'+esc(t.kind)+'</span></div>').join(''):'<div class="empty">这天还没有安排。</div>')+
    '</div><button class="add-task" data-action="add-task" '+(state.error||state.loading?'disabled':'')+'>'+I('plus')+' 添加计划</button>';
}
function render(){
  const home=state.view==='home',plan=state.view==='plan';
  $('crumb').textContent=views[state.view]?.[0]||CATS[state.view]?.label;
  $('hero').hidden=!home;$('quick').hidden=!home;
  $('dashboard').classList.toggle('full',!home);
  $('dashboard').querySelector('.files-column').hidden=plan;
  $('dropzone').hidden=!home;$('plan-panel').hidden=!(home||plan);
  nav();if(!plan)renderFiles();if(plan||home)renderPlan();
}
async function load(day=state.view==='plan'?state.day:now){
  const rev=++loadRevision;
  try{
    const result=await api('/api/workspace?day='+day);
    if(rev!==loadRevision)return;
    state.files=result.files;state.tasks=[...state.tasks.filter(t=>t.day!==day),...result.tasks];state.error='';
  }catch(e){if(rev!==loadRevision)return;state.error=e.message;}
  finally{if(rev===loadRevision){state.loading=false;render();}}
}
function search(){
  const q=$('search').value.trim().slice(0,150);
  const rev=++searchRevision;clearTimeout(searchTimer);
  state.q=q;
  if(!q){if(state.view==='search')setView('library');return;}
  state.searching=true;state.searchError='';setView('search',{clear:false});
  searchTimer=setTimeout(async()=>{
    try{
      const result=await api('/api/search?q='+encodeURIComponent(q));
      if(rev===searchRevision)state.searchIds=new Set(result.ids);
    }catch(e){if(rev===searchRevision)state.searchError=e.message;}
    finally{if(rev===searchRevision){state.searching=false;renderFiles();}}
  },140);
}
function show(title,content){
  dialog.innerHTML='<div class="dialog-head"><h2 id="dialog-title">'+esc(title)+'</h2><button type="button" class="icon-button" aria-label="关闭" data-action="close">'+I('close')+'</button></div>'+content;
  dialog.setAttribute('aria-labelledby','dialog-title');
  if(!dialog.open)dialog.showModal();
}
function modalError(err){const target=dialog.querySelector('.dialog-error');if(target){target.textContent=err.message;target.hidden=false;}else toast(err.message);}
const buttons=(deleteBtn,save='保存')=>'<p class="dialog-error" role="alert" hidden></p><div class="dialog-buttons">'+deleteBtn+'<button type="button" class="secondary" data-action="close">取消</button><button type="submit" class="primary">'+save+'</button></div>';
function updateFile(file){
  const i=state.files.findIndex(f=>f.id===file.id);if(i<0)state.files.unshift(file);else state.files[i]=file;
  if(state.view==='search')search();else render();
}
function confirmAction(title,detail,action){
  show(title,'<form class="dialog-body"><p>'+esc(detail)+'</p>'+buttons('','确认删除')+'</form>');
  wireForm(action);
}
function wireForm(action){
  const form=dialog.querySelector('form');
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(form.dataset.saving)return;form.dataset.saving='yes';form.querySelector('[type=submit]').disabled=true;
    try{await action(new FormData(form));if(dialog.contains(form))dialog.close();}
    catch(err){if(dialog.contains(form))modalError(err);else toast(err.message);}
    finally{delete form.dataset.saving;form.querySelector('[type=submit]').disabled=false;}
  });
}
let detailRevision=0;
dialog.addEventListener('close',()=>{detailRevision++;});
async function fileDetail(id){
  const rev=++detailRevision;
  const preview=state.files.find(f=>f.id===id);if(!preview)return;
  show(preview.name,'<div class="dialog-body"><p>正在读取文件详情…</p></div>');
  try{
    const {file:f}=await api(fileUrl(id));
    if(rev!==detailRevision||!dialog.open)return;
    const format=fileExt(f.name);
    const isImage=/^(png|jpe?g|gif|webp|avif|bmp)$/.test(format)||f.sample&&format==='svg';
    const method={text:'已提取正文，可搜索正文和标签。',image:'已识别图片尺寸；可按文件名和标签查找。',format:'按格式和文件名归类；此文件未提取正文。',sample:'这是用于试用的示例文件。'}[f.method]||'';
    show(f.name,'<form class="dialog-body"><p>'+esc(method)+'</p>'+
      (isImage?'<img class="file-image" src="'+fileUrl(id)+'/content?preview=1" alt="'+esc(f.name)+'">':'')+
      '<p>'+esc(f.summary)+'</p>'+(f.body?'<pre class="text-preview" aria-label="正文摘录">'+esc(f.body.slice(0,1200))+'</pre>':'')+
      '<label>文件名<input name="name" required maxlength="255" value="'+esc(f.name)+'"></label><label>分类<select name="category" aria-label="分类">'+Object.entries(CATS).map(([key,c])=>'<option value="'+key+'" '+(key===f.category?'selected':'')+'>'+c.label+'</option>').join('')+'</select></label>'+
      '<label>标签<input name="tags" value="'+esc(f.tags.join('，'))+'" maxlength="290" placeholder="用逗号分隔多个标签"></label>'+
      '<p class="dialog-error" role="alert" hidden></p><div class="dialog-buttons"><button type="button" class="secondary danger" data-action="delete-file" data-id="'+esc(id)+'">'+I('trash')+'删除</button>'+
      '<a class="secondary" download href="'+fileUrl(id)+'/content">'+I('download')+'下载原件</a><button class="primary" type="submit">保存</button></div></form>');
    wireForm(async fd=>{
      const {file}=await api(fileUrl(id),'PATCH',{name:fd.get('name'),category:fd.get('category'),tags:fd.get('tags').split(/[,，]/).map(v=>v.trim()).filter(Boolean)});
      updateFile(file);toast('文件信息已保存。');
    });
  }catch(e){if(rev===detailRevision&&dialog.open)show(preview.name,'<div class="dialog-body"><p class="dialog-error">'+esc(e.message)+'</p></div>');}
}
function taskEditor(id){
  const task=state.tasks.find(t=>t.id===id);
  const day=task?.day||(state.view==='home'?now:state.day);
  show(task?'编辑计划':'添加计划','<form class="dialog-body"><label>计划名称<input name="title" placeholder="今天想完成什么？" maxlength="130" required autofocus value="'+esc(task?.title)+'"></label>'+
    '<label>日期<input name="day" type="date" required value="'+esc(day)+'"></label><label>时间（可选）<input name="time" type="time" value="'+esc(task?.time)+'"></label><label>类别<select name="kind" aria-label="类别">'+Object.keys(KINDS).map(k=>'<option '+((task?.kind||'工作')===k?'selected':'')+'>'+k+'</option>').join('')+'</select></label>'+
    buttons(task?'<button class="secondary danger" type="button" data-action="delete-task" data-id="'+esc(id)+'">'+I('trash')+'删除</button>':'',task?'保存':'添加计划')+'</form>');
  wireForm(async fd=>{
    const {task:result}=await api(taskUrl(id),task?'PATCH':'POST',Object.fromEntries(fd));
    state.tasks=[...state.tasks.filter(t=>t.id!==result.id),result];render();toast(task?'计划已更新。':'计划已添加。');
  });
}
async function upload(files){
  if(state.importing){toast('正在导入上一批文件，请稍后再试。');return;}
  if(!files.length)return;
  state.importing=true;
  const drop=$('dropzone');const title=drop.querySelector('b');
  let ok=0,errors=[];
  for(let i=0;i<files.length;i++){
    const file=files[i];
    title.textContent='正在导入 '+(i+1)+' / '+files.length;
    if(file.size>MAX_SIZE){errors.push(file.name+' 超过 30 MB');continue;}
    try{
      const result=await analyze(file),fd=new FormData();
      fd.append('file',file);fd.append('analysis',JSON.stringify(result));
      const {file:saved}=await api('/api/files','POST',fd);
      updateFile(saved);ok++;
    }catch(e){errors.push(file.name+'：'+e.message);}
  }
  state.importing=false;title.textContent='拖放文件到这里';
  if(errors.length){
    show('导入结果','<div class="dialog-body"><p>已导入 '+ok+' 个文件，'+errors.length+' 个未完成。</p>'+errors.map(e=>'<p class="dialog-error">'+esc(e)+'</p>').join('')+'</div>');
  }else toast('已导入并归类 '+ok+' 个文件。');
}
document.querySelectorAll('[data-icon]').forEach(x=>x.innerHTML=I(x.dataset.icon));
$('shortcut').textContent=/Mac|iPhone/.test(navigator.platform)?'⌘ K':'Ctrl K';
$('search').addEventListener('input',search);
$('sort').addEventListener('change',e=>{state.sort=e.target.value;renderFiles();});
$('file-input').addEventListener('change',e=>{const files=[...e.target.files];e.target.value='';void upload(files);});
$('mobile-menu').addEventListener('click',()=>{
  const open=$('sidebar').classList.toggle('open');$('shade').hidden=!open;$('mobile-menu').setAttribute('aria-expanded',String(open));
});
$('shade').addEventListener('click',hideMenu);
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&!dialog.open){e.preventDefault();$('search').focus();$('search').select();}
  if(e.key==='Escape'&&!dialog.open){hideMenu();if(document.activeElement===$('search')){$('search').value='';search();}}
});
$('plan-panel').addEventListener('change',e=>{
  if(e.target.id!=='plan-day'||!e.target.value)return;
  state.day=e.target.value;state.loading=true;renderPlan();void load(state.day);
});
const drop=$('dropzone');
let drags=0;
drop.addEventListener('dragenter',e=>{e.preventDefault();if(e.dataTransfer.types.includes('Files')){drags++;drop.classList.add('dragging');}});
drop.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';});
drop.addEventListener('dragleave',e=>{e.preventDefault();if(--drags<=0){drags=0;drop.classList.remove('dragging');}});
drop.addEventListener('drop',e=>{e.preventDefault();drags=0;drop.classList.remove('dragging');void upload([...e.dataTransfer.files]);});
document.addEventListener('click',async e=>{
  const target=e.target.closest('[data-view],[data-action],[data-upload]');if(!target||target.disabled)return;
  if(target.hasAttribute('data-upload')){if(!state.importing)$('file-input').click();return;}
  if(target.dataset.view){
    setView(target.dataset.view);$('main').focus({preventScroll:true});
    if(state.view==='plan'||state.view==='home')void load();
    return;
  }
  const {action,id}=target.dataset;
  try{
    if(action==='close'){dialog.close();return;}
    if(action==='retry'){state.loading=true;render();void load();return;}
    if(action==='file'){void fileDetail(id);return;}
    if(action==='favorite'){
      const f=state.files.find(x=>x.id===id);if(!f)return;target.disabled=true;
      const {file}=await api(fileUrl(id),'PATCH',{favorite:!f.favorite});updateFile(file);toast(file.favorite?'已加入收藏。':'已取消收藏。');
    }
    if(action==='delete-file')confirmAction('删除文件？','文件及其正文索引会从资料库中移除。',async()=>{
      await api(fileUrl(id),'DELETE');state.files=state.files.filter(f=>f.id!==id);render();toast('文件已删除。');
    });
    if(action==='add-task'||action==='edit-task')taskEditor(id);
    if(action==='toggle-task'){
      const task=state.tasks.find(t=>t.id===id);if(!task)return;target.disabled=true;
      const {task:updated}=await api(taskUrl(id),'PATCH',{done:!task.done});
      state.tasks=state.tasks.map(t=>t.id===id?updated:t);renderPlan();
    }
    if(action==='delete-task')confirmAction('删除计划？','这条安排会从每日计划中移除。',async()=>{
      await api(taskUrl(id),'DELETE');state.tasks=state.tasks.filter(t=>t.id!==id);renderPlan();toast('计划已删除。');
    });
    if(action==='samples')confirmAction('清除示例内容？','会移除示例文件和示例计划。你上传的资料和添加的计划会保留。',async()=>{
      await api('/api/samples','DELETE');state.files=state.files.filter(f=>!f.sample);state.tasks=state.tasks.filter(t=>!t.id.startsWith('sample-task-'));render();toast('示例已清除。');
    });
  }catch(err){target.disabled=false;toast(err.message);}
});
render();void load();

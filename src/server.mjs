const MAX_SIZE=30*1024*1024;
const categories=new Set(['doc','image','sheet','other']);
const kinds=new Set(['工作','学习','生活','其他']);
const imageMime=new Map([['png','image/png'],['jpg','image/jpeg'],['jpeg','image/jpeg'],['gif','image/gif'],['webp','image/webp'],['avif','image/avif'],['bmp','image/bmp']]);
const demoSvg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 480"><defs><linearGradient id="s" x2="0" y2="1"><stop stop-color="#b7a0eb"/><stop offset="1" stop-color="#ffcaaf"/></linearGradient></defs><path fill="url(#s)" d="M0 0h760v480H0z"/><circle cx="550" cy="139" r="61" fill="#ffedd3"/><path fill="#8c75b9" d="m0 320 210-169 161 134 120-88 269 125v158H0Z"/><path fill="#52456f" d="m0 382 208-114 159 98 178-55 215 89v80H0Z"/></svg>';
const demos=[
  ['产品讨论纪要.md','text/markdown','doc',['MD','工作','会议'],'本周产品讨论：统一资料入口，优先完善文件搜索与归档。\n待办：整理反馈，周五前更新方案。'],
  ['旅行灵感.svg','image/svg+xml','image',['SVG','生活','旅行'],demoSvg],
  ['十一月预算.csv','text/csv','sheet',['CSV','财务'],'类别,预算,实际\n餐饮,1200,450\n交通,400,130\n学习,300,100'],
  ['学习笔记.txt','text/plain','doc',['TXT','学习'],'阅读笔记：先收集，再整理。每周复习已读内容，记录一个可行动的想法。'],
  ['归档清单.json','application/json','sheet',['JSON','计划'],'{"主题":"每周整理","待办":["检查临时文件","清理重复资料","更新归档标签"]}'],
  ['灵感书签.url','application/octet-stream','other',['URL','设计'],'[InternetShortcut]\r\nURL=https://example.com/\r\n']
];
class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new HttpError(status,message);};
const json=(x,status=200)=>Response.json(x,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const trim=(v,n)=>typeof v==='string'?v.trim().slice(0,n):'';
const field=(data,k,n)=>trim(data?.[k],n);
const idMatch=/^[a-z0-9-]{1,60}$/;
const validDay=(s)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const date=new Date(s+'T00:00:00Z');return !isNaN(+date)&&date.toISOString().slice(0,10)===s;};
const fmtFile=({owner,body,source_path,archive_id,archive_relative,...row})=>({...row,sourcePath:source_path,archiveId:archive_id,archiveRelative:archive_relative,tags:JSON.parse(row.tags),favorite:!!row.favorite,sample:!!row.sample,...(body!==undefined?{body}:{})});
const fmtTask=({owner,...row})=>({...row,done:!!row.done});
const cleanTags=(value)=>Array.isArray(value)?[...new Set(value.map(v=>trim(v,28)).filter(Boolean))].slice(0,10):[];
function cleanSourcePath(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\\:\u0000]/u.test(value)) return '';
  const segments = value.split('/');
  if (segments.length < 2 || segments.some(part => !part || part === '.' || part === '..')) return '';
  return value;
}
const bodyJson=async request=>{try{return await request.json();}catch{fail(400,'请求内容格式无效。');}};
const sqlCols='id, name, mime, size, category, tags, summary, method, created, favorite, sample, source_path, archive_id, archive_relative';
const getFile=(db,id,owner)=>db.prepare('SELECT * FROM files WHERE id = ? AND owner = ?').bind(id,owner).first();
const getTask=(db,id,owner)=>db.prepare('SELECT * FROM tasks WHERE id = ? AND owner = ?').bind(id,owner).first();
const insertFile='INSERT INTO files(id,owner,name,mime,size,category,tags,summary,body,method,created,favorite,sample,source_path) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
const insertTask='INSERT INTO tasks(id,owner,day,title,time,kind,done,created) VALUES(?,?,?,?,?,?,?,?)';
const keyFor=(owner,id)=>encodeURIComponent(owner)+'/'+id;

async function initialize(db,owner,day,withSamples=true) {
  if(await db.prepare('SELECT owner FROM libraries WHERE owner = ?').bind(owner).first())return;
  const now=Date.now();
  if(!withSamples){
    await db.prepare('INSERT OR IGNORE INTO libraries(owner,created) VALUES(?,?)').bind(owner,now).run();
    return;
  }
  const ops=[];
  for(let i=0;i<demos.length;i++){
    const [name,mime,category,tags,raw]=demos[i],body=category==='image'?'':raw;
    ops.push(db.prepare(insertFile.replace('INSERT INTO','INSERT OR IGNORE INTO')).bind('demo-'+i+'-'+owner,owner,name,mime,new TextEncoder().encode(raw).length,category,JSON.stringify(tags),category==='image'?'示例图片：日落下的山谷插画。':body.slice(0,175),body,'sample',now-i*3200000,0,1,''));
  }
  for(const [i,title,time,kind,done] of [[0,'梳理本周的待办','09:00','工作',1],[1,'整理项目参考资料','11:30','工作',0],[2,'阅读并记录三条笔记','15:00','学习',0],[3,'回顾今天的进度','18:00','生活',0]]){
    ops.push(db.prepare(insertTask.replace('INSERT INTO','INSERT OR IGNORE INTO')).bind('sample-task-'+i+'-'+owner,owner,day,title,time,kind,done,now+i));
  }
  ops.push(db.prepare('INSERT OR IGNORE INTO libraries(owner,created) VALUES(?,?)').bind(owner,now));
  await db.batch(ops);
}
function matches(row,words){const text=[row.name,row.source_path,row.tags,row.summary,row.body].join('\n').normalize('NFKC').toLowerCase();return words.every(w=>text.includes(w));}
async function route(request,env,path,owner,url){
  const db=env.DB;
  const day=url.searchParams.get('day')||new Date().toISOString().slice(0,10);
  const method=request.method;
  if(method==='GET' && path==='/api/workspace'){
    if(!validDay(day))fail(400,'日期无效。');
    await initialize(db,owner,day,url.protocol!=='guixu:');
    const [files,tasks,archives]=await Promise.all([
      db.prepare('SELECT '+sqlCols+' FROM files WHERE owner = ? ORDER BY created DESC').bind(owner).all(),
      db.prepare('SELECT * FROM tasks WHERE owner = ? AND day = ? ORDER BY time = \'\', time, created').bind(owner,day).all(),
      db.prepare("SELECT id,name,path,directories,created FROM archives WHERE owner = ? AND kind = 'folder' ORDER BY created DESC").bind(owner).all()
    ]);
    return json({files:files.results.map(fmtFile),tasks:tasks.results.map(fmtTask),archives:archives.results.map(({directories,...row})=>({...row,directories:JSON.parse(directories)}))});
  }
  if(method==='GET' && path==='/api/search'){
    const words=trim(url.searchParams.get('q'),150).normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean);
    if(!words.length)return json({ids:[]});
    let cursor=0, ids=[];
    for(;;){
      const {results}=await db.prepare('SELECT rowid, id, name, source_path, tags, summary, body FROM files WHERE owner = ? AND rowid > ? ORDER BY rowid LIMIT 32').bind(owner,cursor).all();
      for(const row of results){if(matches(row,words))ids.push(row.id);cursor=row.rowid;}
      if(results.length<32)break;
    }
    return json({ids});
  }
  if(method==='POST' && path==='/api/files'){
    if(Number(request.headers.get('content-length'))>MAX_SIZE+1_300_000)fail(413,'单个文件不能超过 30 MB。');
    let data;try{data=await request.formData();}catch{fail(400,'无法读取上传的文件。');}
    const file=data.get('file');
    if(!file || typeof file==='string')fail(400,'请选择文件。');
    if(file.size>MAX_SIZE)fail(413,'单个文件不能超过 30 MB。');
    let analysis;try{analysis=JSON.parse(data.get('analysis')||'{}');}catch{fail(400,'文件分析结果格式无效。');}
    const category=categories.has(analysis?.category)?analysis.category:'other';
    const body=field(analysis,'body',200000),tags=cleanTags(analysis?.tags),summary=field(analysis,'summary',350)||'已保存原件。';
    const id=crypto.randomUUID(), name=trim(file.name,255)||'未命名文件',mime=trim(file.type,100)||'application/octet-stream',now=Date.now();
    const type=body?'text':analysis?.method==='image'?'image':'format';
    const sourcePath=cleanSourcePath(data.get('sourcePath'));
    const key=keyFor(owner,id);
    await env.BUCKET.put(key,file);
    try{await db.prepare(insertFile).bind(id,owner,name,mime,file.size,category,JSON.stringify(tags),summary,body,type,now,0,0,sourcePath).run();}
    catch(error){await env.BUCKET.delete(key).catch(()=>{});throw error;}
    return json({file:fmtFile(await getFile(db,id,owner))},201);
  }
  const index=/^\/api\/files\/([a-z0-9-]+)\/index$/.exec(path);
  if(method==='POST' && index && url.protocol==='guixu:'){
    const value=await bodyJson(request);
    const body=field(value,'body',200000), tags=cleanTags(value?.tags);
    const summary=field(value,'summary',350)||'已移动到归档盘。';
    const analysisMethod=body?'text':value?.method==='image'?'image':'format';
    await db.prepare("UPDATE files SET tags=?,summary=?,body=?,method=? WHERE owner=? AND id=? AND archive_id IS NOT NULL AND method='pending'").bind(JSON.stringify(tags),summary,body,analysisMethod,owner,index[1]).run();
    return json({ok:true});
  }
  const fm=/^\/api\/files\/([^/]+)(\/content)?$/.exec(path);
  if(fm){
    const id=decodeURIComponent(fm[1]);
    if(!idMatch.test(id) && !id.startsWith('demo-'))fail(404,'找不到这个文件。');
    const row=await getFile(db,id,owner);
    if(!row)fail(404,'找不到这个文件。');
    if(method==='GET' && fm[2]){
      const ext=row.name.split('.').pop()?.toLowerCase();
      const inline=url.searchParams.has('preview') && (imageMime.has(ext) || row.sample && ext==='svg');
      const file=row.sample?null:await env.BUCKET.get(keyFor(owner,id));
      if(!row.sample&&!file)fail(404,'找不到原始文件。');
      const sample=row.sample?demos[Number(id.split('-')[1])]?.[4]:null;
      const headers={'Content-Type':inline?(imageMime.get(ext)||'image/svg+xml'):'application/octet-stream','Content-Disposition':inline?'inline':"attachment; filename*=UTF-8''"+encodeURIComponent(row.name).replace(/['()*]/g,s=>'%'+s.charCodeAt(0).toString(16)),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"};
      return new Response(file?.body??sample??'',{headers});
    }
    if(fm[2])fail(405,'操作不受支持。');
    if(method==='GET')return json({file:fmtFile(row)});
    if(method==='PATCH'){
      const value=await bodyJson(request);
      const category=categories.has(value?.category)?value.category:row.category;
      const tags=value?.tags===undefined?row.tags:JSON.stringify(cleanTags(value.tags));
      const favorite=typeof value?.favorite==='boolean'?Number(value.favorite):row.favorite;
      const name=value?.name===undefined?row.name:field(value,'name',255);
      if(!name)fail(400,'文件名不能为空。');
      await db.prepare('UPDATE files SET category=?,tags=?,favorite=?,name=? WHERE id=? AND owner=?').bind(category,tags,favorite,name,id,owner).run();
      return json({file:fmtFile(await getFile(db,id,owner))});
    }
    if(method==='DELETE'){
      if(row.archive_id)fail(409,'请在资源管理器中管理归档原件。');
      if(!row.sample)await env.BUCKET.delete(keyFor(owner,id));
      await db.prepare('DELETE FROM files WHERE id=? AND owner=?').bind(id,owner).run();
      return json({ok:true});
    }
  }
  if(method==='DELETE'&&path==='/api/samples'){
    await db.batch([
      db.prepare('DELETE FROM files WHERE owner=? AND sample=1').bind(owner),
      db.prepare("DELETE FROM tasks WHERE owner=? AND substr(id,1,12)='sample-task-'").bind(owner)
    ]);return json({ok:true});
  }
  const tm=/^\/api\/tasks(?:\/([^/]+))?$/.exec(path);
  if(tm){
    const id=tm[1]?decodeURIComponent(tm[1]):'';
    if(method==='POST'&&!id || (method==='PATCH'||method==='DELETE')&&id){
      const row=id?await getTask(db,id,owner):null;
      if(id&&!row)fail(404,'找不到这个计划。');
      if(method==='DELETE'){
        await db.prepare('DELETE FROM tasks WHERE id=? AND owner=?').bind(id,owner).run();return json({ok:true});
      }
      const value=await bodyJson(request);
      const title=value?.title===undefined?(row?.title??''):field(value,'title',130);
      const date=value?.day===undefined?(row?.day??day):field(value,'day',12);
      const time=value?.time===undefined?(row?.time??''):field(value,'time',5);
      const kind=value?.kind===undefined?(row?.kind??'其他'):field(value,'kind',8);
      const done=typeof value?.done==='boolean'?Number(value.done):row?.done??0;
      if(!title||!validDay(date)||time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||!kinds.has(kind))fail(400,'请检查计划名称、日期和时间。');
      const key=id||crypto.randomUUID();
      if(id)await db.prepare('UPDATE tasks SET title=?,day=?,time=?,kind=?,done=? WHERE id=? AND owner=?').bind(title,date,time,kind,done,key,owner).run();
      else await db.prepare(insertTask).bind(key,owner,date,title,time,kind,done,Date.now()).run();
      return json({task:fmtTask(await getTask(db,key,owner))},id?200:201);
    }
  }
  fail(404,'没有找到这个页面。');
}
export async function handle(request,env,assets){
  const url=new URL(request.url),path=url.pathname;
  if(!path.startsWith('/api/')){
    const asset=assets[path==='/'?'/index.html':path];
    if(!Array.isArray(asset))return new Response('Not found',{status:404});
    return new Response(request.method==='HEAD'?null:asset[2]?Uint8Array.from(atob(asset[1]),c=>c.charCodeAt(0)):asset[1],{headers:{'Content-Type':asset[0],'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'",'Cache-Control':path.startsWith('/vendor/')?'public, max-age=86400':'no-cache'}});
  }
  const owner=request.headers.get('oai-authenticated-user-id');
  if(!owner)return json({error:'请登录后打开你的私人资料库。'},401);
  if(!['GET','HEAD'].includes(request.method)&&request.headers.get('sec-fetch-site')==='cross-site')return json({error:'请从资料中心内操作。'},403);
  if(!env.DB||!env.BUCKET)return json({error:'资料库暂时不可用。'},503);
  try{return await route(request,env,path,owner,url);}
  catch(error){if(!(error instanceof HttpError))console.error('Library request failed',path.replace(/\/api\/(files|tasks)\/.+/,'/api/$1/:id'),String(error?.message??error));return json({error:error instanceof HttpError?error.message:'操作未完成，请稍后重试。'},error instanceof HttpError?error.status:500);}
}

export const MAX_SIZE = 30 * 1024 * 1024;
const TEXT_LIMIT = 200000;
const doc = new Set('pdf doc docx rtf txt md markdown odt ppt pptx pages log srt vtt tex'.split(' '));
const image = new Set('png jpg jpeg webp gif avif svg heic heif bmp ico tiff tif raw dng psd'.split(' '));
const sheet = new Set('xlsx xls xlsm ods csv tsv json xml numbers'.split(' '));
const plain = new Set('txt md markdown csv tsv json xml yaml yml log html htm rtf srt vtt tex js ts py css sql ini'.split(' '));
const wordGroups = [
  ['工作', /会议|纪要|项目|汇报|方案|客户|合同|meeting|project|proposal/i],
  ['学习', /笔记|课程|作业|学习|论文|复习|研究|study|notes|research/i],
  ['财务', /预算|账单|报销|支出|收入|发票|金额|budget|invoice|expense/i],
  ['生活', /旅行|摄影|食谱|健身|日记|护照|travel|diary|recipe/i],
  ['设计', /设计|素材|插画|海报|灵感|风格|design|brand|illustration/i],
  ['计划', /计划|日程|目标|待办|安排|plan|schedule|todo/i],
];
export function fileExt(name) {
  return /\.([^.]{1,15})$/.exec(name)?.[1].toLowerCase() ?? '';
}
export function categoryFor(name, mime = '') {
  const ext = fileExt(name);
  if (image.has(ext) || mime.startsWith('image/')) return 'image';
  if (sheet.has(ext) || /spreadsheet|excel|text\/csv/.test(mime)) return 'sheet';
  if (doc.has(ext) || /pdf|wordprocessing|presentation|msword|text\/plain/.test(mime)) return 'doc';
  return 'other';
}
export function insights(name, mime, raw, dimensions) {
  const ext = fileExt(name);
  const category = categoryFor(name, mime);
  const body = raw.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0,TEXT_LIMIT);
  const tags = [...(ext ? [ext.toUpperCase()] : []), ...wordGroups.filter(([, rx]) => rx.test(name + '\n' + body)).map(([tag]) => tag)].slice(0,6);
  const summary = body ? [...body.replace(/\s+/g, ' ')].slice(0,175).join('') + (body.length > 175 ? '…' : '') :
    dimensions ? '图片尺寸 ' + dimensions + '。已按图片格式和文件名归类。' : '已保存原件，并按文件格式和文件名归类。';
  return {category,tags,body,summary,method:body ? 'text' : dimensions ? 'image' : 'format'};
}
function decodePlain(bytes) {
  if (bytes[0] === 255 && bytes[1] === 254) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 254 && bytes[1] === 255) return new TextDecoder('utf-16be').decode(bytes);
  const utf8 = new TextDecoder().decode(bytes);
  return utf8.includes('\ufffd') ? new TextDecoder('gb18030').decode(bytes) : utf8;
}
async function pdfText(file) {
  const pdfjs = await import('/vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs';
  const loading = pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()), isEvalSupported:false, stopAtErrors:false, useWasm:false, useWorkerFetch:false,cMapUrl:'/vendor/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/standard_fonts/'});
  try {
    const pdf = await loading.promise;
    const parts = [];
    let chars = 0;
    for (let i=1; i<=Math.min(pdf.numPages,120) && chars<TEXT_LIMIT; i++) {
      const page = await pdf.getPage(i);
      const {items} = await page.getTextContent();
      const value = items.map(item => (item.str ?? '') + (item.hasEOL ? '\n' : ' ')).join('');
      parts.push(value); chars += value.length; page.cleanup();
    }
    return parts.join('\n');
  } finally {await loading.destroy();}
}
async function officeText(file, ext) {
  const b = await file.arrayBuffer(), v = new DataView(b);
  const names = new TextDecoder();
  let end = -1;
  for (let p=b.byteLength-22; p>=Math.max(0,b.byteLength-65557); p--) {
    if (v.getUint32(p,true)===0x06054b50 && p+22+v.getUint16(p+20,true)===b.byteLength) {end=p;break;}
  }
  if (end<0) return '';
  const pick = ext==='docx' ? /^word\/(document|header\d+|footer\d+|footnotes)\.xml$/ : ext==='pptx' ? /^ppt\/slides\/slide\d+\.xml$/ :
    /^(xl\/(sharedStrings|worksheets\/sheet\d+)|content)\.xml$/;
  const entries=[];
  let offset=v.getUint32(end+16,true);
  for(let i=0;i<v.getUint16(end+10,true) && offset+46<=end;i++){
    if(v.getUint32(offset,true)!==0x02014b50) break;
    const length=v.getUint16(offset+28,true);
    if(offset+46+length>end) break;
    const name=names.decode(new Uint8Array(b,offset+46,length));
    const compressed=v.getUint32(offset+20,true), size=v.getUint32(offset+24,true), start=v.getUint32(offset+42,true), method=v.getUint16(offset+10,true);
    if(pick.test(name) && size<=5_000_000 && start+30<=b.byteLength && v.getUint32(start,true)===0x04034b50){
      const p=start+30+v.getUint16(start+26,true)+v.getUint16(start+28,true);
      if(p+compressed<=b.byteLength) entries.push({name,p,compressed,method});
    }
    offset+=46+length+v.getUint16(offset+30,true)+v.getUint16(offset+32,true);
  }
  entries.sort((a,b)=>a.name.localeCompare(b.name,'en',{numeric:true}));
  const parts=[];
  let chars=0;
  for(const entry of entries.slice(0,100)){
    const bytes=new Uint8Array(b,entry.p,entry.compressed);
    let xml;
    if(entry.method===0) xml=names.decode(bytes);
    else if(entry.method===8){
      const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      let total=0;
      const decoder=new TextDecoder(), chunks=[];
      while(true){const {done,value}=await reader.read(); if(done) break; total+=value.length; if(total>5_000_000){await reader.cancel();break;} chunks.push(decoder.decode(value,{stream:true}));}
      if(total>5_000_000) continue;
      xml=chunks.join('')+decoder.decode();
    } else continue;
    const dom=new DOMParser().parseFromString(xml,'application/xml');
    if(dom.getElementsByTagName('parsererror').length) continue;
    let out;
    if(ext==='docx' || ext==='pptx'){
      out=[...dom.getElementsByTagNameNS('*','p')].map(p=>[...p.getElementsByTagNameNS('*','t')].map(t=>t.textContent).join('')).filter(Boolean).join('\n');
    }else if(ext==='xlsx' || ext==='xlsm'){
      out=[...dom.getElementsByTagNameNS('*','t')].map(t=>t.textContent).join('\n');
      const numeric=[...dom.getElementsByTagNameNS('*','c')].filter(c=>c.getAttribute('t')!=='s').flatMap(c=>[...c.getElementsByTagNameNS('*','v')].map(v=>v.textContent));
      if(numeric.length) out+='\n'+numeric.join(' ');
    } else out=dom.documentElement.textContent;
    parts.push(out); chars+=out.length; if(chars>=TEXT_LIMIT) break;
  }
  return parts.join('\n');
}
export async function analyze(file) {
  const ext=fileExt(file.name);
  let body='', dimensions='';
  try {
    if(ext==='pdf' || file.type==='application/pdf') body=await pdfText(file);
    else if(['docx','xlsx','xlsm','pptx','odt','ods'].includes(ext)) body=await officeText(file,ext);
    else if(plain.has(ext) || file.type.startsWith('text/') && ext!=='svg'){
      body=decodePlain(new Uint8Array(await file.slice(0,750000).arrayBuffer()));
      if(ext==='html' || ext==='htm') {const doc=new DOMParser().parseFromString(body,'text/html');doc.querySelectorAll('script,style').forEach(node=>node.remove());body=doc.body.textContent;}
    }else if(categoryFor(file.name,file.type)==='image' && ext!=='svg'){
      const bitmap=await createImageBitmap(file);
      dimensions=bitmap.width+' × '+bitmap.height+' 像素';bitmap.close();
    }
  } catch {}
  return insights(file.name,file.type,body,dimensions);
}

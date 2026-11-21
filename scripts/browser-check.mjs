import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.GUIXU_PLAYWRIGHT||'playwright');
const {PDFDocument}=require(process.env.GUIXU_PDFLIB||'pdf-lib');
const JSZip=require(process.env.GUIXU_JSZIP||'jszip');
const browser=await chromium.launch({executablePath:process.env.GUIXU_BROWSER||undefined,headless:true});
const url=process.env.GUIXU_TEST_URL||'http://127.0.0.1:4174';
await mkdir('outputs',{recursive:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:960},acceptDownloads:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);
  await page.getByRole('button',{name:'产品讨论纪要.md',exact:false}).waitFor();
  await page.screenshot({path:'outputs/desktop.png'});
  const doc=new JSZip();
  doc.file('word/document.xml','<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>合同归档验证词紫藤</w:t></w:r></w:p></w:body></w:document>');
  const word=await doc.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
  const pdf=await PDFDocument.create();pdf.addPage().drawText('LavenderPlanNeedle');
  const pdfBytes=Buffer.from(await pdf.save());
  const img=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64');
  const text=Buffer.from('项目会议纪要：正文索引验证词云杉。');
  await page.locator('#file-input').setInputFiles([
    {name:'临时验证.txt',mimeType:'text/plain',buffer:text},
    {name:'临时图.png',mimeType:'image/png',buffer:img},
    {name:'临时文档.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:word},
    {name:'临时资料.pdf',mimeType:'application/pdf',buffer:pdfBytes}
  ]);
  await page.getByRole('status').getByText('已导入并归类 4 个文件。').waitFor();
  const search=page.getByRole('searchbox',{name:'搜索资料'});
  await search.fill('验证词云杉');
  await page.getByRole('button',{name:/临时验证.txt/}).click();
  await page.getByText('已提取正文，可搜索正文和标签。').waitFor();
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'下载原件'}).click()]);
  assert.equal(download.suggestedFilename(),'临时验证.txt');
  const stream=await download.createReadStream();const chunks=[];for await(const item of stream)chunks.push(item);
  assert.deepEqual(Buffer.concat(chunks),text);
  await page.getByLabel('分类',{exact:true}).selectOption('other');
  await page.getByLabel('标签',{exact:true}).fill('自定义标记');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await search.fill('自定义标记');
  await page.getByRole('button',{name:/临时验证.txt/}).waitFor();
  await page.getByRole('button',{name:'收藏',exact:true}).click();
  await page.getByRole('button',{name:'我的收藏',exact:true}).click();
  await page.getByRole('button',{name:/临时验证.txt/}).waitFor();
  for(const [query,name] of [['验证词紫藤','临时文档.docx'],['LavenderPlanNeedle','临时资料.pdf'],['临时图','临时图.png']]){
    await search.fill(query);await page.getByRole('button',{name:new RegExp(name)}).waitFor();
  }
  await page.getByRole('button',{name:/临时图.png/}).click();
  await page.getByText('图片尺寸 1 × 1 像素。', {exact:false}).waitFor();
  await page.locator('.file-image').evaluate(img=>img.decode());
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'每日计划',exact:true}).click();
  await page.getByLabel('计划日期',{exact:true}).fill('2030-08-14');
  await page.getByRole('button',{name:'添加计划',exact:true}).click();
  await page.getByLabel('计划名称',{exact:true}).fill('验证每日计划');
  await page.getByLabel('时间（可选）',{exact:true}).fill('14:30');
  await page.getByRole('dialog').getByRole('button',{name:'添加计划',exact:true}).click();
  const check=page.getByRole('checkbox',{name:'验证每日计划'});
  await check.click();
  await page.getByText('完成进度 · 1/1',{exact:true}).waitFor();
  await page.reload();
  await page.getByLabel('计划日期',{exact:true}).fill('2030-08-14');
  await page.getByText('完成进度 · 1/1',{exact:true}).waitFor();
  await page.getByRole('button',{name:'我的收藏',exact:true}).click();
  await page.getByRole('button',{name:/临时验证.txt/}).click();
  assert.equal(await page.getByLabel('标签',{exact:true}).inputValue(),'自定义标记');
  assert.equal(await page.getByLabel('分类',{exact:true}).inputValue(),'other');
  await page.getByRole('button',{name:'删除',exact:true}).click();
  await page.getByRole('button',{name:'确认删除',exact:true}).click();
  await page.getByText('还没有收藏',{exact:true}).waitFor();
  const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,deviceScaleFactor:1,hasTouch:true});
  await mobile.goto(url);
  await mobile.getByRole('button',{name:'产品讨论纪要.md',exact:false}).waitFor();
  await mobile.getByRole('button',{name:'打开导航'}).click();
  await mobile.getByRole('button',{name:'全部资料',exact:true}).click();
  await mobile.getByRole('heading',{name:'全部资料',exact:true}).waitFor();
  await mobile.getByRole('button',{name:'打开导航'}).click();
  await mobile.getByRole('button',{name:'概览',exact:true}).click();
  await mobile.screenshot({path:'outputs/mobile.png',animations:'disabled'});
  assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth),390);
  assert.deepEqual(errors,[]);
  console.log('Browser checks passed: PDF/DOCX/text search, PNG preview, binary download, classification, favorites, deletion, planner persistence and mobile navigation.');
}finally{await browser.close();}

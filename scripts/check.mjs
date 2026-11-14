import assert from 'node:assert/strict';
import {readFile,stat,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const project=JSON.parse(await readFile(resolve(root,'source/project.json'),'utf8')).project;
const assets=JSON.parse(await readFile(resolve(root,'source/asset-map.json'),'utf8'));
const localURLs=new Set();
let widgets=0;
for(const page of project.pages){
  const dir=page.pagePath==='1'?'':page.pagePath;
  const html=await readFile(resolve(root,'dist',dir,'index.html'),'utf8');
  assert(!/NaN|Infinity|undefined/.test(html),`Invalid geometry on ${dir}`);
  assert(!/<(?:script|iframe|img|video|link)[^>]+(?:src|href)="https?:/.test(html),`Remote dependency on ${dir}`);
  assert(!/<iframe/.test(html),'All videos must play locally');
  assert(html.includes('class="layout desktop"')&&html.includes('class="layout mobile"'));
  const data=JSON.parse(await readFile(resolve(root,'source',`${page.pagePath}.json`),'utf8'));
  for(const w of data){
    if(w.type==='background')continue;
    const count=(html.match(new RegExp(`data-id="${w._id}"`,'g'))||[]).length;
    const expected=Number(!w.hidden)+Number(!(w.viewport_phone_portrait?.hidden ?? w.hidden));
    assert.equal(count,expected,`Missing widget/viewport ${w._id}`);widgets+=count;
  }
  for(const [,url] of html.matchAll(/(?:href|src|data-src|poster|data-lightbox)="(\/[^"#]*)/g)) localURLs.add(url.split('#')[0]);
}
for(const url of localURLs){
  const path=resolve(root,'dist','.'+url+(url.endsWith('/')?'index.html':''));
  assert((await stat(path)).size>0,`Missing or empty asset: ${url}`);
}
for(const [id,v] of Object.entries(assets.videos)){
  const bytes=await readFile(resolve(root,'dist','.'+v.src));
  assert(bytes.includes(Buffer.from('ftyp')),`Not an MP4: ${id}`);
  assert(bytes.includes(Buffer.from('moov')),`Missing video metadata: ${id}`);
  assert(bytes.includes(Buffer.from('mdat')),`Missing video frames: ${id}`);
}
console.log(`OK: ${project.pages.length} pages, ${widgets} desktop/mobile widgets, ${Object.keys(assets.images).length} images, ${Object.keys(assets.videos).length} videos, ${localURLs.size} local references.`);

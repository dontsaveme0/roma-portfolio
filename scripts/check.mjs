import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const project=JSON.parse(await readFile(resolve(root,'source/project.json'),'utf8')).project;
const assets=JSON.parse(await readFile(resolve(root,'source/asset-map.json'),'utf8'));
const optimized=JSON.parse(await readFile(resolve(root,'source/media-optimized.json'),'utf8'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const originalURLs=new Set([...Object.values(assets.images),...Object.values(assets.videos).flatMap(v=>[v.src,v.poster])]);
assert.equal(optimized.version,1,'Unsupported media manifest');
for(const [original,media] of Object.entries(optimized.files)){
  assert(originalURLs.has(original),`Unknown original: ${original}`);
  assert(/^\/assets\/optimized\/(images|videos)\/[\w.-]+$/.test(media.src),`Invalid optimized path: ${media.src}`);
  const source=await readFile(resolve(root,'.'+original));
  const output=await readFile(resolve(root,'dist','.'+media.src));
  assert.equal(digest(source),media.sourceSha256,`Original changed; rerun media optimization: ${original}`);
  assert.equal(digest(output),media.outputSha256,`Optimized asset changed: ${media.src}`);
  assert(output.length<source.length,`Optimization increased size: ${original}`);
}
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
  const replacement=optimized.files[v.src];
  const bytes=await readFile(resolve(root,'dist','.'+(replacement?.src || v.src)));
  assert(bytes.includes(Buffer.from('ftyp')),`Not an MP4: ${id}`);
  assert(bytes.includes(Buffer.from('moov')),`Missing video metadata: ${id}`);
  assert(bytes.includes(Buffer.from('mdat')),`Missing video frames: ${id}`);
  if(replacement){
    const atoms=[];
    for(let offset=0;offset<bytes.length;){
      assert(offset+8<=bytes.length,`Truncated MP4: ${id}`);
      const size=bytes.readUInt32BE(offset);
      atoms.push(bytes.toString('ascii',offset+4,offset+8));
      const length=size===1?Number(bytes.readBigUInt64BE(offset+8)):size || bytes.length-offset;
      assert(length>=8 && offset+length<=bytes.length,`Invalid MP4 atom: ${id}`);
      offset+=length;
    }
    assert(atoms.indexOf('moov')>=0 && atoms.indexOf('moov')<atoms.indexOf('mdat'),`Video cannot start streaming promptly: ${id}`);
  }
}
console.log(`OK: ${project.pages.length} pages, ${widgets} desktop/mobile widgets, ${Object.keys(assets.images).length} images, ${Object.keys(assets.videos).length} videos, ${localURLs.size} local references.`);

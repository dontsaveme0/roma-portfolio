import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const readJSON = async name => JSON.parse(await readFile(resolve(root, 'source', name), 'utf8'));
const project = (await readJSON('project.json')).project;
const assets = await readJSON('asset-map.json');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const px = n => `${Number(n) || 0}px`;
const cssName = s => s.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
const style = obj => Object.entries(obj).filter(([,v])=>v!==undefined && v!==null).map(([k,v])=>`${cssName(k)}:${v}`).join(';');
const color = s => {
  s = (s || '474A6064').replace('#','');
  if (s.length === 8) return `rgba(${parseInt(s.slice(0,2),16)},${parseInt(s.slice(2,4),16)},${parseInt(s.slice(4,6),16)},${parseInt(s.slice(6),16)/100})`;
  return '#' + s;
};
const pagePath = p => p.pagePath === '1' ? '/' : `/${p.pagePath}/`;
const pageFor = id => project.pages.find(p => p._id === id || p.pagePath === String(id));
const sharedStyles = Object.fromEntries(project.textStyles.project.map(s => [s.name, s.cssProperties]));
const sections = {'Кейсы':'cases','Опыт':'experience','Образование':'education','Галерея':'gallery'};
const sectionPositions = {};
for (const page of project.pages) {
  const widgets = await readJSON(`${page.pagePath}.json`);
  sectionPositions[page._id] = {};
  for (const [label,key] of Object.entries(sections)) {
    const w = widgets.find(w => w.type==='text' && w.blocks?.length===1 && w.blocks[0].text.toLowerCase()===label.toLowerCase() && !w.blocks[0].entityRanges?.length);
    if (w) {
      const positions=[w.y-32,(w.viewport_phone_portrait?.y ?? w.y)-32];
      // Preserve the authored anchor offsets, including room for the fixed menu.
      for (const [index,mobile] of [false,true].entries()) {
        for (const original of widgets.filter(item=>!item.fixed_position).sort((a,b)=>a.y-b.y)) {
          const nav=mobile?{...original,...original.viewport_phone_portrait}:original;
          const block=nav.blocks?.find(b=>b.text.trim()===label && b.entityRanges?.length);
          const data=block && nav.entityMap?.[block.entityRanges[0].key]?.data;
          if(data?.type==='Anchor'){positions[index]=data.anchorPosition;break;}
        }
      }
      sectionPositions[page._id][key]=positions;
    }
  }
}

function linkAttrs(data, text, currentPage) {
  if (data.type==='URL') {
    const url = data.url.includes('drive.google.com/file/d/1tqZvZ54Lz3266-npoza7TxmHprRyaouC') ? '/assets/documents/roma-zhigarev-cv.pdf' : data.url;
    return `href="${escape(url)}" target="${escape(data.target || '_self')}" rel="noopener noreferrer"`;
  }
  const page = pageFor(data.pageId || data.pageUri || data.pageNum) || currentPage;
  const anchor = data.type==='Anchor' ? (sections[text.trim()] || `at-${data.anchorPosition || 0}`) : '';
  return `href="${pagePath(page)}${anchor ? '#' + anchor : ''}"`;
}

function inlineStyle(inline, index) {
  const result = {};
  for (const range of inline?.styles || []) {
    if (index < range.offset || index >= range.offset + range.length) continue;
    for (const pair of range.styles) {
      const [ki,vi] = pair.split(';').map(Number);
      const key = inline.keys[ki], value = inline.values[vi];
      const map = {FONT_WEIGHT:'fontWeight',FONT_STYLE:'fontStyle',FONT_FAMILY:'fontFamily',FONT_SIZE:'fontSize',TRANSFORM:'textTransform',COLOR:'color'};
      if (map[key]) result[map[key]] = key==='COLOR' ? color(value) : key==='FONT_SIZE' ? px(value) : value;
      if (key==='BOLD') result.fontWeight = '700';
      if (key==='FEATURES' && value==='superscript') Object.assign(result,{verticalAlign:'baseline',position:'relative',top:'-0.4em',fontSize:'smaller'});
    }
  }
  return result;
}

function textHTML(w, page) {
  return (w.blocks || []).map(block => {
    const meta = w.blocksMeta?.find(m=>m.key===block.key)?.data || {};
    const inline = w.styles?.find(s=>s.key===block.key)?.inlineStyles;
    const shared = {...(sharedStyles[meta.textStyle] || {})};
    for (const key of ['fontSize','lineHeight','letterSpacing','paddingTop','paddingBottom','paddingLeft','paddingRight']) if (shared[key]!==undefined) shared[key]=px(shared[key]);
    if (shared.color) shared.color = color(shared.color);
    const initial = inlineStyle(inline,0);
    const paragraph = {...shared};
    for (const k of ['fontFamily','fontWeight','fontSize']) if (initial[k]) paragraph[k]=initial[k];
    if (meta.lineHeight!==undefined) paragraph.lineHeight = px(meta.lineHeight);
    if (meta.align) paragraph.textAlign=meta.align.replace('align-','');
    for (const [side,value] of Object.entries(meta.paddings || {})) paragraph['padding'+side[0].toUpperCase()+side.slice(1)]=px(value);
    const cuts = new Set([0,block.text.length]);
    for (const range of [...(inline?.styles || []),...(block.entityRanges || [])]) {cuts.add(range.offset);cuts.add(Math.min(block.text.length,range.offset+range.length));}
    const points = [...cuts].sort((a,b)=>a-b);
    const pieces=[];
    for(let i=0;i<points.length-1;i++) {
      const start=points[i],end=points[i+1];
      const entity = block.entityRanges?.find(r=>start>=r.offset && start<r.offset+r.length);
      const body=`<span style="${escape(style(inlineStyle(inline,start)))}">${escape(block.text.slice(start,end))}</span>`;
      const previous=pieces.at(-1);
      if (previous && previous.key===entity?.key) previous.html+=body;
      else pieces.push({key:entity?.key,html:body,range:entity});
    }
    const body = pieces.map(piece => {
      const data=w.entityMap?.[piece.key]?.data;
      if (!data) return piece.html;
      const label=block.text.slice(piece.range.offset,piece.range.offset+piece.range.length);
      return `<a class="${escape(data.linkStyle || '')}" ${linkAttrs(data,label,page)}>${piece.html}</a>`;
    }).join('');
    return `<p style="${escape(style(paragraph))}">${body || '<br>'}</p>`;
  }).join('');
}

function widgetHTML(base, mobile, page) {
  const w = mobile ? {...base,...base.viewport_phone_portrait} : base;
  if(w.hidden || w.type==='background') return '';
  const width = mobile ? 320 : 1024;
  let x=w.x, y=w.y;
  if (w.fixed_position==='n') x=width/2 + w.x-w.w/2;
  const geometry={left:px(x),top:px(y),width:px(w.w),height:px(w.h),zIndex:w.z || 0};
  let body='', tag='div', attrs='', classes=`widget ${w.type}`;
  if (w.fixed_position) classes+=' fixed-widget';
  const animations=(w.animation || []);
  const hover=animations.find(a=>a.type==='hover' && a.steps[0]?.use_move);
  if (hover) {
    const step=hover.steps[0];
    attrs+=` data-hover-triggers="${escape(hover.trigger.join(' '))}"`;
    Object.assign(geometry,{'--move-x':px(step.dx),'--move-y':px(step.dy),'--duration':`${step.duration}s`});
  }
  const scroll=animations.find(a=>a.type==='scroll');
  if (scroll) attrs+=` data-reveal-at="${scroll.steps[0].delay_px}"`;
  if(w.type==='text') body=textHTML(w,page);
  if(w.type==='shape') {
    geometry.backgroundColor = color(w.bg_color);
    geometry.opacity = w.bg_opacity ?? 1;
    geometry.borderRadius = px(w.radius || 0);
  }
  if(w.type==='picture') {
    const src=assets.images[w.picture.url];
    if (!src) throw new Error(`Missing image ${w._id}`);
    const sx=w.w/(w.cropW || w.originalW),sy=w.h/(w.cropH || w.originalH);
    const crop={width:px(w.originalW*sx),height:px(w.originalH*sy),left:px(-(w.cropX || 0)*sx),top:px(-(w.cropY || 0)*sy)};
    body=`<img src="${escape(src)}" alt="${escape(w.name || '')}" loading="${w.y<512?'eager':'lazy'}" decoding="async" style="${escape(style(crop))}">`;
    if(w.lightbox?.enabled) {
      tag='button'; attrs+=` type="button" data-lightbox="${escape(src)}" aria-label="Увеличить изображение"`;
    }
  }
  if(w.type==='iframe') {
    const id=w.code.match(/kinescope.io\/embed\/([^"?]+)/)[1];
    const video=assets.videos[id];
    body=`<video data-src="${video.src}" poster="${video.poster}" aria-label="${escape(video.title)}" muted loop playsinline preload="none" disablepictureinpicture></video>`;
    classes+=' video';
  }
  const clickPage=pageFor(w.clickLink || w.clickPage);
  if (clickPage) {
    tag='a';attrs+=` href="${pagePath(clickPage)}" aria-label="Открыть кейс ${escape(clickPage.title)}"`;classes+=' case-link';
    // A transparent shape still needs to be an interactive hit area.
    geometry.opacity=1;
    if (!w.bg_opacity) geometry.backgroundColor='transparent';
  }
  return `<${tag} class="${classes}" data-id="${w._id}" style="${escape(style(geometry))}"${attrs}>${body}</${tag}>`;
}

await mkdir(resolve(root,'dist'),{recursive:true});
for(const page of project.pages) {
  const widgets=await readJSON(`${page.pagePath}.json`);
  const bg=widgets.find(w=>w.type==='background')?.color || 'e4fdf9';
  const views=[false,true].map(mobile=>{
    const mode=mobile?'mobile':'desktop',width=mobile?320:1024,height=mobile?page.viewport_phone_portrait.height:page.height;
    const rendered=widgets.map(w=>({w:mobile?{...w,...w.viewport_phone_portrait}:w,html:widgetHTML(w,mobile,page)}));
    const anchors=Object.entries(sectionPositions[page._id]).map(([key,ys])=>`<span class="section-anchor" data-section="${key}" style="top:${ys[mobile?1:0]}px"></span>`).join('');
    return `<div class="layout ${mode}" data-width="${width}" data-height="${height}"><div class="canvas" style="width:${width}px;height:${height}px;background:#${bg}">${anchors}${rendered.filter(x=>!x.w.fixed_position).map(x=>x.html).join('\n')}</div><nav class="fixed-layer" aria-label="Навигация по портфолио" style="width:${width}px">${rendered.filter(x=>x.w.fixed_position).map(x=>x.html).join('\n')}</nav></div>`;
  }).join('\n');
  const title=page.seo?.title || (page.pagePath==='4'?'Архив — Рома Жигарёв':project.title);
  const description=page.seo?.description || project.description;
  const html=`<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><script src="/analytics.js" defer></script><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title><meta name="description" content="${escape(description)}"><link rel="icon" href="/assets/favicon.png"><meta property="og:title" content="${escape(title)}"><meta property="og:image" content="/assets/og-image.png"><link rel="preload" href="/assets/fonts/custom_157619.ttf" as="font" type="font/ttf" crossorigin><link rel="preload" href="/assets/fonts/custom_157620.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/styles.css"><script src="/app.js" defer></script></head>
<body style="background:#${bg}" data-page="${page.pagePath}"><main>${views}</main><dialog class="lightbox" aria-label="Просмотр изображения"><button class="lightbox-close" autofocus aria-label="Закрыть">×</button><img alt="Изображение проекта в полном размере"></dialog></body></html>`;
  const directory=resolve(root,'dist',page.pagePath==='1'?'':page.pagePath);
  await mkdir(directory,{recursive:true});await writeFile(resolve(directory,'index.html'),html);
}
await cp(resolve(root,'assets'),resolve(root,'dist/assets'),{recursive:true});
for(const file of ['app.js','analytics.js','styles.css']) await cp(resolve(root,file),resolve(root,'dist',file));
await cp(resolve(root,'CNAME'),resolve(root,'dist/CNAME'));
await writeFile(resolve(root,'dist/.nojekyll'),'');
console.log('Built 4 pages, desktop + mobile, with local images, fonts and video.');

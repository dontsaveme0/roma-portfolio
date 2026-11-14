// The source coordinates are the owner's Readymag desktop and phone layouts.
// Scaling the artboard preserves the original typography, crop and spacing.
const layouts=[...document.querySelectorAll('.layout')];
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
let activeLayout,scale=1;
function resize(){
  activeLayout=layouts.find(el=>getComputedStyle(el).display!=='none');
  scale=document.documentElement.clientWidth/Number(activeLayout.dataset.width);
  activeLayout.style.setProperty('--scale',scale);
  activeLayout.style.height=`${Number(activeLayout.dataset.height)*scale}px`;
  updateNavigation();
  document.querySelectorAll('video').forEach(video=>{
    if(!activeLayout.contains(video)) video.pause();
  });
}
function updateNavigation(){
  const y=window.scrollY/scale;
  activeLayout?.querySelectorAll('[data-reveal-at]').forEach(el=>el.classList.toggle('revealed',y>=Number(el.dataset.revealAt)));
}
window.addEventListener('resize',resize);
window.addEventListener('scroll',updateNavigation,{passive:true});
resize();

for(const layout of layouts){
  const animated=[...layout.querySelectorAll('[data-hover-triggers]')];
  const triggers=new Set(animated.flatMap(el=>el.dataset.hoverTriggers.split(' ')));
  for(const id of triggers){
    const trigger=layout.querySelector(`[data-id="${id}"]`);
    if(!trigger) continue;
    const targets=animated.filter(el=>el.dataset.hoverTriggers.split(' ').includes(id));
    const toggle=state=>targets.forEach(el=>el.classList.toggle('hovered',state));
    trigger.addEventListener('pointerenter',event=>{if(event.pointerType==='mouse')toggle(true)});
    trigger.addEventListener('pointerleave',()=>toggle(false));
    trigger.addEventListener('focus',()=>toggle(true));
    trigger.addEventListener('blur',()=>toggle(false));
  }
}

function followHash(smooth=false){
  const key=decodeURIComponent(location.hash.slice(1));
  if(!key)return;
  const anchor=[...activeLayout.querySelectorAll('[data-section]')].find(el=>el.dataset.section===key);
  const y=anchor?parseFloat(anchor.style.top):key.startsWith('at-')?Number(key.slice(3)):NaN;
  if(Number.isFinite(y))window.scrollTo({top:y*scale,behavior:smooth&&!reducedMotion.matches?'smooth':'instant'});
}
document.addEventListener('click',event=>{
  const link=event.target.closest('a');
  if(!link||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  const url=new URL(link.href,location.href);
  if(url.origin===location.origin&&url.pathname===location.pathname){
    event.preventDefault();
    if(url.hash){history.pushState(null,'',url);followHash(true)}
    else{history.pushState(null,'',url);window.scrollTo({top:0,behavior:reducedMotion.matches?'instant':'smooth'})}
  }
});
window.addEventListener('hashchange',()=>followHash(true));
window.addEventListener('popstate',()=>followHash(false));
document.fonts.ready.then(()=>followHash(false));

const observer=new IntersectionObserver(entries=>{
  for(const {target:video,isIntersecting} of entries){
    if(isIntersecting&&activeLayout.contains(video)){
      if(!video.getAttribute('src')){video.src=video.dataset.src;video.load()}
      if(!reducedMotion.matches)video.play().catch(()=>{});
    }else video.pause();
  }
},{rootMargin:'160px'});
document.querySelectorAll('video').forEach(video=>observer.observe(video));

const dialog=document.querySelector('.lightbox');
let lastFocused;
document.querySelectorAll('[data-lightbox]').forEach(button=>button.addEventListener('click',()=>{
  lastFocused=button;
  dialog.querySelector('img').src=button.dataset.lightbox;
  dialog.showModal();
  document.body.classList.add('modal-open');
}));
dialog.addEventListener('click',()=>dialog.close());
dialog.addEventListener('close',()=>{
  document.body.classList.remove('modal-open');
  lastFocused?.focus({preventScroll:true});
});

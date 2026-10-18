(function(){
var $=function(s,r){return (r||document).querySelector(s)},$$=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))};
$('#yr').textContent=new Date().getFullYear();
var nav=$('#nav'),bar=$('#bar');
function onScroll(){nav.classList.toggle('glass',scrollY>30);var show=scrollY>innerHeight*.8;bar.classList.toggle('hidden',!show);bar.classList.toggle('flex',show);bar.style.transform=show?'translateY(0)':'translateY(96px)'}
addEventListener('scroll',onScroll,{passive:true});onScroll();
$$('.card').forEach(function(c){c.addEventListener('pointermove',function(e){var r=c.getBoundingClientRect();c.style.setProperty('--x',(e.clientX-r.left)+'px');c.style.setProperty('--y',(e.clientY-r.top)+'px')})});

/* ---- app screens showcase ---- */
var tabs=$$('[role=tab]'),shots=$$('.shot'),caps=$$('.cap'),cur=0,timer=null,user=false;
function setShot(i){cur=i;var k=tabs[i].dataset.shot;
  tabs.forEach(function(t,j){t.setAttribute('aria-selected',j===i)});
  shots.forEach(function(s){s.classList.toggle('on',s.id==='p-'+k)});
  caps.forEach(function(c){c.hidden=c.dataset.cap!==k});
  if(window.gsap&&!still){var c=$('.cap:not([hidden])');if(c)gsap.fromTo(c,{y:14,opacity:0},{y:0,opacity:1,duration:.5,ease:'power2.out'})}}
var still=matchMedia('(prefers-reduced-motion:reduce)').matches;
tabs.forEach(function(t,i){t.addEventListener('click',function(){user=true;clearInterval(timer);setShot(i)});
  t.addEventListener('keydown',function(e){var n=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;if(n){var j=(i+n+tabs.length)%tabs.length;user=true;clearInterval(timer);setShot(j);tabs[j].focus()}})});
if(!still&&'IntersectionObserver' in window){
  new IntersectionObserver(function(es){es.forEach(function(en){clearInterval(timer);if(en.isIntersecting&&!user)timer=setInterval(function(){setShot((cur+1)%tabs.length)},4500)})},{threshold:.45}).observe($('#stage'))}

/* ---- FAQ: one open at a time ---- */
$$('details').forEach(function(d){d.addEventListener('toggle',function(){if(d.open)$$('details').forEach(function(o){if(o!==d)o.open=false})})});

function showAll(){document.documentElement.classList.remove('js');$$('[data-count]').forEach(function(e){e.textContent=e.dataset.count})}
if(still||!window.gsap||!window.ScrollTrigger){showAll();return}

gsap.registerPlugin(ScrollTrigger);ScrollTrigger.config({ignoreMobileResize:true});
/* 1. hero entrance */
gsap.timeline({defaults:{ease:'power3.out'}})
  .fromTo('.hero-in',{y:34,autoAlpha:0},{y:0,autoAlpha:1,duration:.9,stagger:.12},.1)
  .fromTo('#phone',{y:80,autoAlpha:0,rotate:4},{y:0,autoAlpha:1,rotate:0,duration:1.2},.3);
gsap.to('.float-a',{y:-14,duration:2.6,yoyo:true,repeat:-1,ease:'sine.inOut'});
gsap.to('.float-b',{y:14,duration:3.1,yoyo:true,repeat:-1,ease:'sine.inOut'});
/* 2. scroll-linked motion */
gsap.to('#prog',{scaleX:1,ease:'none',scrollTrigger:{start:0,end:'max',scrub:.3}});
var hero={trigger:'#top',start:'top top',end:'bottom top',scrub:true};
gsap.to('#phoneWrap',{yPercent:-9,scale:.95,ease:'none',scrollTrigger:hero});
gsap.to('.float-a',{xPercent:-25,ease:'none',scrollTrigger:hero});gsap.to('.float-b',{xPercent:25,ease:'none',scrollTrigger:hero});
gsap.utils.toArray('.glow').forEach(function(g,i){gsap.to(g,{y:i%2?-80:80,ease:'none',scrollTrigger:{trigger:g.parentElement,start:'top bottom',end:'bottom top',scrub:true}})});
/* 3. marquee speeds up while scrolling */
var mqT=gsap.to('#mq',{xPercent:-50,duration:34,ease:'none',repeat:-1});
ScrollTrigger.create({onUpdate:function(s){mqT.timeScale(Math.min(5,1+Math.abs(s.getVelocity())/350))}});
ScrollTrigger.addEventListener('scrollEnd',function(){gsap.to(mqT,{timeScale:1,duration:.9,ease:'power2.out'})});
/* 4. story headline lights up word by word */
gsap.fromTo('#story .w',{opacity:.12},{opacity:1,stagger:.12,ease:'none',scrollTrigger:{trigger:'#story',start:'top 80%',end:'bottom 42%',scrub:true}});
/* 5. reveals */
ScrollTrigger.batch('.reveal',{start:'top 90%',end:'max',once:true,onEnter:function(els){gsap.to(els,{y:0,autoAlpha:1,duration:.9,stagger:.12,ease:'power3.out',overwrite:true})}});
/* 6. how it works */
var mm=gsap.matchMedia();
mm.add('(min-width:768px) and (min-height:700px)',function(){
  var steps=gsap.utils.toArray('.step');gsap.set(steps,{autoAlpha:.22,scale:.95,y:0});
  var tl=gsap.timeline({scrollTrigger:{trigger:'#how',start:'top top',end:'+=160%',pin:true,scrub:.6,anticipatePin:1}});
  tl.to('#hline',{scaleX:1,duration:steps.length,ease:'none'},0);
  steps.forEach(function(s,i){tl.to(s,{autoAlpha:1,scale:1,y:-10,duration:.7,ease:'power2.out'},i)});tl.to({},{duration:.4})});
mm.add('(max-width:767px), (max-height:699px)',function(){
  gsap.set('.step',{autoAlpha:0,y:40});
  ScrollTrigger.batch('.step',{start:'top 92%',end:'max',once:true,onEnter:function(els){gsap.to(els,{autoAlpha:1,y:0,stagger:.15,duration:.8,ease:'power3.out'})}})});
/* 7. counters + card tilt */
$$('[data-count]').forEach(function(el){var t=+el.dataset.count,c={v:0};ScrollTrigger.create({trigger:el,start:'top 92%',end:'max',once:true,onEnter:function(){gsap.to(c,{v:t,duration:1.4,ease:'power2.out',onUpdate:function(){el.textContent=Math.round(c.v)}})}})});
if(matchMedia('(hover:hover)').matches)$$('.card').forEach(function(c){
  var rx=gsap.quickTo(c,'rotationX',{duration:.4}),ry=gsap.quickTo(c,'rotationY',{duration:.4});gsap.set(c,{transformPerspective:900});
  c.addEventListener('pointermove',function(e){var r=c.getBoundingClientRect();ry(((e.clientX-r.left)/r.width-.5)*6);rx(-((e.clientY-r.top)/r.height-.5)*6)});
  c.addEventListener('pointerleave',function(){rx(0);ry(0)})});
/* 8. recalc after fonts and images settle */
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(function(){ScrollTrigger.refresh()});
addEventListener('load',function(){ScrollTrigger.refresh()});
})();

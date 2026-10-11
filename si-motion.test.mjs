import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createSiMotion} from './dist/si-motion.mjs';
import {createState,advance as advanceState} from './dist/state.mjs';
const animations=[['Idle',2.4],['Takeoff',1.25],['Flight',2],['Hover',2.4],['Landing',1.3],['PalmBlast',.85],['Walk',1.4]].map(([name,duration])=>({name,duration}));
const capabilities={hasHeroFlight:true,hasPalmAnimation:true,hasPalmBones:true,hasGait:true,embeddedClipNames:animations.map(a=>a.name)};
const make=extra=>createSiMotion({capabilities,animations,...extra});
function advance(m,time,state={}){let r;for(let t=0;t<time-1e-8;t+=.05)r=m.step(Math.min(.05,time-t),state);return r;}
test('actual flight goes Takeoff once to Hover/Flight, Landing once then gait/idle',()=>{
 const m=make();assert.equal(m.step(.01,{flight:true}).clipName,'Takeoff');let r=advance(m,1.3,{flight:true});assert.equal(r.phase,'air');assert.equal(r.clipName,'Hover');assert.equal(m.step(.05,{flight:true,moving:true}).clipName,'Flight');assert.equal(m.step(.05,{flight:false}).clipName,'Landing');r=advance(m,1.3,{flight:false,moving:true});assert.equal(r.phase,'ground');assert.equal(r.clipName,'Walk');assert.equal(m.step(.05,{}).clipName,'Idle');
});
test('mid-phase toggles safely reset transition timer and issue a restart pulse',()=>{
 const m=make();advance(m,.4,{flight:true});let r=m.step(.02,{flight:false});assert.equal(r.clipName,'Landing');assert.equal(r.phaseElapsed,.02);assert.equal(r.restartClip,true);r=m.step(.02,{flight:true});assert.equal(r.clipName,'Takeoff');assert.equal(r.phaseElapsed,.02);assert.equal(r.restartClip,true);assert.equal(m.step(.02,{flight:true}).restartClip,false);
});
test('phase and shot one-shots remain selected for their final mixer tick',()=>{
 const m=make();let r;for(let i=0;i<25;i++)r=m.step(.05,{flight:true});assert.equal(r.phase,'takeoff');assert.equal(r.clipName,'Takeoff');assert.ok(Math.abs(r.phaseElapsed-1.25)<1e-8);assert.equal(m.step(.05,{flight:true}).clipName,'Hover');
 const s=make();s.requestShot();for(let i=0;i<17;i++)r=s.step(.05,{});assert.equal(r.clipName,'PalmBlast');assert.ok(Math.abs(r.shotElapsed-.85)<1e-8);assert.equal(s.step(.05,{}).clipName,'Idle');
});
test('takeoff stays grounded through crouch, then eases up; landing reaches ground before settling',()=>{
 const m=make();let r=advance(m,.25,{flight:true,height:0});assert.equal(r.clipName,'Takeoff');assert.equal(r.liftAlpha,0);r=m.step(.05,{flight:true});assert.ok(r.liftAlpha>0&&r.liftAlpha<.01);r=advance(m,.95,{flight:true});assert.ok(Math.abs(r.liftAlpha-1)<1e-8);r=m.step(.05,{flight:false,height:4.5});assert.ok(r.liftAlpha>0.98&&r.liftAlpha<1);r=advance(m,.90,{flight:false});assert.equal(r.phase,'landing');assert.equal(r.liftAlpha,0);assert.equal(advance(m,.4,{flight:false}).phase,'ground');
});
test('mid-air reversal preserves current height through new crouch; pause freezes lift progress',()=>{
 const m=make();let r=advance(m,.8,{flight:true}),height=r.liftAlpha*4.5;r=m.step(.05,{flight:false,height});assert.ok(r.liftAlpha*4.5<=height);height=r.liftAlpha*4.5;r=m.step(.05,{flight:true,height});assert.ok(Math.abs(r.liftAlpha*4.5-height)<1e-8);const alpha=r.liftAlpha;for(let i=0;i<50;i++)assert.equal(m.step(.05,{paused:true,flight:true}).liftAlpha,alpha);m.reset();assert.equal(m.describe().liftAlpha,0);
});
test('city state integration retains movement but overrides legacy early root lift',()=>{
 const m=make(),s=createState();s.flight=true;
 function frame(){const oldH=s.height;advanceState(s,.05,{x:1});const p=m.step(.05,{flight:s.flight,moving:s.moving,paused:s.paused,height:oldH});if(m.capabilities.heroFlight&&!s.paused)s.height=p.liftAlpha*m.timing.altitude;return p;}
 for(let i=0;i<5;i++)frame();assert.equal(s.height,0);assert.equal(s.x,2);assert.equal(m.describe().clipName,'Takeoff');
 for(let i=0;i<20;i++)frame();assert.ok(Math.abs(s.height-4.5)<1e-8);s.paused=true;const height=s.height,x=s.x,phase=m.describe().phaseElapsed;for(let i=0;i<10;i++)frame();assert.equal(s.height,height);assert.equal(s.x,x);assert.equal(m.describe().phaseElapsed,phase);
 s.paused=false;s.flight=false;for(let i=0;i<20;i++)frame();assert.equal(s.height,0);assert.equal(m.describe().clipName,'Landing');for(let i=0;i<7;i++)frame();assert.equal(m.describe().phase,'ground');
});
test('game shortcuts leave native keyboard actions on focused controls intact',()=>{
 const main=readFileSync(new URL('./dist/main.js',import.meta.url),'utf8');
 const source=main.match(/function acceptsGameplayShortcut\(target\)\{[^\n]+\}/)?.[0];assert.ok(source,'shortcut focus guard is present');
 const accepts=runInNewContext(`${source}; acceptsGameplayShortcut`);
 const selector='button,input,textarea,select,a[href],[contenteditable],[role="button"],[role="slider"],[role="switch"]';
 for(const control of ['button','select','input','textarea','a','role=button','role=slider','role=switch'])assert.equal(accepts({isContentEditable:false,closest:s=>{assert.equal(s,selector);return {control};}}),false);
 assert.equal(accepts({isContentEditable:true}),false);for(const surface of ['body','canvas'])assert.equal(accepts({tagName:surface,isContentEditable:false,closest:()=>null}),true);
 assert.match(main,/keydown',e=>\{if\(!acceptsGameplayShortcut\(e\.target\)\|\|e\.ctrlKey\|\|e\.metaKey\|\|e\.altKey\)return;/);
});
test('pointer action returns keyboard focus to the game, keyboard activation retains button focus',()=>{
 const main=readFileSync(new URL('./dist/main.js',import.meta.url),'utf8');
 const source=main.match(/function bindActionButton\(id,action\)\{[^\n]+\}/)?.[0];assert.ok(source);
 let handler,focusCalls=0,actions=0;
 const bind=runInNewContext(`${source}; bindActionButton`,{$:()=>({addEventListener:(name,callback)=>{assert.equal(name,'click');handler=callback;}}),canvas:{focus:options=>{assert.equal(options.preventScroll,true);focusCalls++;}}});
 bind('fly',()=>actions++);handler({detail:1});assert.equal(actions,1);assert.equal(focusCalls,1);handler({detail:0});assert.equal(actions,2);assert.equal(focusCalls,1);
});
test('renderer resize uses the actual root viewport, preserves CSS sizing and updates projection/composer',()=>{
 const main=readFileSync(new URL('./dist/main.js',import.meta.url),'utf8');
 const sources=[/^const viewportSize=.+$/m,/^const renderRatio=.+$/m,/function resize\(\)\{[^\n]+\}/].map(pattern=>main.match(pattern)?.[0]);
 assert.ok(sources.every(Boolean),'responsive sizing helpers are present');
 const ui={clientWidth:390,clientHeight:844},sizes=[],composerSizes=[],ratios=[],composerRatios=[];
 let ratio=1,projectionUpdates=0;
 const camera={updateProjectionMatrix:()=>projectionUpdates++};
 const context={ui,camera,innerWidth:1920,innerHeight:935,devicePixelRatio:2,high:false,
  renderer:{setPixelRatio:value=>{ratio=value;ratios.push(value);},getPixelRatio:()=>ratio,setSize:(...args)=>sizes.push(args)},
  composer:{setPixelRatio:value=>composerRatios.push(value),setSize:(...args)=>composerSizes.push(args)}};
 const resize=runInNewContext(`${sources.join('\n')}; resize`,context);
 function check(width,height,expectedFov,expectedRatio){
  ui.clientWidth=width;ui.clientHeight=height;resize();
  const w=Math.max(1,width),h=Math.max(1,height);
  assert.deepEqual(sizes.at(-1),[w,h,false]);assert.deepEqual(composerSizes.at(-1),[w,h]);
  assert.equal(camera.aspect,w/h);assert.equal(camera.fov,expectedFov);
  assert.equal(ratios.at(-1),expectedRatio);assert.equal(composerRatios.at(-1),expectedRatio);
 }
 check(390,844,60,700/844);check(844,390,46,1);
 context.high=true;check(1920,935,46,1400/1920);
 context.high=false;check(0,0,46,1);assert.equal(projectionUpdates,4);
});
test('initial viewport and root resize observation cannot reintroduce a fixed desktop canvas',()=>{
 const main=readFileSync(new URL('./dist/main.js',import.meta.url),'utf8');
 assert.match(main,/let high=ui\.clientWidth>820/);
 assert.match(main,/new ResizeObserver\(resize\)\.observe\(ui\)/);
 const calls=[...main.matchAll(/renderer\.setSize\(([^)]+)\)/g)].map(match=>match[1]);
 assert.equal(calls.length,2);assert.ok(calls.every(args=>args==='width,height,false'));
 const init=main.slice(main.indexOf('async function init()'));
 assert.match(init,/const\{width,height\}=viewportSize\(\);camera\.aspect=width\/height;camera\.fov=camera\.aspect<\.8\?60:46;camera\.updateProjectionMatrix\(\)/);
 assert.match(init,/new UnrealBloomPass\(new T\.Vector2\(width,height\)/);
 assert.ok(init.indexOf('const{width,height}=viewportSize()')<init.indexOf('renderer.setSize(width,height,false)'));
 assert.ok(init.indexOf('renderer.setSize(width,height,false)')<init.indexOf("ui.dataset.ready='true'"));
});
test('pause freezes transition, cooldown and pending cue clocks without emitting',()=>{
 const m=make();m.requestShot();const before=m.step(.1,{});for(let i=0;i<30;i++){const r=m.step(.05,{paused:true,flight:true});assert.equal(r.shotElapsed,before.shotElapsed);assert.equal(r.cooldownLeft,before.cooldownLeft);assert.equal(r.phaseElapsed,before.phaseElapsed);assert.equal(r.emitShot,false);assert.equal(r.clipName,'PalmBlast');}
});
test('one cue starts PalmBlast, emits once after wind-up and retains a stable cooldown',()=>{
 const m=make();assert.equal(m.requestShot(),true);assert.equal(m.requestShot(),false);let emitted=0;for(let i=0;i<19;i++){const r=m.step(.05,{});if(i<3)assert.equal(r.emitShot,false);if(i===3){assert.equal(r.emitShot,true);assert.equal(r.clipName,'PalmBlast');}emitted+=Number(r.emitShot);if(i<17)assert.equal(m.requestShot(),false);}assert.equal(emitted,1);assert.equal(m.requestShot(),true);assert.equal(m.step(.01,{}).restartClip,true);
});
test('cue cancellation never emits stale beams and retains cooldown',()=>{
 const m=make();m.requestShot();m.step(.05,{});assert.equal(m.cancelShot(),true);assert.equal(m.requestShot(),false);for(let i=0;i<25;i++)assert.equal(m.step(.05,{}).emitShot,false);assert.equal(m.requestShot(),true);
});
test('flight toggle cancels pending shot; transition phases reject new cues',()=>{
 const m=make();m.requestShot();assert.equal(m.step(.05,{flight:true}).clipName,'Takeoff');assert.equal(m.requestShot(),false);for(let i=0;i<26;i++)assert.equal(m.step(.05,{flight:true}).emitShot,false);assert.equal(m.requestShot(),true);assert.equal(m.step(.05,{flight:false}).clipName,'Landing');assert.equal(m.requestShot(),false);
});
test('unavailable actor resets phases and cancels cues without a substitute pose',()=>{
 const m=make();m.requestShot();let r=m.step(.05,{available:false});assert.equal(r.clipName,null);assert.equal(r.emitShot,false);assert.equal(r.phase,'unavailable');assert.equal(m.requestShot({available:false}),false);r=m.step(.05,{});assert.equal(r.clipName,'Idle');assert.equal(r.phase,'ground');assert.equal(r.pendingShot,false);
});
test('reduced motion stays on a stable idle clip, skips transitions and rejects flashes',()=>{
 const m=make({reduced:true});assert.equal(m.capabilities.heroFlight,false);assert.equal(m.requestShot(),false);for(let i=0;i<30;i++)assert.equal(m.step(.05,{flight:true,moving:true}).clipName,'Idle');assert.equal(m.step(.05,{flight:false}).clipName,'Idle');
});
test('rigid or incomplete assets only hover/translate; names alone do not assert capability',()=>{
 const m=createSiMotion({animations,capabilities:{embeddedClipNames:animations.map(a=>a.name)}});const r=m.step(.05,{flight:true,moving:true});assert.equal(r.phase,'rigid-hover');assert.equal(r.heroFlight,false);assert.equal(r.clipName,'Idle');assert.equal(m.requestShot(),false);
});
test('malformed delta cannot jump past wind-up or transition timing',()=>{
 const m=make();m.requestShot();assert.equal(m.step(Infinity,{}).shotElapsed,0);assert.equal(m.step(NaN,{}).shotElapsed,0);assert.equal(m.step(100,{}).shotElapsed,.05);assert.equal(m.step(-1,{}).emitShot,false);
});

import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {Reflector} from 'three/addons/objects/Reflector.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {loadSiGLB} from './si-glb.js';
import {createSiMotion} from './si-motion.mjs';
import {createState,advance,randomSeed} from './state.mjs';

const $=id=>document.getElementById(id),canvas=$('scene'),ui=$('world');
const rand=randomSeed(),state=createState(),keys=new Set(),touch={x:0,z:0};
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
let high=ui.clientWidth>820,pose='idle',frameCount=0,fpsStart=performance.now(),last=performance.now();
const viewportSize=()=>({width:Math.max(1,ui.clientWidth),height:Math.max(1,ui.clientHeight)});
const renderRatio=(width,height)=>Math.min(devicePixelRatio,high?1.25:1,(high?1400:900)/width,(high?950:700)/height);
let renderer,composer,bloom,mirror,hero,controls,si3d;
let motion=createSiMotion({reduced}),motionPose=motion.describe(),releasedShots=0;
const scene=new T.Scene();scene.background=new T.Color(0x07141d);scene.fog=new T.FogExp2(0x0c2430,.018);
const camera=new T.PerspectiveCamera(innerWidth/innerHeight<.8?60:46,innerWidth/innerHeight,.1,250);camera.position.set(.9,3.3,10);
const glows=[],ripples=[],beams=[];const palette=[0x59def7,0xec507e,0xffb453,0x9e77f0];
// An empty environment reservation, not an enemy/spawn/combat implementation.
export const FUTURE_COMBAT_ZONE=Object.freeze({id:'si-open-street',minX:-4.6,maxX:4.6,minZ:-36,maxZ:-9,floorY:0,clearanceY:8.7,enemySpawningEnabled:false,combatEnabled:false});
scene.userData.futureCombatZone=FUTURE_COMBAT_ZONE;
const cityMaterial=new T.MeshStandardMaterial({color:0x233d4c,metalness:.15,roughness:.69});
const darkMaterial=new T.MeshStandardMaterial({color:0x142634,metalness:.2,roughness:.7});
const metalMaterial=new T.MeshStandardMaterial({color:0x344e61,metalness:.3,roughness:.42});
const goldMaterial=new T.MeshStandardMaterial({color:0xb58a3d,metalness:.9,roughness:.25});
const lightMaterials=new Map();
const emissive=color=>{if(!lightMaterials.has(color))lightMaterials.set(color,new T.MeshStandardMaterial({color,emissive:color,emissiveIntensity:2.5,roughness:.5,toneMapped:false}));return lightMaterials.get(color);};
const windowEntries=palette.map(()=>[]),sharedBox=new T.BoxGeometry(1,1,1),staticBoxes=new Map();
function overlapsReservedStreet(x,y,z,w,h,d,angle=0){const a=FUTURE_COMBAT_ZONE,ex=(Math.abs(Math.cos(angle))*w+Math.abs(Math.sin(angle))*d)/2,ez=(Math.abs(Math.sin(angle))*w+Math.abs(Math.cos(angle))*d)/2;return y+h/2>.08&&y-h/2<a.clearanceY&&x+ex>a.minX&&x-ex<a.maxX&&z+ez>a.minZ&&z-ez<a.maxZ;}
function box(x,y,z,w,h,d,material=cityMaterial,angle=0){if(overlapsReservedStreet(x,y,z,w,h,d,angle))throw new Error('Static environment geometry would obstruct the reserved SI street.');if(!staticBoxes.has(material))staticBoxes.set(material,[]);const matrix=new T.Matrix4().compose(new T.Vector3(x,y,z),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),angle),new T.Vector3(w,h,d));staticBoxes.get(material).push(matrix);}
function batchBoxes(){for(const[material,entries]of staticBoxes){const mesh=new T.InstancedMesh(sharedBox,material,entries.length);entries.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix));mesh.computeBoundingSphere();scene.add(mesh);}}
function line(a,b,color,radius=.025){const dir=new T.Vector3().subVectors(b,a),m=new T.Mesh(new T.CylinderGeometry(radius,radius,dir.length(),5),emissive(color));m.position.copy(a).add(b).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),dir.normalize());scene.add(m);return m;}
function radialTexture(){let c=document.createElement('canvas');c.width=c.height=128;let g=c.getContext('2d'),r=g.createRadialGradient(64,64,0,64,64,64);r.addColorStop(0,'rgba(180,240,255,.8)');r.addColorStop(.25,'rgba(115,190,220,.25)');r.addColorStop(1,'rgba(70,120,145,0)');g.fillStyle=r;g.fillRect(0,0,128,128);return new T.CanvasTexture(c);}
const glowMap=radialTexture();
function glow(color,scale,x,y,z,opacity=.2){const m=new T.Sprite(new T.SpriteMaterial({map:glowMap,color,transparent:true,opacity,depthWrite:false,blending:T.AdditiveBlending}));m.position.set(x,y,z);m.scale.set(scale,scale,1);scene.add(m);return m;}
function sign(text,width,height,color,x,y,z,angle=0){
  const c=document.createElement('canvas');c.width=256;c.height=Math.round(256*height/width);const g=c.getContext('2d');
  g.fillStyle='#101c2d';g.fillRect(0,0,c.width,c.height);g.strokeStyle=new T.Color(color).getStyle();g.lineWidth=7;g.strokeRect(8,8,c.width-16,c.height-16);
  const vertical=height>width*1.8;
  g.fillStyle=new T.Color(color).getStyle();g.shadowColor=g.fillStyle;g.shadowBlur=12;g.textAlign='center';g.textBaseline='middle';g.font=`bold ${vertical?Math.min(115,c.height/(text.length+1)):Math.min(c.height*.5,220/(text.length*.65))}px Arial`;
  const chars=height>width*1.8?[...text]:[text];chars.forEach((s,i)=>g.fillText(s,128,c.height*(i+.5)/chars.length));
  const texture=new T.CanvasTexture(c);texture.colorSpace=T.SRGBColorSpace;const m=new T.Mesh(new T.PlaneGeometry(width,height),new T.MeshBasicMaterial({map:texture,color:new T.Color(1.4,1.4,1.4),side:T.DoubleSide,toneMapped:false}));
  m.position.set(x,y,z);m.rotation.y=angle;scene.add(m);box(x-Math.sin(angle)*.065,y,z-Math.cos(angle)*.065,width+.09,height+.09,.08,darkMaterial,angle);glow(color,height*.7,x,y,z,.1);return m;
}
function buildCity(){
  scene.add(new T.HemisphereLight(0x81afcc,0x253747,1.8));const fill=new T.DirectionalLight(0xbad5ee,1.75);fill.position.set(3,13,10);scene.add(fill);
  const amber=new T.PointLight(0xffbb69,75,17,2);amber.position.set(-3,5,6);scene.add(amber);
  const cyan=new T.PointLight(0x59d7ed,100,24,2);cyan.position.set(4,8,-8);scene.add(cyan);
  const pink=new T.PointLight(0xeb588e,100,23,2);pink.position.set(-5,7,-15);scene.add(pink);
  mirror=new Reflector(new T.PlaneGeometry(14.4,180),{clipBias:.005,textureWidth:512,textureHeight:512,color:0x60757d});
  mirror.rotation.x=-Math.PI/2;mirror.position.set(0,0,-35);scene.add(mirror);
  mirror.material.uniforms.uTime={value:0};
  mirror.material.fragmentShader=mirror.material.fragmentShader.replace('varying vec4 vUv;','varying vec4 vUv; uniform float uTime;');
  mirror.material.fragmentShader=mirror.material.fragmentShader.replace('vec4 base = texture2DProj( tDiffuse, vUv );',`vec4 q=vUv; vec2 p=q.xy/q.w; float n=sin(p.x*250.0+p.y*110.0+uTime*.5)*sin(p.y*370.0);q.xy+=vec2(n*.00045,sin(p.x*490.0+uTime*.4)*.0004)*q.w; vec4 base=texture2DProj(tDiffuse,q);base.rgb*=.78+.04*sin(p.x*560.0+p.y*60.0);`);
  box(0,-.2,-35,15,.2,180,darkMaterial);
  for(const side of [-1,1]){
    box(side*8.1,.12,-35,1.65,.28,180,metalMaterial);box(side*7.25,.15,-35,.12,.32,180,darkMaterial);
    for(let i=0;i<15;i++){
      const z=25-i*10.2,w=4+rand()*4,d=7.5+rand()*2.3,h=14+rand()*26,x=side*(8.95+w/2),ci=i%palette.length;
      box(x,h/2+.25,z,w,h,d);box(x,1.6,z,w+.2,3.2,d+.2,darkMaterial);
      box(x,h+.2,z,w+.5,.4,d+.4,metalMaterial);box(x,h+1.2,z,w*.7,2,d*.65,darkMaterial);
      for(let f=1;f<h/2;f++)box(x,f*2+.4,z,w+.09,.075,d+.09,metalMaterial);
      const rows=Math.floor((h-3)/1.8);
      for(let row=0;row<rows;row++)for(let col=0;col<3;col++)if(rand()>.25){
        const mat=new T.Matrix4().compose(new T.Vector3(side*(8.91),3.8+row*1.8,z-d/2+(col+.5)*d/3),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),-side*Math.PI/2),new T.Vector3(.55,1.1,1));
        windowEntries[rand()>.8?ci:0].push(mat);
      }
      for(let row=0;row<rows;row++)for(let col=0;col<3;col++)if(rand()>.5){const mat=new T.Matrix4().compose(new T.Vector3(x-w/2+(col+.5)*w/3,3.8+row*1.8,z+d/2+.025),new T.Quaternion(),new T.Vector3(.5,.9,1));windowEntries[ci].push(mat);}
      box(side*8.3,3.1,z,1.1,.3,d-1,metalMaterial);
      if(i%2===0)sign(i===2?'SI':['NEON','夜街','IN U','光','SKY'][i%5],1.35,5.6,palette[ci],side*7.6,7.2+rand()*4,z+1,-side*.5);
      if(i%3===1)sign('SI',1.8,1.4,palette[(ci+1)%4],side*8.1,2.3,z+2,-side*.85);
      // Street-level pipes, doors and drain grates create depth rather than a flat skyline.
      box(side*8.94,1.4,z+d*.25,.08,2.8,1.8,metalMaterial);
      for(let t=0;t<5;t++)box(side*7.85,.32,z-2+t*.16,.75,.04,.06,darkMaterial);
      if(i%3===0){
        const post=box(side*6.65,3.4,z,.09,6.8,.09,metalMaterial);box(side*6.2,6.8,z,.9,.09,.09,metalMaterial);box(side*5.82,6.7,z,.55,.1,.36,emissive(0xffd08c));glow(0xffc276,2,side*5.82,6.5,z,.21);
      }
    }
  }
  for(let i=0;i<windowEntries.length;i++){
    const entries=windowEntries[i],m=new T.InstancedMesh(new T.PlaneGeometry(1,1),new T.MeshBasicMaterial({color:palette[i],transparent:true,opacity:i===0?.33:.45,side:T.DoubleSide,toneMapped:false}),entries.length);
    entries.forEach((matrix,j)=>m.setMatrixAt(j,matrix));scene.add(m);
  }
  const laneMaterial=new T.MeshBasicMaterial({color:0xaf9874,transparent:true,opacity:.5});
  for(let i=0;i<18;i++){
    // Faded yellow lane dashes and cyan curb lights remain readable in the reflections.
    const z=18-i*6;box(0,.015,z,.065,.008,1.4,laneMaterial);
    for(const side of [-1,1])box(side*6.98,.23,z,.025,.03,1.4,emissive(i%2?0x55d7e9:0xff875c));
  }
  for(let i=0;i<12;i++){
    const cloud=glow(0x8db2c6,12,((i%2)*2-1)*6,.8,-8-i*8,.055);cloud.scale.y=2.4;glows.push({m:cloud,start:cloud.position.x,speed:.13+i*.011});
  }
  for(let i=0;i<45;i++){let m=new T.Mesh(new T.RingGeometry(.16,.2,24),new T.MeshBasicMaterial({color:0x98cede,transparent:true,opacity:.14,side:T.DoubleSide,depthWrite:false}));m.rotation.x=-Math.PI/2;m.position.set((rand()-.5)*12,.023,20-rand()*110);scene.add(m);ripples.push({m,phase:rand()*3});}
  sign('SUPER INU',6,1.2,0x62dfea,0,9,-51);line(new T.Vector3(-8,10,-50),new T.Vector3(8,10,-50),0x447789,.018);
  // Roadside signs face inward, remaining outside the reserved traversal/combat space.
  const nioSign=sign('Nio',2.4,1.15,0x74e7ff,-7.8,5.6,-11,.82);nioSign.name='NeonSignNio';
  const matrixSign=sign('Matrix',3.6,1.3,0x78ffa4,7.8,7.2,-23,-.75);matrixSign.name='NeonSignMatrix';
  scene.userData.environmentSigns=['Nio','Matrix'];ui.dataset.environmentSigns='Nio,Matrix';ui.dataset.futureCombatZone=FUTURE_COMBAT_ZONE.id;ui.dataset.enemySpawning='disabled';
  const far=new T.Mesh(new T.PlaneGeometry(60,60),new T.MeshBasicMaterial({color:0x0c2638}));far.position.set(0,23,-116);scene.add(far);batchBoxes();
  // Rain/mist/rings need not be rendered twice. The mirror retains actual buildings, signs and the hero.
  const originalReflection=mirror.onBeforeRender;
  mirror.onBeforeRender=function(...args){const fx=[rainLines,...ripples.map(r=>r.m),...glows.map(g=>g.m)].filter(Boolean);const flags=fx.map(m=>m.visible);fx.forEach(m=>m.visible=false);try{originalReflection.apply(this,args);}finally{fx.forEach((m,i)=>m.visible=flags[i]);}};
  scene.traverse(m=>{if(m.material?.transparent)m.material.forceSinglePass=true;});
}

let rainGeometry,rainPositions,rainSeeds,rainLines;
function buildRain(){
  const count=1400;rainPositions=new Float32Array(count*6);rainSeeds=new Float32Array(count*4);
  for(let i=0;i<count;i++){rainSeeds[i*4]=(rand()-.5)*36;rainSeeds[i*4+1]=rand()*25;rainSeeds[i*4+2]=(rand()-.5)*65;rainSeeds[i*4+3]=.35+rand()*.4;}
  rainGeometry=new T.BufferGeometry();rainGeometry.setAttribute('position',new T.BufferAttribute(rainPositions,3).setUsage(T.DynamicDrawUsage));
  rainLines=new T.LineSegments(rainGeometry,new T.LineBasicMaterial({color:0xa8d9e9,transparent:true,opacity:.2,depthWrite:false}));rainLines.frustumCulled=false;scene.add(rainLines);
}
async function buildHero(){
  // A missing or invalid asset leaves the actual city visible; it never creates a substitute SI.
  ui.dataset.modelState='loading';
  try{si3d=await loadSiGLB({url:'./assets/super-inu.glb',height:3.9,orientationY:0,clipNames:{idle:'Idle',walk:'Walk',flight:'Flight',shooting:'PalmBlast'}});}
  catch(error){
    console.warn('The SI model could not be loaded.',error);
    ui.dataset.modelState='unavailable';ui.dataset.character='none';
    ui.dataset.meshes='0';ui.dataset.triangles='0';ui.dataset.textures='0';ui.dataset.materials='0';ui.dataset.hasRig='false';ui.dataset.hasGait='false';ui.dataset.hasPalmBones='false';ui.dataset.hasHeroFlight='false';ui.dataset.hasPalmAnimation='false';
    return;
  }
  hero=si3d.root;scene.add(hero);
  motion=createSiMotion({capabilities:si3d.capabilities,animations:si3d.stats.animations,reduced});motionPose=motion.describe();
  ui.dataset.modelState='loaded';ui.dataset.character='actual-glb';
  ui.dataset.meshes=String(si3d.stats.meshes);ui.dataset.triangles=String(si3d.stats.triangles);
  ui.dataset.textures=String(si3d.stats.textures);ui.dataset.materials=String(si3d.stats.materials);
  ui.dataset.hasRig=String(si3d.capabilities.hasRig);ui.dataset.hasGait=String(si3d.capabilities.hasGait);ui.dataset.hasPalmBones=String(si3d.capabilities.hasPalmBones);
  ui.dataset.hasHeroFlight=String(Boolean(si3d.capabilities.hasHeroFlight));ui.dataset.hasPalmAnimation=String(Boolean(si3d.capabilities.hasPalmAnimation));ui.dataset.reducedMotion=String(reduced);
  ui.dataset.embeddedClips=si3d.capabilities.embeddedClipNames.join(',');
  const shadow=new T.Mesh(new T.PlaneGeometry(3.9,2.1),new T.MeshBasicMaterial({map:glowMap,color:0x000000,transparent:true,opacity:.6,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=.028;scene.add(shadow);hero.userData.shadow=shadow;
  const lights=[];if(si3d.capabilities.hasPalmBones)for(const side of [-1,1]){const ball=new T.Mesh(new T.SphereGeometry(.11,12,10),emissive(0xb5fbff));ball.visible=false;hero.add(ball);const aura=new T.Sprite(new T.SpriteMaterial({map:glowMap,color:0x53d5ff,transparent:true,opacity:.9,depthWrite:false,blending:T.AdditiveBlending}));aura.scale.set(.85,.85,1);aura.visible=false;hero.add(aura);lights.push(ball,aura);}
  hero.userData.palms=lights;const light=new T.PointLight(0x62e5ff,0,10,2);light.position.set(0,2.7,.4);hero.add(light);hero.userData.light=light;
  const foot=glow(0x60e6ff,2.4,0,.12,0,0);foot.scale.y=.5;hero.userData.foot=foot;
}

function updateCharacterControls(){
  const available=Boolean(si3d),palms=motion.capabilities.palmAnimation,heroFlight=motion.capabilities.heroFlight;
  for(const id of ['run','fly','spin','laser']){
    const enabled=available&&(id!=='laser'||palms),button=$(id);
    button.disabled=!enabled;button.style.opacity=enabled?'':'0.45';
    button.title=enabled?'':available?(reduced?'Palm animation and flashes are disabled in reduced-motion mode.':'Palm lasers require verified hand bones and the real PalmBlast animation.'):'The SI 3D model could not be loaded.';
  }
  $('joystick').style.display=available?'':'none';$('joystick').setAttribute('aria-disabled',String(!available));
  $('run').firstChild.textContent=si3d?.capabilities.hasGait?'MOVE THE CITY ':'MOVE SI ';
  $('fly').firstChild.textContent=heroFlight?'FLY ':'HOVER ';
  $('fly').title=available?(heroFlight?'Original SI takeoff, hover, directional flight and landing animations.':'Lift the actual 3D model without claiming an unavailable flight animation.'):$('fly').title;
  $('character-tech').textContent=available?(heroFlight?'3D CITY · SI HERO FLIGHT':!reduced&&si3d.capabilities.hasGait?'3D CITY · SI EMBEDDED MOVEMENT':'3D CITY · SI RIGID MOVEMENT'):'3D CITY · SI MODEL UNAVAILABLE';
  $('model-note').textContent=available?(reduced?'Reduced-motion mode: limb/cape animation and palm flashes are paused. Move, hover and orbit remain available.':heroFlight?'SI in genuine 3D. F to fly, WASD to steer, Space to charge and release palm lasers.':si3d.capabilities.hasGait?'SI model loaded with embedded movement.':'SI model loaded. Movement and hover translate the mesh; limb animation is not ready.'):'SI model unavailable. The city is ready; character actions are disabled.';
  $('movement-help').textContent=available?'W A S D MOVE · SHIFT SPEED · DRAG TO ORBIT':'DRAG TO ORBIT THE CITY';
  canvas.setAttribute('aria-label',available?`3D Super Inu city. Drag to orbit. Use WASD or arrow keys to move, F to ${heroFlight?'fly':'hover'}, and Space for palm lasers when supported.`:'3D neon city. SI model unavailable. Drag to orbit the city.');
}

function fire(){
  if(!motion.requestShot({paused:state.paused,available:Boolean(si3d)}))return;
  // Count accepted cues, not every key repeat or every hand. The controller owns cooldown.
  state.shots++;state.laserTime=.8;
}
function releasePalmLasers(){
  if(!si3d?.capabilities.hasPalmBones||!motion.capabilities.palmAnimation)return;
  let emitted=0;
  for(let handIndex=0;handIndex<2;handIndex++){
    if(beams.length>=16)break;
    const direction=new T.Vector3(Math.sin(si3d.facing.rotation.y),0,Math.cos(si3d.facing.rotation.y));
    const origin=si3d.palmPosition(handIndex);
    if(!origin)continue;
    const group=new T.Group();const core=new T.Mesh(new T.CylinderGeometry(.035,.035,3,8),new T.MeshBasicMaterial({color:0xd9ffff,toneMapped:false}));const halo=new T.Mesh(new T.CylinderGeometry(.12,.12,3,8),new T.MeshBasicMaterial({color:0x28bbff,transparent:true,opacity:.28,blending:T.AdditiveBlending,depthWrite:false,toneMapped:false}));group.add(core,halo);group.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),direction);group.position.copy(origin).addScaledVector(direction,1.5);scene.add(group);beams.push({group,direction,life:0});
    emitted++;
  }
  if(emitted)releasedShots++;
}
function cancelShotCue(){motion.cancelShot();state.laserTime=0;if(hero){hero.userData.palms.forEach(m=>m.visible=false);hero.userData.light.intensity=0;}}
function setFlight(){if(!si3d||state.paused)return;cancelShotCue();state.flight=!state.flight;$('fly').setAttribute('aria-pressed',String(state.flight));}
function setRun(){if(!si3d||state.paused)return;state.auto=!state.auto;if(state.auto){state.spin=false;$('spin').setAttribute('aria-pressed','false');}$('run').setAttribute('aria-pressed',String(state.auto));$('run').firstChild.textContent=state.auto?'STOP MOVING ':si3d.capabilities.hasGait?'MOVE THE CITY ':'MOVE SI ';}
function setSpin(){if(!si3d||state.paused)return;cancelShotCue();state.spin=!state.spin;state.auto=false;keys.clear();resetStick();$('spin').setAttribute('aria-pressed',String(state.spin));$('run').setAttribute('aria-pressed','false');$('run').firstChild.textContent=si3d.capabilities.hasGait?'MOVE THE CITY ':'MOVE SI ';}
function pause(){state.paused=!state.paused;if(state.paused)cancelShotCue();keys.clear();touch.x=touch.z=0;$('pause').textContent=state.paused?'RESUME':'PAUSE';$('pause').setAttribute('aria-pressed',String(state.paused));resetStick();}
function clampCamera(){camera.position.x=Math.max(-6.6,Math.min(6.6,camera.position.x));camera.position.y=Math.max(.8,camera.position.y);}
function resetCamera(){if(motion.describe().pendingShot)cancelShotCue();camera.position.set(state.x+.9,state.height+3.3,state.z+10);controls.target.set(state.x,state.height+1.9,state.z);controls.update();clampCamera();}
function quality(){high=!high;bloom.enabled=high;resize();$('quality').textContent=high?'HIGH QUALITY':'BALANCED';ui.dataset.quality=high?'high':'balanced';}
function resize(){const{width,height}=viewportSize();camera.aspect=width/height;camera.fov=camera.aspect<.8?60:46;camera.updateProjectionMatrix();renderer.setPixelRatio(renderRatio(width,height));renderer.setSize(width,height,false);composer.setPixelRatio(renderer.getPixelRatio());composer.setSize(width,height);}
let stickPointer=null,stickOrigin={x:0,y:0};
function resetStick(){stickPointer=null;touch.x=touch.z=0;$('stick').style.transform='translate(0,0)';}
function acceptsGameplayShortcut(target){return !target?.isContentEditable&&!target?.closest?.('button,input,textarea,select,a[href],[contenteditable],[role="button"],[role="slider"],[role="switch"]');}
function bindActionButton(id,action){$(id).addEventListener('click',e=>{action();if(e.detail>0)canvas.focus({preventScroll:true});});}
function bindControls(){
  // Switching to pointer controls releases any keyboard movement left from a focus change.
  document.addEventListener('pointerdown',()=>keys.clear());
  // Pointer actions return to the game; native keyboard activation retains button focus.
  bindActionButton('fly',setFlight);bindActionButton('run',setRun);bindActionButton('laser',fire);bindActionButton('pause',pause);bindActionButton('quality',quality);bindActionButton('camera',resetCamera);
  bindActionButton('spin',setSpin);
  addEventListener('keydown',e=>{if(!acceptsGameplayShortcut(e.target)||e.ctrlKey||e.metaKey||e.altKey)return;const k=e.key.toLowerCase();if([' ','arrowup','arrowdown','arrowleft','arrowright'].includes(k))e.preventDefault();keys.add(k);if(e.repeat)return;if(k==='f')setFlight();if(k===' ')fire();if(k==='r')resetCamera();if(k==='p')pause();});
  addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));addEventListener('blur',()=>{keys.clear();resetStick();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){keys.clear();resetStick();if(!state.paused)pause();}last=performance.now();});
  $('joystick').addEventListener('pointerdown',e=>{if(!si3d||state.paused||stickPointer!==null)return;stickPointer=e.pointerId;const b=e.currentTarget.getBoundingClientRect();stickOrigin={x:b.left+b.width/2,y:b.top+b.height/2};e.currentTarget.setPointerCapture(e.pointerId);e.preventDefault();});
  $('joystick').addEventListener('pointermove',e=>{if(e.pointerId!==stickPointer)return;let x=e.clientX-stickOrigin.x,y=e.clientY-stickOrigin.y,d=Math.hypot(x,y);if(d>32){x*=32/d;y*=32/d;}touch.x=x/32;touch.z=y/32;$('stick').style.transform=`translate(${x}px,${y}px)`;});
  for(const ev of ['pointerup','pointercancel','lostpointercapture'])$('joystick').addEventListener(ev,resetStick);
  addEventListener('resize',resize);new ResizeObserver(resize).observe(ui);
}
function tick(now){
  requestAnimationFrame(tick);const workStart=performance.now(),frameGap=now-last,dt=Math.min(frameGap/1000,.05);last=now;
  const oldX=state.x,oldZ=state.z,oldH=state.height;
  const input=si3d?{x:touch.x+(keys.has('d')||keys.has('arrowright')?1:0)-(keys.has('a')||keys.has('arrowleft')?1:0),z:touch.z+(keys.has('s')||keys.has('arrowdown')?1:0)-(keys.has('w')||keys.has('arrowup')?1:0),sprint:keys.has('shift')}:{x:0,z:0,sprint:false};
  advance(state,dt,input);
  motionPose=motion.step(dt,{flight:state.flight,moving:state.moving,paused:state.paused,available:Boolean(si3d),height:oldH});
  // Flight altitude follows the authored takeoff/landing phases, not the legacy instant lift.
  // In particular, the initial grounded crouch finishes before the external root rises.
  if(motion.capabilities.heroFlight&&!state.paused)state.height=motionPose.liftAlpha*motion.timing.altitude;
  if(!state.paused){
    const t=state.time;mirror.material.uniforms.uTime.value=t;
    const delta=new T.Vector3(state.x-oldX,state.height-oldH,state.z-oldZ);camera.position.add(delta);controls.target.add(delta);controls.update();clampCamera();
    if(si3d){
      const bob=state.flight&&!motion.capabilities.heroFlight&&!reduced?Math.sin(t*2)*.035:0;
      hero.position.set(state.x,state.height+bob,state.z);hero.userData.shadow.position.set(state.x,.025,state.z);hero.userData.shadow.material.opacity=.55/(1+state.height*.5);
      si3d.update({time:t,moving:state.moving,flight:state.flight,shooting:motionPose.shooting,clipName:motionPose.clipName,restartClip:motionPose.restartClip,heading:state.heading,spin:state.spin,reduced},dt);
      // Read actual posed bones only after the mixer has advanced through the wind-up.
      if(motionPose.emitShot)releasePalmLasers();
      pose=motionPose.shooting?'palm-laser':motionPose.phase==='takeoff'?'takeoff':motionPose.phase==='landing'?'landing':state.flight?(motion.capabilities.heroFlight?(state.moving?'flight':'hover'):'rigid-hover'):state.moving?(!reduced&&si3d.capabilities.hasGait?'embedded-movement':'rigid-movement'):'idle';
      hero.userData.palms.forEach((m,i)=>{const palm=motionPose.palmGlow?si3d.palmPosition(Math.floor(i/2)):null;m.visible=Boolean(palm);if(palm)m.position.copy(hero.worldToLocal(palm));});hero.userData.light.intensity=motionPose.palmGlow?30:0;
      const foot=hero.userData.foot;foot.position.set(state.x,Math.max(.1,state.height-.05),state.z);foot.material.opacity=state.flight?.22:0;
    }else pose='model-unavailable';
    for(let i=beams.length-1;i>=0;i--){const beam=beams[i];beam.life+=dt;beam.group.position.addScaledVector(beam.direction,dt*34);beam.group.scale.setScalar(Math.max(.2,1-beam.life*.22));if(beam.life>1.2){scene.remove(beam.group);beam.group.children.forEach(m=>{m.geometry.dispose();m.material.dispose();});beams.splice(i,1);}}
    for(let i=0;i<rainSeeds.length/4;i++){const off=i*4,idx=i*6,x=rainSeeds[off]+state.x,z=rainSeeds[off+2]+state.z,y=((rainSeeds[off+1]-t*16)%25+25)%25+state.height;rainPositions[idx]=x;rainPositions[idx+1]=y;rainPositions[idx+2]=z;rainPositions[idx+3]=x-.08;rainPositions[idx+4]=y+rainSeeds[off+3];rainPositions[idx+5]=z-.05;}
    rainGeometry.attributes.position.needsUpdate=true;rainGeometry.setDrawRange(0,high?2800:1400);rainLines.visible=!reduced;
    for(const ripple of ripples){const p=(t+ripple.phase)%2.4/2.4;ripple.m.scale.setScalar(.4+p*3.8);ripple.m.material.opacity=reduced?0:(1-p)*.13;}
    for(const cloud of glows)cloud.m.position.x=cloud.start+Math.sin(t*cloud.speed)*.9;
  }else{controls.update();clampCamera();}
  const activity=state.paused?'PAUSED':!si3d?'SI MODEL UNAVAILABLE':state.spin?'SI · 360° MESH INSPECTION':motionPose.shooting?(motionPose.pendingShot?'PALM ENERGY CHARGING':'PALM ENERGY RELEASE'):motionPose.phase==='takeoff'?'SI · TAKEOFF':motionPose.phase==='landing'?'SI · LANDING':state.flight?(motion.capabilities.heroFlight?(state.moving?'SI · HEROIC FLIGHT':'SI · AIRBORNE HOVER'):'SI · RIGID HOVER'):state.moving?(!reduced&&si3d.capabilities.hasGait?'SI · EMBEDDED MOVEMENT':'SI · RIGID MOVEMENT'):'SUPER INU · READY';
  if($('activity').textContent!==activity)$('activity').textContent=activity;
  ui.dataset.pose=pose;ui.dataset.flight=String(state.flight);ui.dataset.paused=String(state.paused);ui.dataset.auto=String(state.auto);ui.dataset.moving=String(state.moving);ui.dataset.input=`${input.x.toFixed(2)},${input.z.toFixed(2)}`;ui.dataset.shots=String(state.shots);ui.dataset.position=`${state.x.toFixed(2)},${state.height.toFixed(2)},${state.z.toFixed(2)}`;
  ui.dataset.rotation=(si3d?.facing.rotation.y??0).toFixed(3);ui.dataset.spin=String(Boolean(state.spin));ui.dataset.currentClip=si3d?.currentClip||'';
  ui.dataset.motionPhase=motionPose.phase;ui.dataset.motionElapsed=motionPose.phaseElapsed.toFixed(3);ui.dataset.liftAlpha=motionPose.liftAlpha.toFixed(3);ui.dataset.transitionStartHeight=motionPose.phaseStartHeight.toFixed(3);ui.dataset.desiredClip=motionPose.clipName||'';ui.dataset.pendingShot=String(motionPose.pendingShot);ui.dataset.shotElapsed=motionPose.shotElapsed.toFixed(3);ui.dataset.shotCue=String(motionPose.shotId);ui.dataset.shotCooldown=motionPose.cooldownLeft.toFixed(3);ui.dataset.releasedShots=String(releasedShots);ui.dataset.beams=String(beams.length);
  renderer.info.reset();composer.render();ui.dataset.drawCalls=String(renderer.info.render.calls);ui.dataset.frameWorkMs=(performance.now()-workStart).toFixed(1);ui.dataset.frameGapMs=frameGap.toFixed(1);frameCount++;if(now-fpsStart>1000){$('fps').textContent=`${Math.round(frameCount*1000/(now-fpsStart))} FPS / WEBGL`;fpsStart=now;frameCount=0;}
}
async function init(){try{
  renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});renderer.info.autoReset=false;
  const gl=renderer.getContext(),gpuInfo=gl.getExtension('WEBGL_debug_renderer_info');const software=gpuInfo?/swiftshader|llvmpipe|software/i.test(gl.getParameter(gpuInfo.UNMASKED_RENDERER_WEBGL)):false;
  if(software)high=false;ui.dataset.softwareRendering=String(software);
  const{width,height}=viewportSize();camera.aspect=width/height;camera.fov=camera.aspect<.8?60:46;camera.updateProjectionMatrix();
  renderer.setPixelRatio(renderRatio(width,height));renderer.setSize(width,height,false);renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
  const room=new RoomEnvironment(),pmrem=new T.PMREMGenerator(renderer);scene.environment=pmrem.fromScene(room,.04).texture;scene.environmentIntensity=.75;room.dispose();pmrem.dispose();
  composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));bloom=new UnrealBloomPass(new T.Vector2(width,height),.38,.55,.82);bloom.enabled=high;composer.addPass(bloom);composer.addPass(new OutputPass());
  controls=new OrbitControls(camera,canvas);controls.target.set(0,1.9,0);controls.enableDamping=true;controls.dampingFactor=.075;controls.enablePan=false;controls.minDistance=4.5;controls.maxDistance=18;controls.minPolarAngle=.28;controls.maxPolarAngle=1.5;controls.update();
  buildCity();buildRain();await buildHero();bindControls();updateCharacterControls();ui.dataset.ready='true';ui.dataset.quality=high?'high':'balanced';$('quality').textContent=high?'HIGH QUALITY':'BALANCED';$('loading').classList.add('done');$('loading').setAttribute('aria-hidden','true');setTimeout(()=>$('loading').hidden=true,750);last=performance.now();tick(last);
}catch(error){console.error(error);$('loading').hidden=true;$('failure').hidden=false;$('failure').textContent='This local 3D preview could not start. Check that WebGL is supported and start the included local server, then open http://127.0.0.1:8051/. No account or credits are required.';ui.dataset.ready='error';}}
init();

// Animation timing only. Geometry/poses must come from verified embedded SI clips.
const finiteDelta=value=>Number.isFinite(value)?Math.max(0,Math.min(value,.05)):0;
export function createSiMotion({capabilities={},animations=[],reduced=false,windup=.20,cooldown=.95,altitude=4.5}={}){
  const durations=new Map(animations.filter(a=>typeof a.name==='string'&&Number.isFinite(a.duration)&&a.duration>0).map(a=>[a.name,a.duration]));
  const names=new Set(capabilities.embeddedClipNames||durations.keys());
  const heroFlight=Boolean(capabilities.hasHeroFlight&&['Takeoff','Flight','Hover','Landing'].every(n=>names.has(n)&&durations.has(n)));
  const palmAnimation=Boolean(capabilities.hasPalmAnimation&&capabilities.hasPalmBones&&names.has('PalmBlast')&&durations.has('PalmBlast'));
  const idle=names.has('Idle')?'Idle':null,gait=capabilities.hasGait?(names.has('Run')?'Run':names.has('Walk')?'Walk':null):null;
  const windupSeconds=Number.isFinite(windup)?Math.max(.05,windup):.20;
  const shotDuration=durations.get('PalmBlast')||.85;
  const cooldownSeconds=Math.max(Number.isFinite(cooldown)?cooldown:.95,shotDuration+.06,windupSeconds+.1);
  const targetHeight=Number.isFinite(altitude)&&altitude>0?altitude:4.5;
  const ease=value=>{const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);};
  let phase='ground',elapsed=0,phaseStartHeight=0,requestedFlight=false,shot=null,cooldownLeft=0,cueId=0,restartPending=false;
  function liftHeight(){if(phase==='air')return targetHeight;if(phase==='takeoff'){const crouch=Math.min(.28,durations.get('Takeoff')*.3),progress=ease((elapsed-crouch)/(durations.get('Takeoff')-crouch));return phaseStartHeight+(targetHeight-phaseStartHeight)*progress;}if(phase==='landing'){const touchdown=durations.get('Landing')*.7;return phaseStartHeight*(1-ease(elapsed/touchdown));}return 0;}
  function enter(next,height=liftHeight()){phase=next;elapsed=0;phaseStartHeight=Number.isFinite(height)?Math.max(0,Math.min(targetHeight,height)):0;restartPending=true;}
  function reset(){phase='ground';elapsed=0;phaseStartHeight=0;requestedFlight=false;shot=null;cooldownLeft=0;restartPending=false;}
  function cancelShot(){const had=Boolean(shot);shot=null;if(had)restartPending=true;return had;}
  function canRequestShot({paused=false,available=true}={}){return Boolean(available&&!paused&&!reduced&&palmAnimation&&!shot&&cooldownLeft<=1e-8&&!['takeoff','landing','unavailable'].includes(phase));}
  function requestShot(context={}){if(!canRequestShot(context))return false;shot={id:++cueId,elapsed:0,emitted:false};cooldownLeft=cooldownSeconds;restartPending=true;return true;}
  function describe({flight=requestedFlight,moving=false}={}){
    let clipName=idle;
    if(!reduced){
      if(shot)clipName='PalmBlast';
      else if(heroFlight&&phase==='takeoff')clipName='Takeoff';
      else if(heroFlight&&phase==='landing')clipName='Landing';
      else if(heroFlight&&phase==='air')clipName=moving?'Flight':'Hover';
      else if(!flight&&moving)clipName=gait||idle;
    }
    if(phase==='unavailable')clipName=null;
    return {phase,phaseElapsed:elapsed,phaseStartHeight,liftAlpha:liftHeight()/targetHeight,clipName,heroFlight:heroFlight&&!reduced,palmAnimation:palmAnimation&&!reduced,
      pendingShot:Boolean(shot&&!shot.emitted),shotId:shot?.id||0,shotElapsed:shot?.elapsed||0,shooting:Boolean(shot),
      palmGlow:Boolean(shot&&shot.elapsed>=.12&&shot.elapsed<.46),cooldownLeft,restartClip:false,emitShot:false};
  }
  function step(delta,{flight=false,moving=false,paused=false,available=true,height}={}){
    if(!available){reset();phase='unavailable';return describe({flight:false,moving:false});}
    if(paused)return describe({flight:requestedFlight,moving});
    const dt=finiteDelta(delta);cooldownLeft=Math.max(0,cooldownLeft-dt);
    if(phase==='unavailable')enter('ground');
    if(flight!==requestedFlight){cancelShot();requestedFlight=flight;enter(reduced?(flight?'reduced-hover':'ground'):heroFlight?(flight?'takeoff':'landing'):(flight?'rigid-hover':'ground'),height);}
    if(heroFlight&&!reduced){
      if(phase==='takeoff'&&elapsed>=durations.get('Takeoff')-1e-8)enter('air');
      else if(phase==='landing'&&elapsed>=durations.get('Landing')-1e-8)enter('ground');
    }
    // Leave one-shots selected for their entire final mixer tick, then transition next frame.
    elapsed+=dt;
    let emitShot=false;
    if(shot&&shot.elapsed>=shotDuration-1e-8){shot=null;restartPending=true;}
    if(shot){shot.elapsed+=dt;if(!shot.emitted&&shot.elapsed>=windupSeconds-1e-8){shot.emitted=true;emitShot=true;}}
    const result=describe({flight,moving});result.emitShot=emitShot;result.restartClip=restartPending;restartPending=false;return result;
  }
  return {step,requestShot,canRequestShot,cancelShot,reset,describe,
    capabilities:Object.freeze({heroFlight:heroFlight&&!reduced,palmAnimation:palmAnimation&&!reduced}),
    timing:Object.freeze({windup:windupSeconds,cooldown:cooldownSeconds,shotDuration,altitude:targetHeight})};
}

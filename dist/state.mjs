export const BOUNDS = Object.freeze({minX:-5.3,maxX:5.3,minZ:-65,maxZ:20});
export function randomSeed(seed=3244){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
export function createState(){return{x:0,z:0,height:0,flight:false,auto:false,spin:false,paused:false,heading:0,moving:false,speed:0,time:0,laserTime:0,shots:0};}
export function advance(s,dt,input={}){
  if(s.paused)return s;
  dt=Math.max(0,Math.min(Number.isFinite(dt)?dt:0,.05));s.time+=dt;
  let x=Number.isFinite(input.x)?input.x:0,z=Number.isFinite(input.z)?input.z:0;
  if(s.auto&&Math.abs(x)+Math.abs(z)<.02){z=1;if(s.z>17)s.z=-58;}
  const mag=Math.hypot(x,z);if(mag>1){x/=mag;z/=mag;}
  s.moving=mag>.04;s.speed=s.moving?(s.flight?8:(input.sprint||s.auto?5.6:2.5)):0;
  s.x=Math.max(BOUNDS.minX,Math.min(BOUNDS.maxX,s.x+x*s.speed*dt));
  s.z=Math.max(BOUNDS.minZ,Math.min(BOUNDS.maxZ,s.z+z*s.speed*dt));
  if(s.moving)s.heading=Math.atan2(x,z);
  const target=s.flight?4.5:0;s.height+=(target-s.height)*(1-Math.exp(-dt*3.5));
  if(Math.abs(s.height-target)<.002)s.height=target;
  s.laserTime=Math.max(0,s.laserTime-dt);return s;
}
export function requestLaser(s){if(s.paused||s.laserTime>.42)return false;s.laserTime=.8;s.shots++;return true;}
export function atlasCell(pose){return({front:[0,1],rear:[1,1],run:[0,0],fly:[1,0]})[pose]??[0,1];}
export function poseFor(s,cameraZ){if(s.flight||s.laserTime>0)return'fly';if(cameraZ-s.z<0)return'rear';return s.moving?'run':'front';}

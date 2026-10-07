import * as THREE from 'three';
import {BREEDS, MAX_FISH, NEW_SPECIES, PALETTES, SAVE_KEY, TANK} from './config.js';
import {animTurtle, dropFood, eggs, feed, fish, fishDie, food, layEgg, spawnEcoFish, spawnFishByBreed, spawnHybridFish, spawnKoi, spawnNewFish, spawnRandomFish, tryBreed, turtle, turtleEat, turtleFindPrey, updateEggs, updateFish, updateFood, updateTurtle} from './creatures.js';
import {TINT_CLEAR, TINT_MURK, applyDayNight, plaque, updateEco} from './sim.js';
import {Eco, UI, View} from './state.js';
import {maybeOnboard, toast, updateHUD} from './ui.js';
import {$, R, _m, _o, _q, _up, _v, _yr, clamp} from './utils.js';
import {U, bokeh, bubbleSrc, bubbles, camera, composer, controls, grade, lampLight, moteGeo, moteMat, plantClusters, renderer, scene, surf, topSurf, trimPlants, updatePlants, updateRays, updateWreckBubbles} from './world.js';

// ---------- main loop
const clock=new THREE.Clock();

function tick(){
  const rdt=Math.min(clock.getDelta(),.05),dt=rdt,t=clock.elapsedTime;
  U.uTime.value=t;
  applyDayNight(0,rdt);
  UI.idleT+=rdt;
  if(UI.idleT>10&&!controls.autoRotate)controls.autoRotate=true;
  controls.update();
  // 相机在水面上方时:水面几乎透明 + 藏起"从下看的波光",避免俯视被挡
  const aboveWater=camera.position.y>TANK.water+.5;
  topSurf.material.opacity+=(((aboveWater)?.06:.18)-topSurf.material.opacity)*Math.min(1,rdt*4);
  surf.visible=!aboveWater;
  // 生态更新
  updatePlants(dt);
  updateFood(dt,t);
  updateEggs(dt,t);
  updateEco(dt);
  for(const f of fish)updateFish(f,dt,t);
  updateTurtle(dt,t);animTurtle(dt,t);
  for(const b of bubbles){b.position.y+=dt*(1.1+b.scale.x);
    b.position.x+=Math.sin(t*3+b.userData.s*2)*.005;
    if(b.position.y>TANK.water-.3){const s=bubbleSrc[b.userData.s];b.position.set(s.x+R(-.3,.3),.2,s.z+R(-.3,.3))}}
  moteMat.opacity=.28+clamp(Eco.waste,0,1)*.5; // 废物越多悬浮颗粒越明显
  const mp=moteGeo.attributes.position.array;
  for(let i=0;i<mp.length;i+=3){mp[i+1]+=dt*.05;if(mp[i+1]>17)mp[i+1]=0}
  moteGeo.attributes.position.needsUpdate=true;
  grade.uniforms.uTime.value=t;
  updateRays(t,rdt);
  updateWreckBubbles(rdt);
  grade.uniforms.uTint.value.lerpColors(TINT_MURK,TINT_CLEAR,1-U.uMurk.value).multiplyScalar(.4+.6*Eco.dayNight);
  grade.uniforms.uMurk.value=U.uMurk.value;
  bokeh.uniforms.focus.value=camera.position.distanceTo(_v.set(0,9,0));
  updateHUD(rdt);
  UI.saveT+=rdt;if(UI.saveT>5){UI.saveT=0;saveGame();} // 5秒自动存档
  if(View.fx)composer.render();else renderer.render(scene,camera);
  if(UI.firstFrame){UI.firstFrame=false;
    setTimeout(()=>{const l=$('loading');l.style.opacity=0;setTimeout(()=>l.remove(),900);
      maybeOnboard();
      setTimeout(()=>$('hint').style.opacity=0,9000);},900);}
  requestAnimationFrame(tick);
}



function saveGame(){
  try{
    const snap={v:3,waste:Eco.waste,quality:Eco.quality,oxygen:Eco.oxygen,filterOn:Eco.filterOn,dayTarget:Eco.dayTarget,
      fishes:fish.filter(f=>f.alive).map(f=>({x:f.grp.position.x,y:f.grp.position.y,z:f.grp.position.z,
        stage:f.stage,age:f.age,hunger:f.hunger,armor:f.armor,breed:f.breed,hue:f.hue,hybrid:f.hybrid,
        breedCD:Math.max(0,f.breedCD)})),
      turtle:turtle.grp?{x:turtle.grp.position.x,y:turtle.grp.position.y,z:turtle.grp.position.z,
        hunger:turtle.hunger,belly:turtle.belly}:null,
      eggs:eggs.filter(e=>e.alive).map(e=>({x:e.x,z:e.z,y:e.mesh.position.y,age:e.age,hatchIn:e.hatchIn,
        hueA:e.hueA,hueB:e.hueB,breedA:e.breedA,breedB:e.breedB})),
      plants:plantClusters.map(p=>({h:p.h,health:p.health}))};
    localStorage.setItem(SAVE_KEY,JSON.stringify(snap));
  }catch(e){}
}
function loadGame(){
  let s=null;
  try{s=JSON.parse(localStorage.getItem(SAVE_KEY));}catch(e){}
  if(!s||s.v!==3||!Array.isArray(s.fishes)||!s.fishes.length)return false;
  try{
    Eco.waste=s.waste??Eco.waste;Eco.quality=s.quality??Eco.quality;Eco.oxygen=s.oxygen??Eco.oxygen;
    Eco.filterOn=!!s.filterOn;Eco.dayTarget=s.dayTarget??1;
    if(!turtle.grp)return false;
    for(const d of s.fishes){
      if(fish.filter(f=>f.alive).length>=MAX_FISH)break; // 读档也不超上限
      const pos=new THREE.Vector3(d.x??-6,d.y??6,d.z??0);
      let f;
      if(d.breed==='hybrid'&&d.hybrid){
        const [ba,bb]=String(d.hybrid).split('+');
        f=spawnHybridFish(ba||'comet',bb||'comet',pos);
      }else{
        f=spawnFishByBreed(d.breed||'comet',d.stage==='baby'?'baby':'adult',pos);
      }
      if(f)Object.assign(f,{age:d.age??0,hunger:d.hunger??0.5,armor:d.armor??0,breedCD:d.breedCD??10});
    }
    if(s.turtle)Object.assign(turtle.grp.position,{x:s.turtle.x,y:s.turtle.y,z:s.turtle.z});
    Object.assign(turtle,{hunger:s.turtle?.hunger??0.35,belly:s.turtle?.belly??0});
    for(const e of (s.eggs||[]))layEgg(e.x,e.z,e.hueA,e.hueB,e.breedA,e.breedB);
    (s.plants||[]).forEach((sp,i)=>{if(plantClusters[i]){
      plantClusters[i].h=sp.h??1;plantClusters[i].health=sp.health??1;}});
    $('bFilter').classList.toggle('on',Eco.filterOn);
    $('bDay').classList.toggle('on',!!Eco.dayTarget);
    return true;
  }catch(e){return false;}
}
window.addEventListener('pagehide',saveGame);
document.addEventListener('visibilitychange',()=>{if(document.hidden)saveGame();});

// ---------- go
spawnEcoFish('comet',PALETTES[0],'adult');   // 开缸: 草金 / 扇尾 / 珍珠
spawnEcoFish('fantail',PALETTES[1],'adult');
spawnEcoFish('pearl',PALETTES[2],'adult');
spawnKoi();spawnKoi();                        // 2 条观赏锦鲤
spawnNewFish(NEW_SPECIES[0]);spawnNewFish(NEW_SPECIES[1]); // 小丑鱼 / 蓝吊
spawnNewFish(NEW_SPECIES[2]);spawnNewFish(NEW_SPECIES[4]); // 黄吊 / 麒麟鱼
// 读档(乌龟为同步程序化建模, 直接读)
if(loadGame())setTimeout(()=>toast('已恢复上次的鱼缸'),600);

window.__tank={camera,controls,scene,turtle,fish,food,eggs,plaque,lampLight,
  spawnHybridFish,spawnFishByBreed,spawnNewFish,spawnRandomFish,NEW_SPECIES,BREEDS,
  layEgg,fishDie,dropFood,feed,trimPlants,turtleFindPrey,turtleEat,tryBreed,
  eco:()=>({waste:Eco.waste,quality:Eco.quality,oxygen:Eco.oxygen,filterOn:Eco.filterOn,dayTarget:Eco.dayTarget})};
clearTimeout(window.__bootT);
tick();

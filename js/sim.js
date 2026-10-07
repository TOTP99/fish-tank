import * as THREE from 'three';
import {setAmbient} from './audio.js';
import {BREEDS, MAX_EGGS, MAX_FISH, TANK} from './config.js';
import {dropFood, eggs, feed, fish, layEgg, removeFish} from './creatures.js';
import {Eco, UI} from './state.js';
import {openSheet, toast, unlockAch} from './ui.js';
import {$, R, clamp, lerp, pick} from './utils.js';
import {U, camera, fillLights, hemi, interactPlant, lampGlow, lampLight, plantClusters, plantRadius, renderer, scene, sun, trimPlants} from './world.js';

// ---------- 生态主更新





function updateEco(dt){
  if(Eco.filterOn){
    Eco.waste=Math.max(0,Eco.waste-0.030*dt);
    Eco.oxygen=Math.min(1,Eco.oxygen+0.020*dt);
  }else{
    Eco.oxygen=clamp(Eco.oxygen+(Eco.dayNight>0.5?0.008:-0.004)*dt,0,1);
  }
  const n=fish.filter(f=>f.alive).length;
  if(n>6)Eco.waste=Math.min(1,Eco.waste+0.002*(n-6)*dt); // 过密加剧污染
  if(Eco.dayNight<0.5)Eco.oxygen=Math.max(0,Eco.oxygen-0.004*dt); // 夜晚耗氧
  const target=clamp(1-Eco.waste*0.9-Math.max(0,n-6)*0.03,0,1);
  Eco.quality+=(target-Eco.quality)*Math.min(1,dt*0.6);
  // 水质低于 60% 触发自动换水，持续直到水质回到 100%
  Eco.autoWaterCD=Math.max(0,Eco.autoWaterCD-dt);
  if(Eco.quality<0.6)Eco.autoWatering=true;
  if(Eco.autoWatering&&Eco.autoWaterCD<=0){
    Eco.waste*=0.3;
    Eco.oxygen=Math.min(1,Eco.oxygen+0.35);
    Eco.quality=Math.min(1,Math.max(Eco.quality+0.28,1-Eco.waste*0.9));
    Eco.autoWaterCD=1.8;
    if(Eco.quality>=0.99||Eco.waste<0.02){
      Eco.waste=0;Eco.quality=1;Eco.oxygen=Math.min(1,Eco.oxygen+0.15);
      Eco.autoWatering=false;
      toast('自动换水完成 水质已满');
    }else{
      toast('自动换水中…');
    }
  }
  // 饿死预警自动投喂: 有鱼 hunger<0.12 即投食到最饿的鱼附近(8秒冷却)
  Eco.autoFeedCD=Math.max(0,Eco.autoFeedCD-dt);
  if(Eco.autoFeedCD<=0){
    let hungriest=null;
    for(const f of fish)if(f.alive&&f.hunger<0.12&&(!hungriest||f.hunger<hungriest.hunger))hungriest=f;
    if(hungriest){
      Eco.autoFeedCD=8;
      const hp=hungriest.grp.position;
      dropFood(clamp(hp.x,-15,5),clamp(hp.z,-7,7),3,'fish');
      toast('有鱼快饿死了，已自动投喂');
    }
  }
  for(let i=fish.length-1;i>=0;i--)if(!fish[i].alive)removeFish(fish[i]); // 清理死鱼
  // 自动补鱼籽: 存活<8条时每40秒在水草边下2-4粒随机品种的籽(上限36)
  Eco.autoFishCD=Math.max(0,Eco.autoFishCD-dt);
  const aliveN=fish.filter(f=>f.alive).length;
  if(aliveN<8&&aliveN<MAX_FISH&&Eco.autoFishCD<=0&&eggs.length<MAX_EGGS){
    Eco.autoFishCD=40;
    const sp=pick(['comet','fantail','pearl','koi','clown','bluetang','yellowtang','royalgramma','mandarin','moorish','shark','angelfish','guppy','neon']);
    const n=2+(Math.random()*3|0);
    for(let i=0;i<n;i++){
      const px=R(-14,2),pz=R(-6,6);
      layEgg(px,pz,null,null,sp,sp);
    }
    toast('自动补鱼籽：'+(BREEDS[sp]?BREEDS[sp].label:'鱼')+'的籽');
  }
  // 自动修水草: 平均高度超过基准85%时自动修剪
  Eco.autoTrimCD=Math.max(0,Eco.autoTrimCD-dt);
  if(Eco.autoTrimCD<=0&&plantClusters.length){
    let sum=0;for(const p of plantClusters)sum+=p.h/p.baseH;
    if(sum/plantClusters.length>0.85){Eco.autoTrimCD=30;trimPlants(true);}
  }
  // 成就: 数量 / 水质
  if(aliveN>=20)unlockAch('school20');
  if(aliveN>=MAX_FISH)unlockAch('full36');
  if(Eco.quality>0.999)unlockAch('eco100');
}
// TP 铜牌商标(纯装饰)
const plaque=(()=>{
  const c=document.createElement('canvas');c.width=320;c.height=96;
  const x=c.getContext('2d');
  const gr=x.createLinearGradient(0,0,0,96);
  gr.addColorStop(0,'#7a3f16');gr.addColorStop(.5,'#d99a5c');gr.addColorStop(1,'#8a4b1f');
  x.fillStyle=gr;x.fillRect(0,0,320,96);
  x.strokeStyle='rgba(50,25,5,.9)';x.lineWidth=6;x.strokeRect(4,4,312,88);
  x.fillStyle='#2a1505';x.font='700 46px Georgia,serif';
  x.textAlign='center';x.textBaseline='middle';x.fillText('TP制作',160,52);
  const m=new THREE.Mesh(new THREE.BoxGeometry(4.4,1.7,.2),
    new THREE.MeshStandardMaterial({map:new THREE.CanvasTexture(c),
      metalness:.65,roughness:.35,emissive:0x2a1205,emissiveIntensity:.5}));
  m.position.set(0,-3.2,(TANK.d+2.4)/2+.12);
  scene.add(m);return m;
})();
// 手势: 点按喂食 · 长按开管家 · 拖动旋转 · 双指缩放 · 10秒闲置自动环绕
const ray=new THREE.Raycaster(),ndc=new THREE.Vector2();

const TAP_LIM=8,LP_LIM=14,LP_MS=550;
renderer.domElement.addEventListener('pointerdown',e=>{
  UI.idleT=0;UI.lpFired=false;setAmbient(true);
  UI.pdown={x:e.clientX,y:e.clientY,t:performance.now()};
  $('dash').classList.remove('open');
  try{renderer.domElement.setPointerCapture(e.pointerId);}catch(_){}
  clearTimeout(UI.lpTimer);
  UI.lpTimer=setTimeout(()=>{UI.lpFired=true;openSheet();},LP_MS);
});
renderer.domElement.addEventListener('pointermove',e=>{
  if(!UI.pdown||UI.lpFired)return;
  if(Math.hypot(e.clientX-UI.pdown.x,e.clientY-UI.pdown.y)>LP_LIM)clearTimeout(UI.lpTimer);
});
const endPointer=e=>{
  if(!UI.pdown)return;
  clearTimeout(UI.lpTimer);
  const wasLp=UI.lpFired;
  const moved=Math.hypot(e.clientX-UI.pdown.x,e.clientY-UI.pdown.y);
  const dtMs=performance.now()-UI.pdown.t;
  UI.pdown=null;UI.lpFired=false;
  if(wasLp)return;
  if(moved<TAP_LIM&&dtMs<600){
    ndc.set(e.clientX/innerWidth*2-1,-(e.clientY/innerHeight)*2+1);
    ray.setFromCamera(ndc,camera);
    // 优先点中水草 → 互动(修剪/照料/拨动)
    let hitPlant=null,hitD=1e9;
    for(const pl of plantClusters){
      if(!pl.grp.visible)continue;
      // 粗测: 射线到水草柱的水平距离
      const ox=ray.ray.origin,dir=ray.ray.direction;
      // 在 y=2~h*6 段找最近点
      for(let s=0;s<8;s++){
        const yy=1+s*1.2;
        const tt=(yy-ox.y)/dir.y;
        if(tt<0)continue;
        const px=ox.x+dir.x*tt,pz=ox.z+dir.z*tt;
        const d=Math.hypot(px-pl.x,pz-pl.z);
        const rad=plantRadius(pl)*0.85;
        if(d<rad&&d<hitD){hitD=d;hitPlant=pl;}
      }
    }
    if(hitPlant){interactPlant(hitPlant);return;}
    const t=(TANK.water-4-ray.ray.origin.y)/ray.ray.direction.y;
    if(t>0){const p=ray.ray.at(t,new THREE.Vector3());
      feed(clamp(p.x,-15,5),clamp(p.z,-7,7));}
  }
};
renderer.domElement.addEventListener('pointerup',endPointer);
renderer.domElement.addEventListener('pointercancel',()=>{UI.pdown=null;UI.lpFired=false;clearTimeout(UI.lpTimer);});

// ---------- day / night
const dayCfg={sun:3.4,sunCol:new THREE.Color(0xfff2dd),hemi:.9,bg:new THREE.Color(0x1a5a74),
  fog:.015,caus:1,lamp:30,exposure:1.2};
const nightCfg={sun:.22,sunCol:new THREE.Color(0x8fb4dd),hemi:.22,bg:new THREE.Color(0x020d16),
  fog:.024,caus:.12,lamp:110,exposure:.95};
const FOG_CLEAR=new THREE.Color(0x0d3a4d),FOG_MURK=new THREE.Color(0x2e3a1e);
const TINT_CLEAR=new THREE.Color(0x9fc8dd),TINT_MURK=new THREE.Color(0xa8b06a);

function applyDayNight(k,dt){
  Eco.dayNight+=(Eco.dayTarget-Eco.dayNight)*Math.min(1,dt*1.5);
  const d=Eco.dayNight;
  sun.intensity=lerp(nightCfg.sun,dayCfg.sun,d);
  sun.color.lerpColors(nightCfg.sunCol,dayCfg.sunCol,d);
  hemi.intensity=lerp(nightCfg.hemi,dayCfg.hemi,d);
  scene.fog.density=lerp(nightCfg.fog,dayCfg.fog,d);
  U.uCaus.value=lerp(nightCfg.caus,dayCfg.caus,d);
  lampLight.intensity=lerp(nightCfg.lamp,dayCfg.lamp,d);
  lampGlow.material.opacity=lerp(.95,.45,d);
  renderer.toneMappingExposure=lerp(nightCfg.exposure,dayCfg.exposure,d);
  // 补光：白天较亮，夜晚压暗但仍有一点环境照
  const fillI=lerp(0.35,1.5,d);
  for(const pl of fillLights)pl.intensity=fillI;
  // 水质浑浊: 废物越高雾越浓越绿
  const murk=clamp(Eco.waste*1.2,0,1);
  scene.fog.color.lerpColors(FOG_CLEAR,FOG_MURK,murk);
  scene.fog.density=lerp(nightCfg.fog,dayCfg.fog,d)*(1+murk*0.9);
  U.uMurk.value=murk;
}

export {TINT_CLEAR, TINT_MURK, applyDayNight, plaque, updateEco};

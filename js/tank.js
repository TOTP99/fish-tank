import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';

// 乌龟与锦鲤均为程序化建模(自有代码), 无外部模型文件

const R=(a,b)=>a+Math.random()*(b-a), RI=(a,b)=>Math.floor(R(a,b+1)), pick=a=>a[Math.floor(Math.random()*a.length)], chance=p=>Math.random()<p;
const $=id=>document.getElementById(id);
const clamp=THREE.MathUtils.clamp, lerp=THREE.MathUtils.lerp;
// 轻音效(WebAudio 合成, 首次交互后可用)
// ================= 接口层: 跨域可变状态的唯一归属 =================
// 未来拆模块时每个对象整体搬入对应文件, 跨域只读/写这里, 不再满天飞全局 let。
//   Eco→sim.js  Sfx→audio.js  View→world.js  Stats/UI→ui.js  Creatures→creatures.js
const Eco   = { waste:0.22, quality:0.9, oxygen:0.85, filterOn:true,   // 生态数值
                dayNight:1, dayTarget:1,                                // 昼夜
                autoWaterCD:0, autoFeedCD:0, autoFishCD:0, autoTrimCD:0, // 自动任务冷却
                autoWatering:false };                                   // 自动换水进行中
const Sfx   = { on:true, ac:null, ambNodes:null };                     // 音频
const View  = { fx:true, hdOn:true, wreckBubbleT:0 };                   // 渲染开关 + 沉船气泡计时
const Stats = { achGot:{}, statClean:0, statWater:0 };                  // 成就统计
const UI    = { idleT:0, toastTimer:null, toastQ:[], hudT:0,            // 界面瞬态
                cfOk:null, obStep:0, saveT:0, firstFrame:true,
                pdown:null, lpTimer:null, lpFired:false };              // 手势
const Creatures = { genomeId:0 };                                      // 生物(鱼基因编号)
function blip(freq=480,dur=0.14,vol=0.08,type='sine'){
  if(!Sfx.on)return;
  try{
    if(!Sfx.ac)Sfx.ac=new (window.AudioContext||window.webkitAudioContext)();
    if(Sfx.ac.state==='suspended')Sfx.ac.resume();
    const t0=Sfx.ac.currentTime,o=Sfx.ac.createOscillator(),g=Sfx.ac.createGain();
    o.type=type;o.frequency.setValueAtTime(freq,t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(40,freq*0.6),t0+dur);
    g.gain.setValueAtTime(0.001,t0);
    g.gain.exponentialRampToValueAtTime(vol,t0+0.012);
    g.gain.exponentialRampToValueAtTime(0.001,t0+dur);
    o.connect(g).connect(Sfx.ac.destination);o.start(t0);o.stop(t0+dur+0.02);
  }catch(_){}
}

/* ================= 生态状态(与 2D 版同规则) =================
   废物: 鱼代谢+残饵+尸体 → 上升; 水草+过滤+换水 → 下降
   水质: 由废物和密度推导, 平滑跟随
   氧气: 白天水草产氧, 过滤增氧, 鱼呼吸消耗 */

const MAX_FISH=36, MAX_EGGS=8;
// ---------- 成就 ----------
const ACHS=[
  {id:'first_hatch',icon:'🐣',name:'初生',desc:'孵化第一条小鱼'},
  {id:'hybrid',icon:'🧬',name:'混血儿',desc:'孵化第一条混种鱼'},
  {id:'school20',icon:'🐟',name:'人丁兴旺',desc:'鱼群达到20条'},
  {id:'full36',icon:'🌊',name:'鱼满为患',desc:'鱼群达到36条上限'},
  {id:'bask',icon:'☀️',name:'龟仙人',desc:'乌龟完成一次晒背'},
  {id:'cleaner10',icon:'🧹',name:'清道夫',desc:'乌龟清理10次残渣'},
  {id:'water10',icon:'💧',name:'换水工',desc:'手动换水10次'},
  {id:'eco100',icon:'🏆',name:'生态大师',desc:'水质达到100%'},
];
const ACH_KEY='fishtank-ach-v1';

try{const a=JSON.parse(localStorage.getItem(ACH_KEY)||'{}');
  Stats.achGot=a.got||{};Stats.statClean=a.clean||0;Stats.statWater=a.water||0;}catch(e){}
function saveAch(){
  try{localStorage.setItem(ACH_KEY,JSON.stringify({got:Stats.achGot,clean:Stats.statClean,water:Stats.statWater}));}catch(e){}
}
function unlockAch(id){
  if(Stats.achGot[id])return;Stats.achGot[id]=1;saveAch();
  const a=ACHS.find(x=>x.id===id);
  toast('🏆 成就达成:'+a.icon+a.name);blip(880,0.25,0.1);
}
// 水下环境音(过滤噪声, 随音效开关)

function setAmbient(on){
  if(on&&Sfx.on){
    if(Sfx.ambNodes||!window.AudioContext&&!window.webkitAudioContext)return;
    try{
      if(!Sfx.ac)Sfx.ac=new (window.AudioContext||window.webkitAudioContext)();
      if(Sfx.ac.state==='suspended')Sfx.ac.resume();
      const len=Sfx.ac.sampleRate*2,buf=Sfx.ac.createBuffer(1,len,Sfx.ac.sampleRate);
      const d=buf.getChannelData(0);let last=0;
      for(let i=0;i<len;i++){const w=Math.random()*2-1;last=(last+0.02*w)/1.02;d[i]=last*3.2;}
      const src=Sfx.ac.createBufferSource();src.buffer=buf;src.loop=true;
      const lp=Sfx.ac.createBiquadFilter();lp.type='lowpass';lp.frequency.value=300;
      const g=Sfx.ac.createGain();g.gain.value=0;
      src.connect(lp);lp.connect(g);g.connect(Sfx.ac.destination);src.start();
      g.gain.linearRampToValueAtTime(0.045,Sfx.ac.currentTime+2.5);
      Sfx.ambNodes={src,g};
    }catch(_){Sfx.ambNodes=null;}
  }else if(Sfx.ambNodes){
    try{
      const {src,g}=Sfx.ambNodes;Sfx.ambNodes=null;
      g.gain.linearRampToValueAtTime(0.0001,Sfx.ac.currentTime+0.8);
      setTimeout(()=>{try{src.stop();}catch(_){}},1000);
    }catch(_){}
  }
}

// 8 套体色基因
const PALETTES=[
  {light:'#ffb84d',dark:'#ff7a2e'},
  {light:'#ffcf6b',dark:'#ff9a3d',patch:'rgba(255,255,255,.55)'},
  {light:'#ff9d6b',dark:'#e85a2e'},
  {light:'#ff6b9d',dark:'#e02060',patch:'rgba(255,255,255,.4)'},
  {light:'#7ec8ff',dark:'#2a6fc0'},
  {light:'#ffe566',dark:'#e0a020',patch:'rgba(40,30,20,.35)'},
  {light:'#ff8c42',dark:'#c04010',patch:'rgba(255,220,100,.45)'},
  {light:'#e0b0ff',dark:'#8a40c0'},
];
// 品种表(11 纯种 + 混种)
const BREEDS={
  comet:  {label:'草金', body:'torpedo', tail:'fork',  len:[1.3,1.9], speed:[1.05,1.3],  cruise:1.0},
  fantail:{label:'扇尾', body:'deep',    tail:'veil',  len:[1.1,1.5], speed:[0.7,0.9],   cruise:0.78},
  pearl:  {label:'珍珠', body:'round',   tail:'round', len:[0.9,1.25],speed:[0.5,0.68],  cruise:0.58},
  koi:    {label:'锦鲤'},
  clown:  {label:'小丑鱼'},
  bluetang:{label:'蓝吊'},
  yellowtang:{label:'黄吊'},
  royalgramma:{label:'火焰魔'},
  mandarin:{label:'麒麟鱼'},
  moorish:{label:'摩尔神像'},
  shark:  {label:'小鲨鱼'},
  angelfish:{label:'神仙鱼'},
  guppy:  {label:'孔雀鱼'},
  neon:   {label:'红绿灯'},
};
function mixHex(h1,h2,bias){
  const p=parseInt(h1.slice(1),16),q=parseInt(h2.slice(1),16);
  const u=bias!=null?bias:R(0.35,0.65);
  const r=((p>>16)&255)*(1-u)+((q>>16)&255)*u,
        g=((p>>8)&255)*(1-u)+((q>>8)&255)*u,
        b=(p&255)*(1-u)+(q&255)*u;
  return '#'+(((r|0)<<16)|((g|0)<<8)|(b|0)).toString(16).padStart(6,'0');
}
function mixHue(a,b){ // 颜色遗传
  const hue={light:mixHex(a.light,b.light),dark:mixHex(a.dark,b.dark)};
  if(a.patch||b.patch||chance(.35)){
    hue.patch=pick(['rgba(255,255,255,.55)','rgba(40,30,20,.4)','rgba(220,60,40,.35)','rgba(255,200,80,.4)']);
  }
  if(chance(.12)){const m=pick(PALETTES.slice(3));
    hue.light=mixHex(hue.light,m.light,.55);hue.dark=mixHex(hue.dark,m.dark,.55);}
  return hue;
}

// 鱼缸尺寸(世界单位)
const TANK={w:36,d:18,h:20.5,water:17};
const ISLAND={cx:12.5,cz:0,r:5,top:18.9};          // 晒背岛
// 乌龟上岸路线:沿石阶而上(每点都高于下方石头顶部,防穿模)
const RAMP_PTS=[
  new THREE.Vector3(4.6,2.2,0.3),new THREE.Vector3(6.0,4.6,0.1),
  new THREE.Vector3(7.2,7.4,-0.2),new THREE.Vector3(8.4,10.6,0.2),
  new THREE.Vector3(9.6,13.6,-0.2),new THREE.Vector3(10.8,16.0,0.1),
  new THREE.Vector3(12.1,ISLAND.top+0.35,0)];
const RAMP_CURVE=new THREE.CatmullRomCurve3(RAMP_PTS);
const RAMP_A=RAMP_PTS[0].clone();                    // 乌龟上岸起点
const RAMP_B=RAMP_PTS[RAMP_PTS.length-1].clone();    // 晒背点

// ---------- 渲染器 / 相机 / 控制器
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.setSize(innerWidth,innerHeight);
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.2;
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(50,innerWidth/innerHeight,.1,300);
camera.position.set(3,11.5,37);
const controls=new OrbitControls(camera,renderer.domElement);
controls.target.set(0,8.5,0);
controls.enableDamping=true;controls.dampingFactor=.06;
controls.minDistance=16;controls.maxDistance=75;
controls.maxPolarAngle=1.45;controls.minPolarAngle=.12;
controls.enablePan=false;
controls.autoRotate=true;controls.autoRotateSpeed=.45;

controls.addEventListener('start',()=>{controls.autoRotate=false;UI.idleT=0;});
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);composer.setSize(innerWidth,innerHeight)});

// ---------- 后期特效链: 渲染→泛光→调色(景深已删, 手机省性能)
const composer=new EffectComposer(renderer);
composer.addPass(new RenderPass(scene,camera));
const bloom=new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),.32,.55,.85);
composer.addPass(bloom);
// film grade: vignette + subtle chromatic fringe + animated grain + cool tint
const grade=new ShaderPass({uniforms:{tDiffuse:{value:null},uTime:{value:0},uTint:{value:new THREE.Color(1,1,1)},uMurk:{value:0}},
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader:`uniform sampler2D tDiffuse;uniform float uTime;uniform vec3 uTint;uniform float uMurk;varying vec2 vUv;
  float g_hash(vec2 p){p=fract(p*vec2(234.34,435.345));p+=dot(p,p+34.23);return fract(p.x*p.y);}
  void main(){
    vec2 d=vUv-.5;float r2=dot(d,d);
    vec2 bend=d*r2*.014; // chromatic fringe grows toward corners
    vec3 col;
    col.r=texture2D(tDiffuse,vUv+bend).r;
    col.g=texture2D(tDiffuse,vUv).g;
    col.b=texture2D(tDiffuse,vUv-bend).b;
    // gentle underwater grade: slight teal shadows, warm highlights
    float lum=dot(col,vec3(.299,.587,.114));
    vec3 shadowTint=vec3(.88,.97,1.01);
    vec3 hiTint=vec3(1.03,1.0,.96);
    col=mix(col*shadowTint,col*hiTint,smoothstep(.12,.75,lum));
    col=mix(col,col*uTint,.28); // cool tint wash
    col=mix(col,col*vec3(.82,.95,.62),uMurk*.45); // 水质浑浊泛绿
    col*=1.-r2*1.15; // vignette
    float gr=g_hash(vUv*913.7+fract(uTime)*37.)-.5;
    col+=gr*.028; // animated grain
    gl_FragColor=vec4(max(col,vec3(0.)),1.);
  }`});
composer.addPass(grade);
composer.addPass(new OutputPass());


// ---------- shared uniforms
const U={uTime:{value:0},uCaus:{value:1},uMurk:{value:0}};
// caustic web: layered voronoi-ish cells, two scales
const causticGLSL=`
float vhash(vec2 p){return fract(sin(dot(p,vec2(41.3,289.1)))*43758.55);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(vhash(i),vhash(i+vec2(1,0)),f.x),mix(vhash(i+vec2(0,1)),vhash(i+vec2(1,1)),f.x),f.y);}
float caustic(vec2 p){
  float t=uTime*.6;
  float a=vnoise(p*1.1+vec2(t*.7,-t*.4));
  float b=vnoise(p*2.3-vec2(t*.5,t*.8)+4.7);
  float w=pow(clamp(1.-abs(a-b)*3.2,0.,1.),5.);
  return w*1.6;}`;

// ---------- 灯光: 天空光 + 太阳 + 5 盏补光
const hemi=new THREE.HemisphereLight(0x9fd8ff,0x1c2a20,.9);
scene.add(hemi);
const sun=new THREE.DirectionalLight(0xfff2dd,3.4);
sun.position.set(6,30,10);
sun.castShadow=true;
sun.shadow.camera.left=-26;sun.shadow.camera.right=26;
sun.shadow.camera.top=26;sun.shadow.camera.bottom=-26;
sun.shadow.mapSize.set(2048,2048);
sun.shadow.bias=-.0004;
scene.add(sun);
// five warm fills ringing the tank so no side goes muddy
const fillLights=[];
for(const [fx,fy,fz] of [[-12,22,-6],[8,22,-6],[-12,22,6],[8,22,6],[-2,24,0]]){
  const pl=new THREE.PointLight(0xfff0e0,1.5,42,1.5);
  pl.position.set(fx,fy,fz);
  scene.add(pl);
  fillLights.push(pl);
}

// ---------- background: deep-water vertical gradient + exp fog
{
  const c=document.createElement('canvas');c.width=2;c.height=256;
  const g=c.getContext('2d');
  const gr=g.createLinearGradient(0,0,0,256);
  gr.addColorStop(0,'#1b5c76');gr.addColorStop(.55,'#0e3b4e');gr.addColorStop(1,'#051922');
  g.fillStyle=gr;g.fillRect(0,0,2,256);
  const bgTex=new THREE.CanvasTexture(c);bgTex.colorSpace=THREE.SRGBColorSpace;
  scene.background=bgTex;
}
scene.fog=new THREE.FogExp2(0x0d3a4d,.015);

// ---------- sand bed: displaced plane + speckle texture
const sandGeo=new THREE.PlaneGeometry(37,19,110,60);
sandGeo.rotateX(-Math.PI/2);
{
  const p=sandGeo.attributes.position,seed=R(0,100);
  for(let i=0;i<p.count;i++){
    const X=p.getX(i),Z=p.getZ(i);
    const dune=Math.sin(X*.32+seed)*.28+Math.cos(Z*.41+X*.13+seed*1.7)*.3;
    const ripple=Math.sin(X*2.3+Z*1.9+seed)*.05;
    p.setY(i,dune+ripple);
  }
  p.needsUpdate=true;sandGeo.computeVertexNormals();
}
const sandTex=(()=>{
  const c=document.createElement('canvas');c.width=c.height=512;
  const g=c.getContext('2d');
  g.fillStyle='#cdb180';g.fillRect(0,0,512,512);
  for(let i=0;i<24000;i++){
    const v=150+Math.random()*72|0;
    g.fillStyle=`rgb(${v},${v*.85|0},${v*.62|0})`;
    g.fillRect(Math.random()*512,Math.random()*512,1.7,1.7);
  }
  const t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(9,6);
  t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;
  return t;
})();
const sand=new THREE.Mesh(sandGeo,new THREE.MeshStandardMaterial({map:sandTex,roughness:1}));
sand.receiveShadow=true;scene.add(sand);
// animated caustic light-web floating just above the sand
const causMesh=new THREE.Mesh(sandGeo,new THREE.ShaderMaterial({uniforms:U,
  transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
  polygonOffset:true,polygonOffsetFactor:-2,
  vertexShader:`varying vec3 vW;
    void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;
      gl_Position=projectionMatrix*viewMatrix*w;}`,
  fragmentShader:`uniform float uTime;uniform float uCaus;varying vec3 vW;
    ${causticGLSL}
    void main(){
      float fade=1.-clamp(length(vW.xz)/26.,0.,1.);
      vec3 tint=vec3(.92,1.,.86);
      gl_FragColor=vec4(tint*caustic(vW.xz)*.45*uCaus*fade,1.);
    }`}));
scene.add(causMesh);
// water surface seen from below: bright rippling web
const surf=new THREE.Mesh(new THREE.PlaneGeometry(46,28,1,1).rotateX(Math.PI/2),
  new THREE.ShaderMaterial({uniforms:U,transparent:true,depthWrite:false,
    blending:THREE.AdditiveBlending,side:THREE.DoubleSide,
    vertexShader:`varying vec3 vW;
      void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;
        gl_Position=projectionMatrix*viewMatrix*w;}`,
    fragmentShader:`uniform float uTime;uniform float uCaus;varying vec3 vW;
      ${causticGLSL}
      void main(){
        float fade=1.-clamp(length(vW.xz)/34.,0.,1.);
        float web=caustic(vW.xz*.32+vec2(uTime*.06,0.));
        gl_FragColor=vec4(vec3(.82,.95,1.)*(.07+web*.28)*uCaus*fade,1.);
      }`}));
surf.position.y=TANK.water;scene.add(surf);
// thin top skin: gentle waves, nearly invisible from above so it never blocks the view
const topSurf=new THREE.Mesh(new THREE.PlaneGeometry(TANK.w,TANK.d,48,24),
  new THREE.MeshPhongMaterial({color:0x2e7d9e,transparent:true,opacity:.18,
    shininess:60,specular:0x335566,depthWrite:false}));
topSurf.rotation.x=-Math.PI/2;topSurf.position.y=TANK.water+.02;
topSurf.material.onBeforeCompile=s=>{
  s.uniforms.uTime=U.uTime;
  s.vertexShader='uniform float uTime;\n'+s.vertexShader.replace('#include <begin_vertex>',
    `vec3 transformed=position;
     transformed.z+=sin(position.x*.8+uTime*1.3)*.09+cos(position.y*.6+uTime*.9)*.09;`);
};
scene.add(topSurf);
// ---------- 水下光柱 (god rays): 柔光带自水面斜射入水, 缓慢摇曳
const rayTex=(()=>{
  const c=document.createElement('canvas');c.width=64;c.height=256;
  const g=c.getContext('2d');
  const gr=g.createLinearGradient(0,0,0,256);
  gr.addColorStop(0,'rgba(180,220,235,.55)');gr.addColorStop(.7,'rgba(150,200,220,.12)');
  gr.addColorStop(1,'rgba(150,200,220,0)');
  g.fillStyle=gr;g.fillRect(0,0,64,256);
  // 横向柔边
  const gx=g.createLinearGradient(0,0,64,0);
  gx.addColorStop(0,'rgba(0,0,0,1)');gx.addColorStop(.25,'rgba(0,0,0,0)');
  gx.addColorStop(.75,'rgba(0,0,0,0)');gx.addColorStop(1,'rgba(0,0,0,1)');
  g.globalCompositeOperation='destination-out';g.fillStyle=gx;g.fillRect(0,0,64,256);
  const t=new THREE.CanvasTexture(c);return t;
})();
const rays=[];
{
  const rayMat=new THREE.MeshBasicMaterial({map:rayTex,transparent:true,depthWrite:false,
    blending:THREE.AdditiveBlending,side:THREE.DoubleSide,opacity:.5});
  for(let i=0;i<6;i++){
    const w=R(2.5,5);
    const m=new THREE.Mesh(new THREE.PlaneGeometry(w,20),rayMat.clone());
    m.position.set(R(-14,4),TANK.water-9.5,R(-6,6));
    m.rotation.z=R(-.12,.12);m.rotation.y=R(0,Math.PI);
    m.userData.ph=R(0,6);m.userData.baseO=R(.4,.7);
    m.renderOrder=5;scene.add(m);rays.push(m);
  }
}
function updateRays(t,dt){
  const k=U.uCaus.value; // 夜晚减弱
  for(const m of rays){
    m.material.opacity+=(m.userData.baseO*k*(0.75+0.25*Math.sin(t*.5+m.userData.ph))-m.material.opacity)*Math.min(1,dt*2);
    m.rotation.z+=Math.sin(t*.3+m.userData.ph)*dt*.02;
  }
}

// ---------- glass tank + wooden frame + cabinet (original construction)
{
  // clear glass: high transmission, both faces
  const glassMat=new THREE.MeshPhysicalMaterial({
    color:0xeaf6ff,transparent:true,opacity:.16,
    roughness:.03,metalness:0,
    transmission:.92,thickness:.35,ior:1.45,
    side:THREE.DoubleSide,depthWrite:false,
    envMapIntensity:.7
  });
  const hw=TANK.w/2,hd=TANK.d/2,hh=TANK.h/2;
  const wall=(w,px,pz,ry)=>{
    const m=new THREE.Mesh(new THREE.PlaneGeometry(w,TANK.h),glassMat);
    m.position.set(px,hh,pz);m.rotation.y=ry;scene.add(m);
  };
  wall(TANK.w,0,-hd,0);wall(TANK.w,0,hd,Math.PI);
  wall(TANK.d,-hw,0,Math.PI/2);wall(TANK.d,hw,0,-Math.PI/2);
  // glowing waterline rim
  const rim=new THREE.Mesh(new THREE.BoxGeometry(TANK.w+.3,.18,TANK.d+.3),
    new THREE.MeshStandardMaterial({color:0x9fd8ff,roughness:.2,metalness:.6,
      emissive:0x2a4a5a,emissiveIntensity:.4}));
  rim.position.y=TANK.water;scene.add(rim);
  // frame bars
  const woodMat=new THREE.MeshStandardMaterial({color:0x6e4f30,roughness:.65});
  const bar=(w,h,d,px,py,pz)=>{
    const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),woodMat);
    m.position.set(px,py,pz);m.castShadow=true;scene.add(m);
  };
  const topY=TANK.h+.25;
  for(const sx of [-1,1])for(const sz of [-1,1])
    bar(.7,topY,.7,sx*(hw+.15),topY/2,sz*(hd+.15));
  for(const y of [.35,topY]){
    bar(TANK.w+1,.7,.7,0,y,-hd-.15);bar(TANK.w+1,.7,.7,0,y,hd+.15);
    bar(.7,.7,TANK.d+1,-hw-.15,y,0);bar(.7,.7,TANK.d+1,hw-.15,y,0);
  }
  // stand
  const stand=new THREE.Mesh(new THREE.BoxGeometry(TANK.w+2.4,7,TANK.d+2.4),
    new THREE.MeshStandardMaterial({color:0x2c1f12,roughness:.8}));
  stand.position.y=-3.6;scene.add(stand);
}

// ---------- 装饰: 岩石 / 水草丛
const hsl=(h,s,l)=>new THREE.Color().setHSL(((h%1)+1)%1,s,l);
// lumpy rock: sphere displaced by layered trig noise, squashed
function rock(r0,flat){
  const g=new THREE.SphereGeometry(r0,26,18),p=g.attributes.position;
  const f1=R(1.5,3),f2=R(1.5,3),ph=R(0,9),sq=flat??.6;
  const v=new THREE.Vector3();
  for(let i=0;i<p.count;i++){
    v.fromBufferAttribute(p,i);
    const n=v.clone().normalize();
    const bump=1+.2*Math.sin(n.x*f1*2+ph)*Math.sin(n.z*f2*2+ph*1.3)
      +.09*Math.sin(n.y*8+n.x*5+ph);
    v.multiplyScalar(bump);v.y*=sq;
    p.setXYZ(i,v.x,v.y,v.z);
  }
  g.computeVertexNormals();
  const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({
    color:hsl(R(.06,.1),R(.18,.32),R(.15,.27)),roughness:.95}));
  m.castShadow=m.receiveShadow=true;
  m.rotation.y=R(0,6);
  return m;
}
// swaying blade: tapered plane, wind in vertex shader; eco drives uGrow/uBend
function blade(color,height,width){
  const segs=14,g=new THREE.PlaneGeometry(width,height,1,segs);
  g.translate(0,height/2,0);
  const m=new THREE.MeshStandardMaterial({color,side:THREE.DoubleSide,roughness:.6});
  const uPh={value:R(0,6)},uGrow={value:1},uBend={value:1};
  m.onBeforeCompile=s=>{
    s.uniforms.uTime=U.uTime;s.uniforms.uPh=uPh;
    s.uniforms.uH={value:height};s.uniforms.uGrow=uGrow;s.uniforms.uBend=uBend;
    s.vertexShader='uniform float uTime;uniform float uPh;uniform float uH;uniform float uGrow;uniform float uBend;\n'+
    s.vertexShader.replace('#include <begin_vertex>',`
      vec3 transformed=position;
      float growK=clamp(uGrow,.05,1.5);
      transformed.y*=growK;
      float k=clamp(position.y/max(uH,.001),0.,1.);
      float k2=k*k;
      float sway=max(.35,uBend);
      float wA=sin(uTime*1.2+uPh+k*2.4)*.15;
      float wB=sin(uTime*.6+uPh*1.6+k*1.2)*.10;
      float wC=sin(uTime*2.6+uPh*.7+position.y*2.)*.03;
      transformed.x+=(wA+wB+wC)*k2*uH*sway;
      transformed.z+=cos(uTime*.9+uPh*1.2+k*1.8)*.11*k2*uH*sway;
      float flare=smoothstep(.45,1.,k)*max(0.,growK-.85)*.15;
      transformed.x*=1.+flare;transformed.z*=1.+flare;`);
  };
  const mesh=new THREE.Mesh(g,m);
  mesh.castShadow=true;
  mesh.userData.uGrow=uGrow;mesh.userData.uBend=uBend;
  mesh.userData.baseH=height;
  mesh.userData.growPhase=R(0,1);
  return mesh;
}
const decor=new THREE.Group();scene.add(decor);
// 石头
for(let i=0;i<10;i++){const r=rock(R(.7,2.2));const x=R(-16,5.5);
  r.position.set(x,R(-.3,.1),R(-7.5,7.5));r.scale.y*=.7;decor.add(r)}
// ---------- 海盗沉船(鱼群躲避点)
const shelterPos=new THREE.Vector3(-11,3.5,2);
{
  const woodTex=(()=>{
    const c=document.createElement('canvas');c.width=256;c.height=128;
    const g=c.getContext('2d');g.fillStyle='#5a4030';g.fillRect(0,0,256,128);
    for(let y=0;y<128;y+=16){
      g.fillStyle=`rgba(0,0,0,${R(.15,.3)})`;g.fillRect(0,y,256,2);
      for(let i=0;i<20;i++){g.fillStyle=`rgba(${R(40,80)|0},${R(25,55)|0},${R(15,35)|0},.5)`;
        g.fillRect(R(0,256),y+R(2,14),R(10,60),1.5);}
    }
    const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;
  })();
  const woodMat=new THREE.MeshStandardMaterial({map:woodTex,roughness:.9,color:0x9a7a5a});
  const darkWood=new THREE.MeshStandardMaterial({map:woodTex,roughness:.95,color:0x6a523e});
  const ship=new THREE.Group();
  // 船体: 半截圆筒, 倾斜半埋
  const hull=new THREE.Mesh(new THREE.CylinderGeometry(3.2,2.6,9,10,1,true,-Math.PI*.7,Math.PI*1.4),woodMat);
  hull.rotation.z=Math.PI/2;hull.rotation.y=.3;hull.material.side=THREE.DoubleSide;
  ship.add(hull);
  // 断桅
  const mast=new THREE.Mesh(new THREE.CylinderGeometry(.22,.3,7,8),darkWood);
  mast.position.set(1,3.5,0);mast.rotation.z=-.5;ship.add(mast);
  const mastTop=new THREE.Mesh(new THREE.CylinderGeometry(.18,.22,3,8),darkWood);
  mastTop.position.set(3.2,5.2,.3);mastTop.rotation.z=-1.1;ship.add(mastTop);
  // 散落木板
  for(let i=0;i<6;i++){
    const pl=new THREE.Mesh(new THREE.BoxGeometry(R(1.5,3),.18,R(.5,.9)),i%2?woodMat:darkWood);
    pl.position.set(R(-4,4),R(-2.4,-1),R(-3,3));pl.rotation.set(R(0,3),R(0,3),R(0,3));
    ship.add(pl);
  }
  // 破帆布
  const sail=new THREE.Mesh(new THREE.PlaneGeometry(3,2.2,4,3),new THREE.MeshStandardMaterial({color:0xcabfa8,roughness:1,side:THREE.DoubleSide}));
  {const p=sail.geometry.attributes.position;
   for(let i=0;i<p.count;i++)p.setZ(i,Math.sin(p.getX(i)*2)*.3+R(-.1,.1));
   p.needsUpdate=true;}
  sail.position.set(2.2,4.4,.5);sail.rotation.set(.2,.4,-.4);ship.add(sail);
  ship.position.set(-11,-1.2,2);ship.rotation.y=.5;
  ship.traverse(o=>{if(o.isMesh){o.castShadow=o.receiveShadow=true}});
  decor.add(ship);
}
// ---------- 贝壳
{
  const shellTex=(()=>{
    const c=document.createElement('canvas');c.width=128;c.height=128;
    const g=c.getContext('2d');g.fillStyle='#e8d8c0';g.fillRect(0,0,128,128);
    for(let i=0;i<14;i++){
      g.strokeStyle=`rgba(150,110,90,${R(.3,.6)})`;g.lineWidth=R(2,4);
      g.beginPath();g.moveTo(64,128);g.lineTo(i*10,0);g.stroke();
    }
    return new THREE.CanvasTexture(c);
  })();
  const shellMat=new THREE.MeshStandardMaterial({map:shellTex,roughness:.7,color:0xfff0dd});
  for(let i=0;i<7;i++){
    const s=new THREE.Mesh(new THREE.SphereGeometry(R(.5,.9),12,8,0,Math.PI*2,0,Math.PI*.45),shellMat);
    s.scale.y=.45;s.rotation.x=Math.PI;s.rotation.z=R(0,6);
    s.position.set(R(-14,4),.15,R(-6,6));
    s.castShadow=s.receiveShadow=true;decor.add(s);
  }
}
// ---------- 沉船气泡: 船体残骸里定时冒出一串气泡
const wreckBubblePos=new THREE.Vector3(-11,2.2,2);

function updateWreckBubbles(dt){
  View.wreckBubbleT-=dt;
  if(View.wreckBubbleT<=0){
    View.wreckBubbleT=R(6,12);
    // 从沉船船体放出一串气泡: 把已到顶的气泡重定位到船舱口
    let n=0;
    for(const b of bubbles){
      if(b.position.y>TANK.water-1&&n<5){
        b.position.set(wreckBubblePos.x+R(-1.5,1.5),wreckBubblePos.y+R(-.5,.5),wreckBubblePos.z+R(-1,1));
        n++;
      }
    }
    if(n)blip(900,0.1,0.03);
  }
}
// 晒背岛:石堆
{
  const isl=new THREE.Group();
  const put=(x,y,z,s,sy)=>{const r=rock(s);r.position.set(x,y,z);r.scale.y=sy||1;isl.add(r)};
  put(12.5,15.2,0,4.6,.75);put(10.6,13.6,1.8,3.2,.7);put(14.6,13.8,-1.6,3.4,.7);
  put(11.8,16.6,-2.2,2.4,.7);put(13.8,16.8,2,2.6,.72);put(12.4,17.6,0,2.8,.62);
  put(9.2,11.8,-.6,2.6,.75);put(8,8.6,.8,2.8,.8);put(7,5.4,-.4,2.6,.85);put(6.4,2.6,.2,2.2,.9);
  isl.traverse(o=>{if(o.isMesh){o.castShadow=o.receiveShadow=true}});
  scene.add(isl);
}
// 水草(生态丛: 生长/净化/产氧/修剪/藏身)
const plantClusters=[];
const SICK_LEAF=new THREE.Color(0x8a7a3a);
{
  const greens=[hsl(.29,.6,.32),hsl(.33,.55,.28),hsl(.25,.65,.36),hsl(.36,.5,.3)];
  function addCluster(cx,cz,blades,bh,bw){
    const grp=new THREE.Group();grp.position.set(cx,0,cz);decor.add(grp);
    const c={x:cx,z:cz,grp,h:0.55,hVis:0.55,health:1,baseH:1,blades:[],sway:0,swayDir:0,flash:0,growPulse:0,prevH:0.55};
    for(let j=0;j<blades;j++){
      const col=pick(greens).clone().offsetHSL(R(-.02,.02),0,R(-.06,.06));
      const b=blade(col,R(bh*.4,bh),R(bw*.6,bw));
      b.position.set(R(-.9,.9),0,R(-.9,.9));b.rotation.y=R(0,6);
      b.userData.baseCol=b.material.color.clone();
      b.userData.uGrow.value=0.35+R(0,0.25); // 初始略矮,之后动画长高
      grp.add(b);c.blades.push(b);
    }
    c.baseH=1;
    plantClusters.push(c);return c;
  }
  for(let i=0;i<7;i++){const cx=R(-16.5,5),cz=R(-8,8);
    if(Math.hypot(cx-ISLAND.cx,cz-ISLAND.cz)<ISLAND.r+.8)continue;
    addCluster(cx,cz,RI(3,6),R(1.6,5.2),R(.22,.5));}
  for(let i=0;i<4;i++)addCluster(R(-16,-10),R(-7,7),5,R(7,10.5),R(.5,.8));
}
function plantMass(){let m=0;for(const p of plantClusters)m+=p.h*p.health;return m;}
function plantCoverAt(x,z){ // 藏身值(卵/小鱼躲乌龟)
  let best=0;
  for(const p of plantClusters){
    const d=Math.hypot(x-p.x,z-p.z),rad=1.2+p.h*2.2;
    if(d<rad)best=Math.max(best,(1-d/rad)*p.health*Math.min(1,p.h/p.baseH));
  }
  return best;
}
function nearestPlant(x,z){
  let best=null,bd=1e9;
  for(const p of plantClusters){
    const d=Math.hypot(x-p.x,z-p.z);
    if(d<bd){bd=d;best=p;}
  }
  return best?{plant:best,dist:bd}:null;
}
function plantRadius(p){return 1.1+p.h*2.0;}
// 鱼/龟穿梭 → 水草摇摆
function plantSwayFrom(x,z,force){
  for(const p of plantClusters){
    const d=Math.hypot(x-p.x,z-p.z),rad=plantRadius(p);
    if(d<rad){
      const k=(1-d/rad)*force;
      p.sway=(p.sway||0)+k;
      p.swayDir=p.swayDir||0;
      p.swayDir+=(x-p.x)*0.02*k;
    }
  }
}
function updatePlants(dt){
  const tNow=performance.now()*0.001;
  for(const p of plantClusters){
    const light=Eco.dayNight>0.5?0.09:0.02;
    const grow=light*(0.3+Eco.waste*1.2)*(0.5+Eco.oxygen*0.8)*dt*p.health;
    const maxH=p.baseH*(1.15+Eco.waste*0.55);
    const prev=p.h;
    if(p.health>0.15)p.h=Math.min(maxH,p.h+grow);
    // 生长脉冲: 正在长高时发一点绿光
    if(p.h>prev+1e-6)p.growPulse=Math.min(1,(p.growPulse||0)+dt*2.5);
    else p.growPulse=Math.max(0,(p.growPulse||0)-dt*0.8);
    // 疯长
    const overgrown=p.h>p.baseH*1.35;
    const purify=overgrown?0.004:0.0065;
    Eco.waste=Math.max(0,Eco.waste-p.h*p.health*purify*dt);
    Eco.oxygen=clamp(Eco.oxygen+p.h*p.health*(Eco.dayNight>0.5?0.032:-0.006)*dt,0,1);
    if(overgrown)Eco.waste=Math.min(1,Eco.waste+0.0015*dt*p.h);
    if(Eco.quality<0.3)p.health=Math.max(0.1,p.health-0.03*dt);
    else p.health=Math.min(1,p.health+0.012*dt);

    // —— 生长动画: 视觉高度平滑跟随逻辑高度 ——
    const hTarget=p.h;
    // 修剪/啃食时下落更快，生长时较慢舒展
    const catchUp=hTarget<p.hVis?6.5:1.8;
    p.hVis+=(hTarget-(p.hVis||hTarget))*Math.min(1,dt*catchUp);
    // 整体缩放: Y 主高度, XZ 随生长微微变粗
    const hv=p.hVis;
    const fat=0.92+Math.min(1,hv/Math.max(0.2,p.baseH))*0.12;
    p.grp.scale.set(fat,hv,fat);

    // —— 持续摆动: 环境水流 + 互动冲击 ——
    p.sway=(p.sway||0)*Math.max(0,1-dt*2.2);
    p.swayDir=(p.swayDir||0)*Math.max(0,1-dt*1.2);
    // 每丛固定相位,避免整齐划一
    if(p.windPhase===undefined)p.windPhase=Math.random()*6.28;
    if(p.windSpeed===undefined)p.windSpeed=0.7+Math.random()*0.6;
    // 过滤开 → 水流更强; 白天略强; 互动叠加
    const flow=(Eco.filterOn?1.35:0.85)*(0.75+Eco.dayNight*0.35);
    const idle=0.22*flow; // 基础闲置摆幅
    const hit=Math.min(0.7,p.sway||0);
    const swayAmt=idle+hit;
    const ph=p.windPhase+tNow*p.windSpeed;
    // 整丛柔和左右/前后摇
    p.grp.rotation.z=Math.sin(ph)*0.07*swayAmt*3.2 + Math.sin(ph*0.37)*0.025*swayAmt;
    p.grp.rotation.x=Math.cos(ph*0.82)*0.045*swayAmt*3.0 + Math.sin(ph*1.1+1.2)*0.02*swayAmt;
    // 轻微自转扭动
    p.grp.rotation.y=Math.sin(ph*0.45+p.windPhase)*0.04*swayAmt;

    if(p.flash>0)p.flash=Math.max(0,p.flash-dt);
    const sickK=(1-p.health)*0.75;
    const growK=p.growPulse||0;

    // 每片叶子: 错峰生长 + 独立风摆强度
    for(let i=0;i<p.blades.length;i++){
      const b=p.blades[i];
      const phase=b.userData.growPhase||0;
      const stagger=0.72+0.28*Math.sin(phase*6.28+tNow*0.12);
      const leafTarget=Math.max(0.12,Math.min(1.25,hv*stagger));
      const ug=b.userData.uGrow;
      if(ug){
        const speed=leafTarget<ug.value?5:2.2;
        ug.value+=(leafTarget-ug.value)*Math.min(1,dt*speed);
      }
      // 弯曲强度: 基础风 + 水流 + 互动 + 生长柔软
      if(b.userData.uBend){
        const leafWind=0.9+0.35*Math.sin(phase*4+tNow*0.3);
        const bendT=(0.85*flow*leafWind)+growK*0.35+hit*0.9;
        b.userData.uBend.value+=(bendT-b.userData.uBend.value)*Math.min(1,dt*2.5);
      }
      // 叶片自身微旋(错开)
      b.rotation.z=Math.sin(tNow*(0.9+phase)+phase*5)*0.06*swayAmt;
      b.rotation.x=Math.cos(tNow*(0.7+phase*0.5)+phase)*0.04*swayAmt;

      b.material.color.copy(b.userData.baseCol).lerp(SICK_LEAF,sickK);
      const fl=p.flash||0;
      const ge=growK*0.12*(Eco.dayNight>0.4?1:0.3);
      b.material.emissive.setRGB(0.04*fl+0.02*ge,0.22*fl+0.18*ge,0.06*fl+0.04*ge);
    }
    p.grp.visible=p.hVis>0.05;
    p.prevH=p.h;
  }
}
function trimPlants(silent){
  let n=0;
  for(const p of plantClusters)if(p.h>p.baseH*0.7){p.h*=0.62;Eco.waste=Math.min(1,Eco.waste+0.035);n++;p.flash=0.8;p.sway=(p.sway||0)+1.2;}
  if(!silent)toast(n?'已修剪 '+n+' 丛水草':'水草还不需要修剪');
  blip(420,0.12,0.09);
}
// 点击单丛: 过高→修剪; 健康不足→照料; 否则轻抚摇摆
function interactPlant(p){
  if(!p)return false;
  p.flash=1.0;p.sway=(p.sway||0)+1.5;
  if(p.h>p.baseH*1.2){
    p.h*=0.55;Eco.waste=Math.min(1,Eco.waste+0.03);
    toast('修剪了这丛水草');blip(400,0.1,0.08);return true;
  }
  if(p.health<0.75){
    p.health=Math.min(1,p.health+0.28);
    Eco.oxygen=Math.min(1,Eco.oxygen+0.04);
    p.growPulse=1;
    p.h=Math.min(p.baseH*1.2,p.h+0.08); // 照料后小幅抽高
    toast('照料水草 状态好转');blip(520,0.1,0.08);return true;
  }
  // 轻抚: 短暂增氧(搅动)
  Eco.oxygen=Math.min(1,Eco.oxygen+0.015);
  toast('拨动了水草');blip(360,0.06,0.05);return true;
}
// 鱼啃食水草(饿了且附近有草)
function fishGrazePlant(f,dt){
  if(f.hunger>0.55||f.mode==='flee')return;
  const hit=nearestPlant(f.grp.position.x,f.grp.position.z);
  if(!hit||hit.dist>plantRadius(hit.plant)*0.85)return;
  const p=hit.plant;
  if(p.h<0.35||p.health<0.2)return;
  // 小口啃
  const rate=f.stage==='baby'?0.04:0.025;
  p.h=Math.max(0.2,p.h-rate*dt);
  p.sway=(p.sway||0)+dt*0.8;
  f.hunger=Math.min(1,f.hunger+rate*dt*1.8);
  Eco.waste=Math.min(1,Eco.waste+0.002*dt); // 碎屑
  if(chance(dt*0.15))f.mode='forage';
}
// 晒背取暖灯
const lampLight=new THREE.SpotLight(0xffc37a,30,45,.5,.45,1.6);
const lampGlow=(()=>{
  const c=document.createElement('canvas');c.width=c.height=128;
  const g=c.getContext('2d');
  const gr=g.createRadialGradient(64,64,4,64,64,64);
  gr.addColorStop(0,'rgba(255,214,150,.95)');gr.addColorStop(1,'rgba(255,180,100,0)');
  g.fillStyle=gr;g.fillRect(0,0,128,128);
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),
    transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));
  sp.scale.setScalar(7);
  return sp;
})();
{
  const fixture=new THREE.Group();
  const cord=new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,8),
    new THREE.MeshStandardMaterial({color:0x111111}));
  cord.position.y=4;fixture.add(cord);
  const shade=new THREE.Mesh(new THREE.ConeGeometry(1.6,1.8,24,1,true),
    new THREE.MeshStandardMaterial({color:0x222222,roughness:.5,metalness:.7,side:THREE.DoubleSide}));
  fixture.add(shade);
  const bulb=new THREE.Mesh(new THREE.SphereGeometry(.45,16,12),
    new THREE.MeshBasicMaterial({color:0xffd9a0}));
  bulb.position.y=-.6;fixture.add(bulb);
  lampGlow.position.y=-.6;fixture.add(lampGlow);
  fixture.position.set(RAMP_B.x,27,RAMP_B.z);
  scene.add(fixture);
  lampLight.position.set(RAMP_B.x,26.4,RAMP_B.z);
  lampLight.target.position.set(RAMP_B.x,RAMP_B.y,RAMP_B.z);
  scene.add(lampLight,lampLight.target);
}

// ---------- 程序化鱼: 基因组 → 建模

function genGenome(){
  const big=chance(.05),tiny=!big&&chance(.2);
  const g={id:Creatures.genomeId++,len:big?R(2.6,4):tiny?R(.4,.7):R(.9,2)};
  g.body=pick(['torpedo','deep','disc','round','slender','normal','normal']);
  const hr={torpedo:R(.16,.22),deep:R(.45,.6),disc:R(.7,.95),round:R(.5,.65),slender:R(.1,.15),normal:R(.28,.4)}[g.body];
  g.h=g.len*hr;g.w=g.len*({disc:R(.08,.12),round:R(.35,.45),slender:R(.1,.13)}[g.body]||R(.14,.25));
  g.headPow=R(.6,1.1);g.hump=R(-.1,.3);g.belly=R(.8,1.15);
  g.tail=pick(['fork','fork','round','lunate','truncate','veil']);
  g.tailLen=g.tail==='veil'?R(.7,1.1):R(.25,.45);g.tailH=g.tail==='veil'?R(1.2,1.8):R(.7,1.2);
  g.dorsal=pick(['low','tall','long']);g.dorsalH=({low:.35,tall:1.1,long:.6})[g.dorsal]*R(.8,1.2);
  g.analH=R(.3,.8);g.finAlpha=R(.5,.9);
  // 淡水缸配色:金/红白/墨黑
  const pal=pick([
    [hsl(.07,.85,.55),hsl(.07,.85,.62)],                       // 金
    [hsl(.08,.9,.5),hsl(0,0,.92)],                             // 红白
    [hsl(0,0,.12),hsl(.07,.7,.45)],                            // 墨+金
    [hsl(0,0,.95),hsl(.07,.85,.55)],                           // 白+金
    [hsl(.35,.45,.4),hsl(.35,.5,.55)],                         // 青
  ]);
  g.c1=pal[0];g.c2=pal[1];
  g.pattern=pick(['plain','vbars','spots','gradient','mottled','hstripe']);
  g.patN=RI(2,6);g.finCol=chance(.5)?g.c1:g.c2;g.tailCol=chance(.3)?g.c2:g.finCol;
  g.eye=R(.07,.12);g.shine=R(.2,.8);
  g.school=g.len<.9&&chance(.6);g.speed=R(.7,1.2);g.freq=R(5,8);
  return g;}
// 品种定向基因组(2D 三品种 → 3D 体型/尾鳍/游速/体色)
function genGenomeFor(breed,hue){
  const B=BREEDS[breed]||BREEDS.comet,g=genGenome();
  g.body=B.body;g.tail=B.tail;
  const hr={torpedo:R(.16,.22),deep:R(.45,.6),round:R(.5,.65),slender:R(.1,.15)}[g.body]||R(.28,.4);
  g.len=R(B.len[0],B.len[1]);g.h=g.len*hr;
  g.w=g.len*({round:R(.35,.45)}[g.body]||R(.14,.25));
  g.tailLen=g.tail==='veil'?R(.7,1.1):g.tail==='fork'?R(.4,.6):R(.25,.45);
  g.tailH=g.tail==='veil'?R(1.2,1.8):R(.7,1.2);
  g.speed=R(B.speed[0],B.speed[1]);g.cruise=B.cruise;
  g.school=false;
  const h=hue||pick(PALETTES);
  g.c1=new THREE.Color(h.light);g.c2=new THREE.Color(h.dark);
  g.pattern=h.patch?'spots':pick(['plain','vbars','gradient']);
  g.finCol=g.c1;g.tailCol=g.c2;
  return g;
}
function fishTexture(g){const W=512,H=256,c=document.createElement('canvas');c.width=W;c.height=H;const x=c.getContext('2d');
  const s1='#'+g.c1.getHexString(),s2='#'+g.c2.getHexString();
  x.fillStyle=s1;x.fillRect(0,0,W,H);x.fillStyle=s2;
  const P=g.pattern,n=g.patN;
  if(P==='vbars')for(let i=0;i<n;i++){const cx=W*(.18+i*.7/n);x.beginPath();x.ellipse(cx,H/2,W*R(.015,.04),H*.55,R(-.15,.15),0,7);x.fill()}
  if(P==='hstripe')for(let i=0;i<Math.min(n,3);i++){x.fillRect(0,H*(.3+i*.2),W*R(.8,1),H*R(.04,.1))}
  if(P==='spots')for(let i=0;i<n*25;i++){x.beginPath();x.arc(R(0,W),R(0,H),R(3,9),0,7);x.fill()}
  if(P==='gradient'){const gr=x.createLinearGradient(0,0,W,0);gr.addColorStop(0,s2);gr.addColorStop(R(.4,.8),s1);x.fillStyle=gr;x.fillRect(0,0,W,H)}
  if(P==='mottled')for(let i=0;i<260;i++){x.globalAlpha=R(.1,.4);x.beginPath();x.ellipse(R(0,W),R(0,H),R(5,25),R(4,15),R(0,3),0,7);x.fill()}
  if(P==='koi'){ // 红白锦鲤: 白底 + 浓红大斑块(头顶必有一块)
    x.globalAlpha=1;
    const patch=(cx,cy,rw,rh)=>{x.beginPath();x.ellipse(cx,cy,rw,rh,R(-.3,.3),0,7);x.fill();};
    patch(W*.88,H*.40,W*.09,H*.24); // 头顶大红斑
    const n=4+(Math.random()*3|0);
    for(let i=0;i<n;i++)patch(R(W*.15,W*.78),R(H*.22,H*.78),R(W*.04,W*.09),R(H*.12,H*.26));
    // 边缘晕染
    x.globalAlpha=.3;
    for(let i=0;i<n*10;i++){x.beginPath();x.arc(R(0,W),R(H*.2,H*.8),R(2,7),0,7);x.fill();}
  }
  if(P==='clown'){ // 小丑鱼: 橙底 + 3条白竖纹黑边
    x.globalAlpha=1;
    for(const bx of [W*.78,W*.52,W*.28]){
      x.fillStyle='#111';x.fillRect(bx-W*.035,0,W*.07,H);
      x.fillStyle='#f8f8f8';x.fillRect(bx-W*.022,0,W*.044,H);
    }
  }
  if(P==='bluetang'){ // 蓝吊: 宝蓝底 + 黑色调色盘纹 + 黄尾
    x.globalAlpha=1;
    x.fillStyle='#0d1b2a';
    x.beginPath();x.moveTo(W*.95,H*.5);
    x.bezierCurveTo(W*.7,H*.05,W*.45,H*.15,W*.35,H*.5);
    x.bezierCurveTo(W*.45,H*.85,W*.7,H*.95,W*.95,H*.5);x.fill();
    const yg=x.createLinearGradient(W*.18,0,0,0);
    yg.addColorStop(0,'rgba(250,200,40,0)');yg.addColorStop(1,'rgba(250,200,40,.95)');
    x.fillStyle=yg;x.fillRect(0,0,W*.2,H);
  }
  if(P==='yellowtang'){ // 黄吊: 纯柠檬黄(靠明暗+鳞片出质感)
    x.globalAlpha=.15;x.fillStyle='#fff';
    for(let i=0;i<30;i++){x.beginPath();x.arc(R(0,W),R(0,H),R(3,9),0,7);x.fill();}
  }
  if(P==='royalgramma'){ // 火焰魔: 紫头→黄尾渐变
    const rg=x.createLinearGradient(W,0,0,0);
    rg.addColorStop(0,'rgba(120,60,180,.85)');rg.addColorStop(.55,'rgba(120,60,180,.25)');
    rg.addColorStop(1,'rgba(250,200,60,.55)');
    x.globalAlpha=1;x.fillStyle=rg;x.fillRect(0,0,W,H);
  }
  if(P==='mandarin'){ // 麒麟鱼: 宝蓝底 + 橙色波浪纹
    x.globalAlpha=.9;x.strokeStyle='#e88020';x.lineWidth=3;
    for(let r=0;r<5;r++){
      x.beginPath();
      for(let xx=0;xx<=W;xx+=8){
        const yy=H*(.15+r*.17)+Math.sin(xx*.05+r*1.7)*H*.06;
        xx?x.lineTo(xx,yy):x.moveTo(xx,yy);
      }
      x.stroke();
    }
    x.globalAlpha=.5;x.fillStyle='#e88020';
    for(let i=0;i<12;i++){x.beginPath();x.arc(R(0,W),R(0,H),R(2,5),0,7);x.fill();}
  }
  if(P==='moorish'){ // 摩尔神像: 米白底 + 黑纵带 + 黄点缀
    x.globalAlpha=.92;x.fillStyle='#151515';
    for(const bx of [W*.72,W*.45]){
      x.beginPath();x.moveTo(bx,0);x.lineTo(bx+W*.09,0);
      x.lineTo(bx+W*.05,H);x.lineTo(bx-W*.04,H);x.closePath();x.fill();
    }
    x.globalAlpha=.8;x.fillStyle='#f0c030';x.fillRect(W*.86,0,W*.05,H);
  }
  if(P==='shark'){ // 小鲨鱼: 背灰蓝腹白(反影)
    const sg=x.createLinearGradient(0,0,0,H);
    sg.addColorStop(0,'rgba(70,90,110,.9)');sg.addColorStop(.55,'rgba(70,90,110,.15)');
    sg.addColorStop(.62,'rgba(255,255,255,.1)');sg.addColorStop(1,'rgba(240,240,240,.75)');
    x.globalAlpha=1;x.fillStyle=sg;x.fillRect(0,0,W,H);
  }
  if(P==='angelfish'){ // 神仙鱼: 银白底 + 4 道黑竖纹
    x.globalAlpha=.9;x.fillStyle='#1a1a1a';
    for(const bx of [W*.78,W*.58,W*.38,W*.18]){
      x.beginPath();x.moveTo(bx,0);x.lineTo(bx+W*.05,0);
      x.lineTo(bx+W*.03,H);x.lineTo(bx-W*.02,H);x.closePath();x.fill();
    }
  }
  if(P==='guppy'){ // 孔雀鱼: 蓝绿→橙渐变 + 亮斑
    const gg=x.createLinearGradient(W,0,0,0);
    gg.addColorStop(0,'rgba(255,110,30,.9)');gg.addColorStop(.5,'rgba(60,200,220,.55)');
    gg.addColorStop(1,'rgba(40,120,220,.35)');
    x.globalAlpha=1;x.fillStyle=gg;x.fillRect(0,0,W,H);
    x.globalAlpha=.8;
    for(let i=0;i<14;i++){x.fillStyle=pick(['#ff4040','#40ff80','#ffff40','#ff40c0']);
      x.beginPath();x.arc(R(W*.2,W*.8),R(H*.2,H*.8),R(3,8),0,7);x.fill();}
  }
  if(P==='neon'){ // 红绿灯: 霓虹蓝横纹 + 尾部红
    x.globalAlpha=1;
    x.fillStyle='#19d8ff';x.fillRect(0,H*.42,W,H*.1);
    x.fillStyle='rgba(255,60,60,.85)';x.fillRect(0,H*.55,W*.45,H*.22);
    x.globalAlpha=.5;x.fillStyle='#fff';x.fillRect(0,H*.42,W,H*.03);
  }
  x.globalAlpha=1;
  const cs=x.createLinearGradient(0,0,0,H);cs.addColorStop(0,'rgba(255,255,255,.5)');cs.addColorStop(.35,'rgba(255,255,255,0)');
  cs.addColorStop(.7,'rgba(0,0,0,0)');cs.addColorStop(1,'rgba(0,0,0,.5)');
  x.fillStyle=cs;x.fillRect(0,0,W,H);
  const sc=g.len<.8?7:10;x.lineWidth=1;
  for(let yy=0;yy<H;yy+=sc)for(let xx=(yy/sc%2)*sc*.7;xx<W*.85;xx+=sc*1.4){
    x.strokeStyle=`rgba(0,0,0,${R(.05,.12)})`;x.beginPath();x.arc(xx,yy,sc*.8,-1.3,1.3);x.stroke()}
  x.strokeStyle='rgba(0,0,0,.2)';x.lineWidth=1.5;x.beginPath();x.moveTo(W*.05,H*.55);
  x.quadraticCurveTo(W*.5,H*.72,W*.82,H*.7);x.stroke();
  x.fillStyle='rgba(0,0,0,.12)';x.fillRect(W*.86,0,W*.14,H);
  x.strokeStyle='rgba(0,0,0,.35)';x.lineWidth=3;x.beginPath();x.arc(W*.95,H*.5,H*.35,Math.PI*.6,Math.PI*1.4);x.stroke();
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;}
const _finTexCache={};
function finTexture(col){
  const key=col.getHexString();
  if(_finTexCache[key])return _finTexCache[key];
  const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d');
  x.fillStyle='#'+key;x.fillRect(0,0,128,128);x.strokeStyle='rgba(0,0,0,.35)';x.lineWidth=1.2;
  for(let i=0;i<16;i++){x.beginPath();x.moveTo(64,128);x.lineTo(i*8.5,0);x.stroke()}
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;
  _finTexCache[key]=t;return t;}
const EYE_IRIS=[0xb8862e,0xc09030,0x8a6a2a,0xd0a040].map(c=>
  new THREE.MeshStandardMaterial({color:c,roughness:.4}));
const EYE_PUPIL=new THREE.MeshStandardMaterial({color:0x020202,roughness:.1});
const pickEye=()=>pick(EYE_IRIS);
const swimChunk=`vec3 transformed=position;float k=clamp(.45-position.x/uLen,0.,1.4);transformed.z+=sin(uPh-position.x*5./uLen)*k*k*uAmp*uLen*.3;`;
function swimMaterial(mat,U2){mat.onBeforeCompile=s=>{Object.assign(s.uniforms,U2);
  s.vertexShader='uniform float uPh;uniform float uAmp;uniform float uLen;\n'+s.vertexShader.replace('#include <begin_vertex>',swimChunk)};return mat;}
function buildFish(g){
  const L=g.len,H=g.h,Wd=g.w,U2={uPh:{value:R(0,6)},uAmp:{value:.3},uLen:{value:L}};
  const body=new THREE.SphereGeometry(1,48,24),p=body.attributes.position,uv=body.attributes.uv;
  for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i);const t=(y+1)/2;
    let prof=Math.pow(Math.max(0,Math.sin(Math.PI*Math.pow(t,g.headPow))),.75);
    prof*=Math.min(1,t<.15?.35+t*4.3:1);
    const top=x>0?(1+g.hump*Math.sin(Math.PI*t)):g.belly;
    p.setXYZ(i,y*L/2,x*H/2*prof*top,z*Wd/2*prof);uv.setXY(i,t,(x+1)/2);}
  body.computeVertexNormals();
  const mat=swimMaterial(new THREE.MeshPhysicalMaterial({map:fishTexture(g),roughness:.32,metalness:.06,
    clearcoat:1,clearcoatRoughness:.25,iridescence:g.shine,iridescenceIOR:1.4,sheen:.4,sheenColor:g.c2}),U2);
  const grp=new THREE.Group(),bm=new THREE.Mesh(body,mat);bm.castShadow=true;grp.add(bm);
  const finMat=col=>swimMaterial(new THREE.MeshPhysicalMaterial({map:finTexture(col),transparent:true,opacity:g.finAlpha,
    side:THREE.DoubleSide,roughness:.5,depthWrite:false}),U2);
  const fm=finMat(g.finCol),tm=g.tailCol===g.finCol?fm:finMat(g.tailCol);
  const mk=(pts,m)=>{const s=new THREE.Shape();s.moveTo(pts[0][0],pts[0][1]);
    for(let i=1;i+1<pts.length;i+=2)s.quadraticCurveTo(pts[i][0],pts[i][1],pts[i+1][0],pts[i+1][1]);
    const geo=new THREE.ShapeGeometry(s,12),me=new THREE.Mesh(geo,m);grp.add(me);return me;};
  const x0=-L*.46,tl=L*g.tailLen,th=H*g.tailH*.6;
  const tails={fork:[[x0,0],[x0-tl*.5,th*.4],[x0-tl,th],[x0-tl*.55,0],[x0-tl,-th],[x0-tl*.5,-th*.4],[x0,0]],
    lunate:[[x0,0],[x0-tl*.3,th*.6],[x0-tl,th*1.1],[x0-tl*.4,0],[x0-tl,-th*1.1],[x0-tl*.3,-th*.6],[x0,0]],
    round:[[x0,0],[x0-tl*.2,th*.9],[x0-tl,th*.5],[x0-tl*1.2,0],[x0-tl,-th*.5],[x0-tl*.2,-th*.9],[x0,0]],
    truncate:[[x0,0],[x0-tl*.4,th*.7],[x0-tl,th*.8],[x0-tl*.95,0],[x0-tl,-th*.8],[x0-tl*.4,-th*.7],[x0,0]],
    veil:[[x0,0],[x0-tl*.3,th*1.2],[x0-tl,th*.7],[x0-tl*1.3,-th*.2],[x0-tl*.9,-th*1.1],[x0-tl*.3,-th*.8],[x0,0]]};
  mk(tails[g.tail]||tails.fork,tm);
  const dh=H*g.dorsalH*.5,ds=-L*.22,de=L*.08,dtop=H*.42*(1+g.hump*.8);
  mk([[ds,dtop-.02],[ds+(de-ds)*.35,dtop+dh*1.5],[de,dtop+dh*.3],[de+L*.03,dtop*.9],[de,dtop*.9]],fm);
  const ah=H*g.analH*.4;mk([[-L*.32,-H*.4],[-L*.28,-H*.4-ah*1.4],[-L*.08,-H*.42],[-L*.1,-H*.4],[-L*.12,-H*.4]],fm);
  const pec=mk([[0,0],[-L*.08,-H*.15],[-L*.16,-H*.12],[-L*.06,H*.05],[0,0]],fm);
  pec.position.set(L*.22,-H*.08,Wd*.42);pec.rotation.y=-.5;
  const pec2=pec.clone();pec2.position.z*=-1;pec2.rotation.y=.5;grp.add(pec2);
  const er=Math.max(H*.12,L*g.eye*.5),irisM=pickEye();
  for(const s of [1,-1]){const e=new THREE.Group();
    e.add(new THREE.Mesh(new THREE.SphereGeometry(er,20,14),EYE_IRIS));
    const pu=new THREE.Mesh(new THREE.SphereGeometry(er*.62,16,12),EYE_PUPIL);pu.position.z=s*er*.5;e.add(pu);
    e.position.set(L*.34,H*.1,s*Wd*.36*.9);e.scale.z=.6;grp.add(e)}
  return {grp,U2,bodyMat:mat};}

// ---------- 鱼群生态
const fish=[],food=[];
const bounds={xMin:-16.5,xMax:6.8,yMin:1,yMax:15,zMin:-8,zMax:8};
const adultsAlive=()=>fish.filter(f=>f.alive&&f.stage==='adult').length;
const STRESS_EMISSIVE=new THREE.Color(0xb05a28),BITE_EMISSIVE=new THREE.Color(0xff2814);
function addFishEntry(grp,U2,g,eco){
  const f=Object.assign({g,grp,U2,bodyMat:null,
    vel:new THREE.Vector3(R(-1,1),R(-.1,.1),R(-.3,.3)).setLength(g.speed*1.5),
    target:new THREE.Vector3(),tt:0,alive:true,
    stage:'adult',age:R(20,60),hunger:R(.35,.6),armor:0,bites:0,biteFlash:0,
    breedCD:R(10,20),courtT:0,starveT:0,mode:'cruise',dartT:0,breed:null,hue:null,koi:false},
    eco||{});
  newTarget(f);scene.add(grp);fish.push(f);return f;}
function newTarget(f){
  const night=Eco.dayTarget<0.5,P=f.grp.position;
  const lowO=Eco.oxygen<0.25; // 缺氧浮头找氧
  // 偏好同品种邻域，形成松散鱼群区域
  let cx=0,cy=0,cz=0,n=0;
  for(const o of fish){
    if(o===f||!o.alive)continue;
    if(o.breed===f.breed||(!f.koi&&!o.koi&&chance(.3))){
      cx+=o.grp.position.x;cy+=o.grp.position.y;cz+=o.grp.position.z;n++;
    }
  }
  if(n>0&&chance(.55)){
    cx/=n;cy/=n;cz/=n;
    f.target.set(
      clamp(cx+R(-4,4),bounds.xMin+1,bounds.xMax-1),
      clamp(lowO?R(TANK.water-4,TANK.water-1.5):night?R(1.5,4):cy+R(-2.5,2.5),bounds.yMin+1,bounds.yMax-2),
      clamp(cz+R(-3,3),bounds.zMin+1,bounds.zMax-1));
  }else{
    f.target.set(R(bounds.xMin+1,bounds.xMax-1),
      lowO?R(TANK.water-4,TANK.water-1.5):night&&chance(.7)?R(1.5,4):R(bounds.yMin+1,bounds.yMax-2),
      R(bounds.zMin+1,bounds.zMax-1));
  }
  f.tt=R(3.5,8);
}
function removeFish(f){scene.remove(f.grp);f.grp.traverse(o=>{if(o.material){o.material.map?.dispose?.();o.material.dispose?.()}});
  fish.splice(fish.indexOf(f),1);}
// 生成器公共收尾: 建模 → 入场 → 登记
function finishFish(g,eco,pos){
  const {grp,U2,bodyMat}=buildFish(g);
  grp.position.copy(pos||new THREE.Vector3(R(-12,0),R(3,10),R(-5,5)));
  const f=addFishEntry(grp,U2,g,Object.assign({bodyMat,
    hunger:eco.stage==='baby'?0.4:R(.35,.6),age:eco.stage==='baby'?0:R(20,60)},eco));
  f.baseEmissive=bodyMat.emissive.clone();
  return f;
}
function babyScale(g,stage){if(stage==='baby'){g.len*=.45;g.h*=.45;g.w*=.45;}}
// 指定品种+体色生成
function spawnEcoFish(breed,hue,stage,pos){
  breed=breed||pick(['comet','fantail','pearl']);hue=hue||pick(PALETTES);
  const g=genGenomeFor(breed,hue);
  babyScale(g,stage);
  return finishFish(g,{breed,hue,stage:stage||'adult'},pos);
}
// 锦鲤(程序化): 红白花纹, 完整生态行为, 不参与繁殖(花纹固定)
function spawnKoi(stage,pos){
  const g=genGenome();
  g.body='torpedo';g.tail='fork';
  g.len=R(1.5,1.9);g.h=g.len*R(.2,.26);g.w=g.len*R(.16,.2);
  if(stage==='baby'){g.len*=.45;g.h*=.45;g.w*=.45;}
  g.tailLen=R(.35,.5);g.tailH=R(.8,1.1);
  g.speed=R(.8,1.1);g.freq=4;g.cruise=1;g.school=false;
  g.c1=new THREE.Color(0xf7f4ec);g.c2=new THREE.Color(0xd8401f); // 白底浓红斑(红白锦鲤)
  g.pattern='koi';g.patN=5;
  g.finCol=new THREE.Color(0xf0e8dc);g.tailCol=new THREE.Color(0xe8ddcc);
  g.finAlpha=.95;g.shine=.6;
  g.dorsalH=.5;g.analH=.4;g.eye=R(.07,.11);g.headPow=.85;g.hump=.1;g.belly=1;
  babyScale(g,stage);
  return finishFish(g,{breed:'koi',koi:true,stage:stage||'adult'},pos);
}
// ---------- 7种新热带鱼(程序化): 小丑鱼/蓝吊/黄吊/火焰魔/麒麟鱼/摩尔神像/小鲨鱼
const NEW_SPECIES=[
  {breed:'clown',     c1:0xe87020,c2:0xffffff,pattern:'clown',     len:[.8,1.1], hR:[.26,.32],spd:[.9,1.2], tail:'fork', fin:'#e87020'},
  {breed:'bluetang',  c1:0x2050c8,c2:0x0d1b2a,pattern:'bluetang',  len:[1.2,1.6],hR:[.34,.42],spd:[1.0,1.3],tail:'fork', fin:'#2050c8'},
  {breed:'yellowtang',c1:0xf0c020,c2:0xfff080,pattern:'yellowtang',len:[1.0,1.4],hR:[.4,.48], spd:[.9,1.2], tail:'fork', fin:'#f0c020'},
  {breed:'royalgramma',c1:0x7840b0,c2:0xfac828,pattern:'royalgramma',len:[.9,1.2],hR:[.28,.34],spd:[.8,1.1],tail:'fork', fin:'#a060d0'},
  {breed:'mandarin',  c1:0x2060c0,c2:0xe88020,pattern:'mandarin',  len:[.8,1.1], hR:[.24,.3], spd:[.6,.85], tail:'round',fin:'#2060c0'},
  {breed:'moorish',   c1:0xf0e8d8,c2:0x151515,pattern:'moorish',   len:[1.2,1.6],hR:[.42,.5], spd:[.9,1.2], tail:'fork', fin:'#f0e8d8',dorsal:1.2},
  {breed:'shark',     c1:0x5a6a7a,c2:0x8a9aa8,pattern:'shark',     len:[1.8,2.4],hR:[.2,.24], spd:[1.1,1.4],tail:'fork', fin:'#5a6a7a',dorsal:.9},
  {breed:'angelfish', c1:0xd8d8d0,c2:0x3a3a3a,pattern:'angelfish', len:[1.2,1.6],hR:[.5,.6],  spd:[.6,.85], tail:'veil', fin:'#c0c0b8',dorsal:1.4,body:'disc'},
  {breed:'guppy',     c1:0x30a0e0,c2:0xff7020,pattern:'guppy',     len:[.6,.9], hR:[.22,.28],spd:[.9,1.2], tail:'veil', fin:'#ff8020'},
  {breed:'neon',      c1:0x104060,c2:0x30c0ff,pattern:'neon',      len:[.5,.7], hR:[.2,.26], spd:[1.0,1.3],tail:'fork', fin:'#30c0ff',body:'slender'},
];
function spawnNewFish(cfg,stage,pos){
  cfg=cfg||pick(NEW_SPECIES);
  const g=genGenome();
  g.body=cfg.body||'torpedo';g.tail=cfg.tail;
  g.len=R(cfg.len[0],cfg.len[1]);g.h=g.len*R(cfg.hR[0],cfg.hR[1]);g.w=g.len*R(.15,.19);
  if(stage==='baby'){g.len*=.45;g.h*=.45;g.w*=.45;}
  g.tailLen=R(.3,.45);g.tailH=R(.7,1.0);
  g.speed=R(cfg.spd[0],cfg.spd[1]);g.freq=4.5;g.cruise=1;g.school=cfg.breed!=='shark';
  g.c1=new THREE.Color(cfg.c1);g.c2=new THREE.Color(cfg.c2);
  g.pattern=cfg.pattern;g.patN=5;
  g.finCol=new THREE.Color(cfg.fin);g.tailCol=new THREE.Color(cfg.fin);
  g.finAlpha=.95;g.shine=.55;g.eye=R(.07,.11);
  g.dorsalH=cfg.dorsal||.5;g.analH=.4;g.headPow=.9;g.hump=.05;g.belly=1;
  babyScale(g,stage);
  return finishFish(g,{breed:cfg.breed,stage:stage||'adult'},pos);
}
// 随机一条鱼(11种纯种): 3金鱼/锦鲤/7新鱼
function spawnRandomFish(){
  if(fish.filter(f=>f.alive).length>=MAX_FISH)return null;
  const r=Math.random();
  let f;
  if(r<0.27){ // 3种金鱼
    f=spawnEcoFish(pick(['comet','fantail','pearl']),Object.assign({},pick(PALETTES)),'adult');
  }else if(r<0.36){ // 锦鲤
    f=spawnKoi('adult');
  }else{ // 7种新鱼
    f=spawnNewFish();
  }
  if(f)f.grp.scale.setScalar(1.2);
  return f;
}
// 品种视觉特征(供混种杂交用)
function speciesVisual(breed){
  const cfg=NEW_SPECIES.find(s=>s.breed===breed);
  if(cfg)return{c1:cfg.c1,c2:cfg.c2,pattern:cfg.pattern,fin:cfg.fin};
  if(breed==='koi')return{c1:0xf7f4ec,c2:0xd8401f,pattern:'koi',fin:0xf0e8dc};
  const h=pick(PALETTES); // 金鱼: 随机取一副色板
  return{c1:parseInt(h.light.slice(1),16),c2:parseInt(h.dark.slice(1),16),pattern:null,fin:parseInt(h.light.slice(1),16)};
}
const _hx=n=>'#'+n.toString(16).padStart(6,'0');
// 混种: 双亲不同品种 → 颜色混合 + 花纹二选一
function spawnHybridFish(breedA,breedB,pos){
  const va=speciesVisual(breedA),vb=speciesVisual(breedB);
  const g=genGenome();
  g.body='torpedo';g.tail=chance(.5)?'fork':'round';
  g.len=R(.9,1.4);g.h=g.len*R(.26,.36);g.w=g.len*R(.15,.19);
  g.len*=.45;g.h*=.45;g.w*=.45; // 杂交后代从幼鱼起
  g.tailLen=R(.3,.45);g.tailH=R(.7,1.0);
  g.speed=R(.7,1.1);g.freq=4.5;g.cruise=.9;g.school=true;
  g.c1=new THREE.Color(mixHex(_hx(va.c1),_hx(vb.c1)));
  g.c2=new THREE.Color(mixHex(_hx(va.c2),_hx(vb.c2)));
  g.pattern=chance(.5)?va.pattern:vb.pattern;g.patN=5;
  const fc=mixHex(_hx(va.fin),_hx(vb.fin));
  g.finCol=new THREE.Color(fc);g.tailCol=new THREE.Color(fc);
  g.finAlpha=.95;g.shine=.55;g.eye=R(.07,.11);
  g.dorsalH=.5;g.analH=.4;g.headPow=.9;g.hump=.05;g.belly=1;
  const eco={breed:'hybrid',hybrid:breedA+'+'+breedB,stage:'baby'};
  return finishFish(g,eco,pos);
}
BREEDS.hybrid={label:'混种'};
// 按品种生成(供孵化调用): 同种→纯种幼鱼, 异种→混种
function spawnFishByBreed(breed,stage,pos){
  const cfg=NEW_SPECIES.find(s=>s.breed===breed);
  if(cfg)return spawnNewFish(cfg,stage,pos);
  if(breed==='koi')return spawnKoi(stage,pos);
  return spawnEcoFish(breed,Object.assign({},pick(PALETTES)),stage||'baby',pos);
}
function fishDie(f,cause){
  if(!f.alive)return;f.alive=false;
  Eco.waste=Math.min(1,Eco.waste+(f.stage==='adult'?0.04:0.05));
  dropFood(f.grp.position.x,f.grp.position.z,1,true); // 尸体(乌龟会清理)
  if(cause==='starve')toast('有鱼饿死了! 快投食');
  else if(cause==='env')toast('水质恶化致死! 快换水');
  else if(cause!=='eaten')toast('一条鱼死了');
  blip(200,0.2,0.08,'triangle');
}
function fishStress(f){
  let s=0;
  if(f.hunger<0.35)s+=(0.35-f.hunger)*1.4;
  if(f.hunger<0.15)s+=0.25;
  if(Eco.quality<0.45)s+=(0.45-Eco.quality)*0.9;
  if(Eco.oxygen<0.4)s+=(0.4-Eco.oxygen)*1.1;
  if(f.mode==='flee')s+=0.35;
  return clamp(s,0,1);
}
function tryBreed(f,dt){
  if(f.koi||f.stage!=='adult'||f.breedCD>0)return;
  if(f.hunger<0.35||f.hunger>0.95||Eco.quality<0.5||Eco.oxygen<0.35)return;
  if(adultsAlive()<2||eggs.length>=MAX_EGGS)return;
  let partner=null,bd=1e9;
  for(const o of fish){
    if(o===f||!o.alive||o.koi||o.stage!=='adult'||o.breedCD>0)continue;
    const d=o.grp.position.distanceTo(f.grp.position);
    if(d<bd){bd=d;partner=o;}
  }
  if(!partner||bd>8){f.courtT=0;return;}
  f.mode='court';f.target.copy(partner.grp.position);
  if(bd<3.5){
    f.courtT+=dt;
    if(f.courtT>2.2){
      const p=pick(plantClusters);
      const n=turtle.peaceful?RI(2,3):(chance(.4)?2:1);
      for(let i=0;i<n;i++)layEgg(p.x+R(-1.5,1.5),p.z+R(-1.5,1.5),f.hue,partner.hue,f.breed,partner.breed);
      f.breedCD=R(25,40);partner.breedCD=R(25,40);f.courtT=0;
      toast('鱼产卵了!');blip(520,0.15,0.09);
    }
  }else f.courtT=0;
}
const _fv=new THREE.Vector3(),_sep=new THREE.Vector3(),_ali=new THREE.Vector3(),_coh=new THREE.Vector3(),_steer=new THREE.Vector3();
function updateFish(f,dt,t){
  if(!f.alive)return;
  const P=f.grp.position,adult=f.stage==='adult';
  f.age+=dt;f.breedCD-=dt;
  if(f.biteFlash>0)f.biteFlash=Math.max(0,f.biteFlash-dt);
  // 代谢
  f.hunger=Math.max(0,f.hunger-dt*(adult?0.011:0.03));
  Eco.waste=Math.min(1,Eco.waste+dt*(adult?0.0016:0.0012));
  Eco.oxygen=Math.max(0,Eco.oxygen-dt*(adult?0.0042:0.0038));
  if(!adult&&f.age>(Eco.oxygen>0.55?16:20)){
    f.stage='adult';f.grp.scale.multiplyScalar(2.1);f.g.speed*=.9;
  }
  if(f.hunger<=0.01){f.starveT+=dt;if(f.starveT>4){fishDie(f,'starve');return;}}
  else f.starveT=0;
  if(Eco.quality<(adult?0.07:0.13)&&chance(0.05*dt)){fishDie(f,'env');return;}
  if(Eco.oxygen<(adult?0.05:0.09)&&chance(0.06*dt)){fishDie(f,'env');return;}

  // —— 行为优先级: 逃逸 > 抢食 > 求偶 > 巡游 ——
  const T=turtle.grp;
  let danger=Infinity;
  if(T&&!turtle.peaceful)danger=T.position.distanceTo(P);
  const fleeR=(f.stage==='baby'?8:6)+(turtle.frenzy?2.5:turtle.state==='hunt'?1.5:0);
  f.tt-=dt;
  f._rush=1;

  if(danger<fleeR){
    f.mode='flee';
    // 远离乌龟 + 冲向最近茂盛水草
    let bp=plantClusters[0],bs=-1,bpd=1e9;
    for(const p of plantClusters){
      const cover=p.h*p.health;
      const d=Math.hypot(p.x-P.x,p.z-P.z);
      const score=cover*3-d*0.15;
      if(score>bs){bs=score;bp=p;bpd=d;}
    }
    // 混合: 水草方向 60% + 背离乌龟 40%; 狂暴时小鱼 35% 概率躲进沉船
    if(T){
      _steer.set(P.x-T.position.x,0,P.z-T.position.z);
      if(_steer.lengthSq()>0.01)_steer.normalize();
      if(turtle.frenzy&&f.g.len<1.3&&chance(.35)){
        f.target.set(
          clamp(shelterPos.x+R(-1.5,1.5),bounds.xMin,bounds.xMax),
          clamp(shelterPos.y+R(-1,1),bounds.yMin,bounds.yMax),
          clamp(shelterPos.z+R(-1.5,1.5),bounds.zMin,bounds.zMax));
      }else f.target.set(
        clamp(bp.x+R(-1.2,1.2)+_steer.x*2.5,bounds.xMin,bounds.xMax),
        clamp(R(2,7)+_steer.y,bounds.yMin,bounds.yMax),
        clamp(bp.z+R(-1.2,1.2)+_steer.z*2.5,bounds.zMin,bounds.zMax));
    }else f.target.set(bp.x+R(-1,1),R(2,6),bp.z+R(-1,1));
    f.tt=0.6;
  }else if(f.hunger<0.85){
    // 抢食: 选最近鱼食，饥饿越狠抢得越凶；多鱼争同一粒时近者优先
    let best=null,bd=Infinity,claimers=0;
    for(const fd of food){
      if(fd.userData.eaten||fd.userData.kind!=='fish')continue;
      if(turtle.state==='hunt'&&T&&fd.position.distanceTo(T.position)<2.5)continue;
      const d=fd.position.distanceTo(P);
      // 饥饿加权: 越饿越愿意抢远的
      const score=d/(0.5+f.hunger);
      if(score<bd){bd=score;best=fd;}
    }
    if(best){
      const realD=best.position.distanceTo(P);
      f.mode='forage';f.target.copy(best.position);
      let rush=realD<3?(1.2+(1-f.hunger)*0.6):1.05;
      if(f.hunger<0.25)rush*=1.45; // 快饿死的优先抢食
      f._rush=rush;
      const eatR=adult?0.9:0.7;
      if(realD<eatR){
        // 谁先碰到谁吃
        best.userData.eaten=true;
        f.hunger=Math.min(1,f.hunger+0.42);
        if(adult)f.armor=Math.min(1,f.armor+0.15);
        scene.remove(best);food.splice(food.indexOf(best),1);
        f.dartT=Math.max(f.dartT,0.35); // 吃到后小甩尾
      }
    }else{
      if(f.mode==='forage')f.mode='cruise';
      if(f.tt<0){f.mode='cruise';newTarget(f);}
    }
  }else{
    if(f.mode==='forage'||f.mode==='flee')f.mode='cruise';
    if(f.tt<0){f.mode='cruise';newTarget(f);}
  }

  tryBreed(f,dt);

  // 品种个性: 草金爱冲刺嬉戏，扇尾稳，珍珠慢悠
  if(f.mode==='cruise'&&f.dartT<=0&&f.hunger>0.55){
    const dartChance=f.breed==='comet'?0.18:f.breed==='fantail'?0.06:0.03;
    if(chance(dt*dartChance)){
      f.dartT=f.breed==='comet'?1.2:0.7;
      const leap=f.breed==='comet'?10:5;
      f.target.set(
        clamp(P.x+R(-leap,leap),bounds.xMin,bounds.xMax),
        clamp(P.y+R(-3,3),bounds.yMin,bounds.yMax),
        clamp(P.z+R(-leap*0.6,leap*0.6),bounds.zMin,bounds.zMax));
    }
  }

  // —— Boids 三力 (分离/对齐/聚合) + 目标牵引 ——
  _sep.set(0,0,0);_ali.set(0,0,0);_coh.set(0,0,0);
  let nSep=0,nAli=0,nCoh=0;
  const sepDist=f.stage==='baby'?1.4:2.0;
  const aliDist=6.5,cohDist=9;
  for(const o of fish){
    if(o===f||!o.alive)continue;
    const op=o.grp.position;
    const dx=P.x-op.x,dy=P.y-op.y,dz=P.z-op.z;
    const d2=dx*dx+dy*dy+dz*dz;
    if(d2<0.0001)continue;
    const d=Math.sqrt(d2);
    // 分离: 太近就推开
    if(d<sepDist){
      _sep.x+=dx/d;_sep.y+=dy/d;_sep.z+=dz/d;nSep++;
    }
    // 对齐/聚合: 同品种权重更高
    const same=(o.breed===f.breed||f.koi||o.koi)?1.35:0.55;
    if(d<aliDist&&(f.mode==='cruise'||f.mode==='court')){
      _ali.x+=o.vel.x*same;_ali.y+=o.vel.y*same;_ali.z+=o.vel.z*same;nAli+=same;
    }
    if(d<cohDist&&f.mode==='cruise'){
      _coh.x+=op.x*same;_coh.y+=op.y*same;_coh.z+=op.z*same;nCoh+=same;
    }
  }
  if(nSep>0)_sep.multiplyScalar(1/nSep);
  if(nAli>0)_ali.multiplyScalar(1/nAli);
  if(nCoh>0){_coh.multiplyScalar(1/nCoh);_coh.sub(P);}

  // 目标方向
  _fv.subVectors(f.target,P);
  const dist=_fv.length();
  if(dist>0.15)_fv.normalize();
  else if(f.mode==='cruise'){_fv.set(0,0,0);if(f.tt<0.5)newTarget(f);}

  // 软边界: 靠近墙壁时向内推
  const margin=1.8;
  if(P.x<bounds.xMin+margin)_fv.x+= (bounds.xMin+margin-P.x)*0.8;
  if(P.x>bounds.xMax-margin)_fv.x+= (bounds.xMax-margin-P.x)*0.8;
  if(P.y<bounds.yMin+margin)_fv.y+= (bounds.yMin+margin-P.y)*0.6;
  if(P.y>bounds.yMax-margin)_fv.y+= (bounds.yMax-margin-P.y)*0.6;
  if(P.z<bounds.zMin+margin)_fv.z+= (bounds.zMin+margin-P.z)*0.8;
  if(P.z>bounds.zMax-margin)_fv.z+= (bounds.zMax-margin-P.z)*0.8;

  // 合成转向 (权重随模式变化)
  let wGoal=1,wSep=1.4,wAli=0.7,wCoh=0.45;
  if(f.mode==='flee'){wGoal=1.6;wSep=0.8;wAli=0.2;wCoh=0.1;}
  else if(f.mode==='forage'){wGoal=1.8;wSep=1.1;wAli=0.25;wCoh=0.15;}
  else if(f.mode==='court'){wGoal=1.4;wSep=1.0;wAli=0.5;wCoh=0.6;}
  _steer.set(0,0,0);
  _steer.addScaledVector(_fv,wGoal);
  _steer.addScaledVector(_sep,wSep);
  if(nAli>0)_steer.addScaledVector(_ali.normalize(),wAli);
  if(nCoh>0){const cl=_coh.length();if(cl>0.01)_steer.addScaledVector(_coh.multiplyScalar(1/cl),wCoh);}

  // 速度
  let sp=f.g.speed*(f.g.cruise||1);
  if(f.mode==='flee')sp*=2.15;
  else if(f.mode==='forage')sp*=1.2*(f._rush||1);
  else if(f.mode==='court')sp*=0.85;
  else sp*=0.82;
  if(Eco.quality<0.3)sp*=0.75;
  if(Eco.oxygen<0.25)sp*=0.7;
  if(f.hunger<0.2)sp*=0.65;
  if(Eco.dayTarget<0.5)sp*=0.42;
  if(f.dartT>0){f.dartT-=dt;sp*=2.0;}

  if(_steer.lengthSq()>0.0001){
    _steer.setLength(sp*1.55);
    const turn=f.mode==='flee'?2.2:f.mode==='forage'?1.4:0.75;
    f.vel.lerp(_steer,Math.min(1,dt*turn));
  }
  // 限速
  const maxSp=sp*1.8;
  const cur=f.vel.length();
  if(cur>maxSp)f.vel.multiplyScalar(maxSp/cur);

  f.vel.y*=0.988;
  P.addScaledVector(f.vel,dt);
  P.x=clamp(P.x,bounds.xMin,bounds.xMax);
  P.y=clamp(P.y,bounds.yMin,bounds.yMax);
  P.z=clamp(P.z,bounds.zMin,bounds.zMax);

  // 穿梭水草: 摇摆 + 轻微减速; 饿了会啃草
  const cover=plantCoverAt(P.x,P.z);
  const spd=f.vel.length();
  if(cover>0.15){
    plantSwayFrom(P.x,P.z,spd*0.08*dt*60);
    if(f.mode!=='flee')f.vel.multiplyScalar(1-cover*0.12*Math.min(1,dt*8));
  }
  fishGrazePlant(f,dt);

  if(f.U2){
    f.U2.uPh.value+=dt*f.g.freq*(.4+spd*.5);
    f.U2.uAmp.value=lerp(f.U2.uAmp.value,.12+Math.min(spd,4)*.09,dt*2);
  }
  if(spd>0.02){
    _m.lookAt(_o,f.vel,_up);_q.setFromRotationMatrix(_m).multiply(_yr);
    f.grp.quaternion.slerp(_q,Math.min(1,dt*(f.mode==='flee'?4:2.2)));
  }
  if(f.bodyMat){
    const s=fishStress(f);
    f.bodyMat.emissive.copy(f.baseEmissive).lerp(STRESS_EMISSIVE,s*0.55);
    if(f.biteFlash>0)f.bodyMat.emissive.lerp(BITE_EMISSIVE,Math.min(0.6,f.biteFlash));
  }
}

// ---------- 乌龟: 戏水 / 捕猎 / 换气 / 晒背 / 狂暴
// 状态: swim 戏水 | hunt 捕猎 | surface 上浮换气 | toRamp/climb/bask/slide 晒背流程 | sleep 夜眠
const turtle={grp:null,state:'swim',t:R(20,40),vel:new THREE.Vector3(),target:new THREE.Vector3(),
  climbT:0,baskQ:new THREE.Quaternion(),
  hunger:0.35,eatTimer:0,belly:0,baskTimer:R(22,32),breath:1,breathWarned:false,
  frenzy:false,frenzyTimer:0,peaceful:true,sleepPos:new THREE.Vector3()};
function turtleTarget(){turtle.target.set(R(-15,5),R(2.5,12),R(-7,7));}
// ---------- 程序化红耳龟 (100% 自有代码, 替代 turtle.glb)
// 朝向 +X 为头; 鳍带肩部枢轴, 由 animTurtle() 按状态划水
function turtleShellTexture(){
  // 红耳龟背甲俯视(按真实标本): 5枚椎盾纵列 + 4对肋盾 + 缘盾环
  // 深橄榄底, 每枚盾片中央乳黄斑, 盾缝为浅色细线, 缘盾外圈镶黄边
  const S=256,c=document.createElement('canvas');c.width=c.height=S;
  const x=c.getContext('2d'),cx=S/2,cy=S/2,R2=S/2;
  const P=(nx,ny)=>[cx+nx*R2,cy+ny*R2]; // 归一化 -> 像素(nx:头尾向,头在+; ny:左右向)
  x.fillStyle='#2b331d';x.fillRect(0,0,S,S);
  const CREAM='#d3c37e',CREAM2='#e2d694',BASE1='#414d26',BASE2='#2e3620',SEAM='#c9bb78';
  // 盾片: 多边形 + 橄榄渐变 + 中央乳黄斑 + 生长环 + 浅色缝
  function scute(pts,blotch){
    const Q=pts.map(p=>P(p[0],p[1]));
    const trace=(k)=>{ // k: 缩放画圆角多边形路径
      x.beginPath();
      const m=Q.map(q=>[cx+(q[0]-cx)*k,cy+(q[1]-cy)*k]);
      for(let i=0;i<m.length;i++){
        const a=m[i],b=m[(i+1)%m.length];
        const mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2;
        if(i===0)x.moveTo(mx,my);
        else x.quadraticCurveTo(a[0],a[1],mx,my);
      }
      x.closePath();
    };
    trace(1);
    const g=x.createRadialGradient(cx,cy,8,cx,cy,R2);
    g.addColorStop(0,BASE1);g.addColorStop(1,BASE2);
    x.fillStyle=g;x.fill();
    if(blotch){ // 中央不规则乳黄斑(大而醒目)
      const q=P(blotch[0],blotch[1]),bw=blotch[2]*R2;
      x.fillStyle='rgba(211,195,126,.9)';
      x.beginPath();
      for(let a=0;a<6.3;a+=.4){
        const rr=bw*(0.6+0.4*Math.sin(a*2.7+blotch[0]*9)+0.18*Math.sin(a*5.1));
        const px=q[0]+Math.cos(a)*rr,py=q[1]+Math.sin(a)*rr*.85;
        a?x.lineTo(px,py):x.moveTo(px,py);
      }
      x.closePath();x.fill();
      x.fillStyle='rgba(226,214,148,.55)';
      x.beginPath();x.arc(q[0],q[1],bw*.4,0,7);x.fill();
    }
    // 生长环(淡)
    x.strokeStyle='rgba(20,24,12,.22)';x.lineWidth=1;
    for(const k of [.55,.78]){trace(k);x.stroke();}
    trace(1);x.strokeStyle=SEAM;x.lineWidth=2.2;x.stroke(); // 浅色盾缝
  }
  // 5枚椎盾: 中央纵列六边形(前小后大再收)
  const vw=[.20,.26,.28,.26,.20],vh=[.30,.34,.36,.34,.28];
  for(let i=0;i<5;i++){
    const nx=-.52+i*.26,w=vw[i]/2,h=vh[i]/2;
    scute([[nx-w*.7,-h],[nx+w*.7,-h],[nx+w,-h*.25],[nx+w*.7,h],[nx-w*.7,h],[nx-w,h*.25]],
      [nx+(i%2?.02:-.02),(i%2?.03:-.03),.115]);
  }
  // 4对肋盾: 大四边形, 带环形黄斑
  for(let i=0;i<4;i++){
    const nx=-.40+i*.27,w=.13;
    for(const s of [1,-1]){
      const y0=.20*s,y1=.66*s;
      scute([[nx-w,y0],[nx+w,y0],[nx+w*.85,y1],[nx-w*.85,y1]],[nx,y0+(y1-y0)*.45,.14]);
    }
  }
  // 缘盾环: 22枚, 外圈镶黄边 + 暗斑
  for(let i=0;i<22;i++){
    const a0=i/22*Math.PI*2,a1=(i+1)/22*Math.PI*2,am=(a0+a1)/2;
    const r0=.72,r1=.99;
    x.beginPath();
    x.arc(cx,cy,r0*R2,a0,a1);x.arc(cx,cy,r1*R2,a1,a0,true);x.closePath();
    x.fillStyle=i%2?BASE1:BASE2;x.fill();
    // 外圈黄边
    x.strokeStyle=CREAM2;x.lineWidth=3;
    x.beginPath();x.arc(cx,cy,.965*R2,a0+.02,a1-.02);x.stroke();
    // 暗斑
    x.fillStyle='rgba(25,30,15,.55)';
    x.beginPath();x.arc(cx+Math.cos(am)*.85*R2,cy+Math.sin(am)*.85*R2,7,0,7);x.fill();
    x.strokeStyle=SEAM;x.lineWidth=1.6;x.stroke();
  }
  // 颈盾: 前端中央小盾
  scute([[.78,-.09],[.9,-.09],[.9,.09],[.78,.09]],[.84,0,.04]);
  // 噪点
  for(let i=0;i<600;i++){x.fillStyle=`rgba(0,0,0,${R(.03,.08)})`;
    x.fillRect(R(0,S),R(0,S),2,2);}
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}
function turtleHeadTexture(){
  // 头颈: 深绿底 + 明黄细纹
  const c=document.createElement('canvas');c.width=256;c.height=128;
  const x=c.getContext('2d');
  x.fillStyle='#2e4423';x.fillRect(0,0,256,128);
  x.strokeStyle='rgba(214,206,110,.9)';x.lineWidth=2.5;
  for(let i=0;i<9;i++){const y=8+i*14;
    x.beginPath();x.moveTo(0,y);
    x.bezierCurveTo(70,y+R(-6,6),150,y+R(-6,6),256,y+R(-4,4));x.stroke();}
  x.strokeStyle='rgba(214,206,110,.45)';x.lineWidth=1.2;
  for(let i=0;i<9;i++){const y=14+i*14;
    x.beginPath();x.moveTo(0,y);x.lineTo(256,y+R(-4,4));x.stroke();}
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}
function buildTurtle(){
  const grp=new THREE.Group();
  const headTex=turtleHeadTexture();
  const skin=new THREE.MeshStandardMaterial({map:headTex,roughness:.7});
  const skinDark=new THREE.MeshStandardMaterial({color:0x2e4423,roughness:.75});
  // 背甲
  const shellGeo=new THREE.SphereGeometry(1,36,18,0,Math.PI*2,0,Math.PI*.58);
  { // 顶部平面UV: 俯视即背甲图
    const pp=shellGeo.attributes.position,uv=shellGeo.attributes.uv;
    for(let i=0;i<pp.count;i++)uv.setXY(i,pp.getX(i)*.5+.5,pp.getZ(i)*.5+.5);
  }
  const shell=new THREE.Mesh(shellGeo,
    new THREE.MeshStandardMaterial({map:turtleShellTexture(),roughness:.55}));
  shell.scale.set(1.62,.62,1.12);shell.position.y=.3;
  shell.castShadow=true;grp.add(shell);
  // 腹甲: 黄色
  const plastron=new THREE.Mesh(new THREE.SphereGeometry(1,24,16),
    new THREE.MeshStandardMaterial({color:0xd0b268,roughness:.6}));
  plastron.scale.set(1.42,.3,.92);plastron.position.y=-.02;
  grp.add(plastron);
  // 头 (+X)
  const headG=new THREE.Group();headG.position.set(1.78,.3,0);grp.add(headG);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.34,20,16),skin);
  head.scale.set(1.3,.95,.85);head.castShadow=true;headG.add(head);
  const snout=new THREE.Mesh(new THREE.SphereGeometry(.2,16,12),skin);
  snout.position.set(.34,-.05,0);snout.scale.set(1.15,.8,.8);headG.add(snout);
  // 红耳斑: 招牌大红斑
  const earM=new THREE.MeshStandardMaterial({color:0xd42a20,roughness:.55,
    emissive:0x550a06,emissiveIntensity:.35});
  for(const s of [1,-1]){
    const ear=new THREE.Mesh(new THREE.SphereGeometry(.12,14,12),earM);
    ear.position.set(-.02,.12,s*.3);ear.scale.set(1.5,1,.45);headG.add(ear);
    // 金眼
    const iris=new THREE.Mesh(new THREE.SphereGeometry(.085,12,10),
      new THREE.MeshStandardMaterial({color:0xc09030,roughness:.25}));
    iris.position.set(.24,.16,s*.21);headG.add(iris);
    const pup=new THREE.Mesh(new THREE.SphereGeometry(.045,10,8),
      new THREE.MeshStandardMaterial({color:0x080808,roughness:.1}));
    pup.position.set(.29,.16,s*.23);headG.add(pup);
  }
  // 尾
  const tail=new THREE.Mesh(new THREE.ConeGeometry(.11,.5,10),skinDark);
  tail.rotation.z=Math.PI/2+.3;tail.position.set(-1.72,.12,0);grp.add(tail);
  // 鳍: 肩部枢轴 + 扁平鳍片 + 爪
  const flippers={};
  const mkFin=(name,px,py,pz,len,wid)=>{
    const piv=new THREE.Group();piv.position.set(px,py,pz);grp.add(piv);
    const fin=new THREE.Mesh(new THREE.SphereGeometry(1,14,10),skin);
    fin.scale.set(len*.3,.09,wid);fin.position.set(0,0,(pz>0?1:-1)*len*.45);
    fin.castShadow=true;piv.add(fin);
    // 爪: 3 趾
    for(let ci=-1;ci<=1;ci++){
      const claw=new THREE.Mesh(new THREE.ConeGeometry(.045,.2,8),
        new THREE.MeshStandardMaterial({color:0xd8cc9a,roughness:.5}));
      claw.rotation.x=pz>0?-Math.PI/2:Math.PI/2;
      claw.position.set(ci*.12,0,(pz>0?1:-1)*(len*.45+wid*.75));
      piv.add(claw);
    }
    flippers[name]=piv;
  };
  mkFin('FL',.95,.02,1.02,1.2,.52);mkFin('FR',.95,.02,-1.02,1.2,.52);
  mkFin('BL',-.95,0,.88,.85,.42);mkFin('BR',-.95,0,-.88,.85,.42);
  grp.userData.flippers=flippers;grp.userData.head=headG;
  grp.traverse(o=>{if(o.isMesh)o.castShadow=true;});
  return grp;
}
// 鳍划水动画: 按状态调频率/幅度; 晒背/睡眠时收拢
function animTurtle(dt,t){
  const T=turtle;if(!T.grp||!T.grp.userData.flippers)return;
  const F=T.grp.userData.flippers;
  let freq=0,amp=0,rest=0;
  if(T.state==='swim'){freq=2.2;amp=.55;}
  else if(T.state==='hunt'){freq=T.frenzy?5:3.4;amp=.7;}
  else if(T.state==='surface'||T.state==='toRamp'){freq=2.6;amp=.6;}
  else if(T.state==='climb'){freq=1.2;amp=.35;}
  else if(T.state==='slide'){freq=3;amp=.5;}
  else{rest=.5;} // bask / sleep 收鳍
  T._pad=(T._pad||0)+dt*freq;
  const p=T._pad;
  const set=(o,ph,base)=>{
    const target=rest?base+rest:base+Math.sin(p+ph)*amp;
    o.rotation.x+=(target-o.rotation.x)*Math.min(1,dt*8);
  };
  set(F.FL,0,-.15);set(F.FR,Math.PI,-.15);
  set(F.BL,Math.PI*.5,-.1);set(F.BR,Math.PI*1.5,-.1);
  // 头部: 游动时微摆, 晒背时抬头
  const head=T.grp.userData.head;
  if(head){
    const hy=T.state==='bask'?.35:Math.sin(t*1.3)*.08;
    head.rotation.y+=(hy-head.rotation.y)*Math.min(1,dt*3);
    head.rotation.z+=(((T.state==='bask'||T.state==='sleep')?.25:0)-head.rotation.z)*Math.min(1,dt*3);
  }
}
{
  const wrap=buildTurtle();
  turtle.grp=wrap;
  wrap.position.set(-6,6,2);turtleTarget();turtle.t=R(25,45);
  scene.add(wrap);
}
function turtleFindPrey(){
  // 乌龟只吃龟粮/废物；狂暴时追逐鱼但不吃；不吃普通鱼食
  const T=turtle.grp.position;let bt=null,bd=Infinity,kind=null;
  // 优先龟粮
  for(const fd of food){
    if(fd.userData.eaten)continue;
    if(fd.userData.kind==='turtle'||fd.userData.corpse){
      const d=fd.position.distanceTo(T)+(fd.userData.corpse?-1.5:0);
      if(d<bd){bd=d;bt=fd;kind=fd.userData.corpse?'corpse':'turtleFood';}
    }
  }
  // 狂暴：追逐最近的鱼（仅追逐，不设为可吃）
  if(turtle.frenzy){
    for(const f of fish){
      if(!f.alive)continue;
      const d=f.grp.position.distanceTo(T);
      if(d<bd){bd=d;bt=f;kind='chase';}
    }
  }
  // 有废物时标记去“吸废”（虚拟目标）
  if(Eco.waste>0.08&&!turtle.frenzy){
    // 若没有龟粮更近，则去水底扫废物
    if(kind!=='turtleFood'||bd>6){
      const wx=R(-14,5),wz=R(-6.5,6.5);
      const d=Math.hypot(wx-T.x,wz-T.z)+2;
      if(d<bd||kind===null){
        bd=d;kind='waste';
        bt={position:new THREE.Vector3(wx,1.2,wz),isWaste:true};
      }
    }
  }
  return bt?{target:bt,dist:bd,kind}:null;
}
function turtleEat(target,kind){
  if(kind==='chase'){
    // 狂暴只追逐惊吓，不吃鱼
    turtle.eatTimer=0.35;
    blip(180,0.08,0.06);
    return;
  }
  if(kind==='turtleFood'||kind==='corpse'||kind==='food'){
    if(target.userData){target.userData.eaten=true;scene.remove(target);food.splice(food.indexOf(target),1);}
    turtle.hunger=clamp(turtle.hunger-(kind==='turtleFood'?0.45:0.25),0,1);
    turtle.belly=Math.min(1,turtle.belly+(kind==='turtleFood'?0.4:0.2));
    if(kind==='corpse'){Eco.waste=Math.max(0,Eco.waste-0.04);Stats.statClean++;saveAch();}
    if(Stats.statClean>=10)unlockAch('cleaner10');
    toast(kind==='turtleFood'?'乌龟吃了龟粮':'乌龟清理了残渣');
  }else if(kind==='waste'){
    const before=Eco.waste;
    Eco.waste=Math.max(0,Eco.waste-0.12);
    turtle.hunger=clamp(turtle.hunger-0.22,0,1);
    turtle.belly=Math.min(1,turtle.belly+0.15);
    Stats.statClean++;saveAch();
    if(Stats.statClean>=10)unlockAch('cleaner10');
    if(before>0.05)toast('乌龟在吃废物');
  }
  turtle.eatTimer=turtle.frenzy?0.25:0.5;
  blip(220,0.1,0.08);
}
const _tv=new THREE.Vector3(),_tq=new THREE.Quaternion(),_tm=new THREE.Matrix4(),
  _tup=new THREE.Vector3(0,1,0),_tyr=new THREE.Quaternion().setFromAxisAngle(_tup,Math.PI/2),_to=new THREE.Vector3();
function faceVel(obj,vel,k,dt){
  if(vel.lengthSq()>.0004){_tm.lookAt(_to,vel,_tup);_tq.setFromRotationMatrix(_tm).multiply(_tyr);
    obj.quaternion.slerp(_tq,Math.min(1,dt*k));}}
function updateTurtle(dt,t){
  const T=turtle;if(!T.grp)return;const P=T.grp.position;
  if(T.eatTimer>0)T.eatTimer-=dt;
  const night=Eco.dayTarget<0.5;
  if(T.frenzy){ // 狂暴 20 秒
    T.frenzyTimer-=dt;
    if(T.frenzyTimer<=0){T.frenzy=false;
      if(night){T.state='sleep';T.sleepPos.set(R(-12,4),0.8,R(-5,5));}
      toast('乌龟冷静下来了');}
  }
  T.hunger=clamp(T.hunger+dt*0.01,0,1);
  // —— 呼吸: 水下持续耗气(约50秒), 睡眠极慢; 水面/晒背快速回气 ——
  const under=T.state!=='surface'&&T.state!=='bask'&&T.state!=='climb'&&T.state!=='slide';
  if(under)T.breath=Math.max(0,T.breath-dt*(T.state==='sleep'?0.004:0.02));
  else T.breath=Math.min(1,T.breath+dt*0.6);
  if(T.breath<0.25&&under){
    T.state='surface';T.t=3;
    if(!T.breathWarned){T.breathWarned=true;toast('乌龟上浮换气');}
  }else if(T.breath>0.9)T.breathWarned=false;
  // —— 日行性: 夜晚沉底睡觉(不捕猎=和平) ——
  if(night&&!T.frenzy&&(T.state==='swim'||T.state==='hunt')){
    T.state='sleep';T.sleepPos.set(R(-12,4),0.8,R(-5,5));
  }
  if(!night&&T.state==='sleep')T.state='surface'; // 天亮先上浮换气
  T.peaceful=(T.state==='bask'||T.state==='surface'||T.state==='sleep')&&!T.frenzy;
  if(T.frenzy&&T.state!=='hunt'&&under)T.state='hunt';

  if(T.state==='sleep'){
    T.target.copy(T.sleepPos);
    _tv.subVectors(T.target,P).setLength(0.25);T.vel.lerp(_tv,dt*.5);
    P.addScaledVector(T.vel,dt);faceVel(T.grp,T.vel,1.5,dt);
  }else if(T.state==='swim'){
    if(!T.frenzy&&T.hunger>0.55)T.state='hunt';
    else{
      T.baskTimer-=dt;
      if(T.baskTimer<=0)T.state='surface';
      else{
        T.t-=dt;
        if(T.t<0||P.distanceTo(T.target)<1.5){turtleTarget();T.t=R(6,12);}
        _tv.subVectors(T.target,P).setLength(1.1);T.vel.lerp(_tv,dt*.5);
        P.addScaledVector(T.vel,dt);
        P.x=clamp(P.x,-16,6.2);P.y=clamp(P.y,1.8,13.5);P.z=clamp(P.z,-7.5,7.5);
        faceVel(T.grp,T.vel,2,dt);
          }
    }
  }else if(T.state==='hunt'){
    const found=turtleFindPrey();
    if(found){
      const tp=found.kind==='egg'?found.target.mesh.position
        :(found.target.position||(found.target.grp&&found.target.grp.position)||found.target);
      if(tp&&tp.x!==undefined)T.target.copy(tp);
      const rr=found.kind==='chase'?2.2:found.kind==='waste'?1.8:1.5;
      const d=P.distanceTo(T.target);
      if(d<rr){
        if(found.kind==='chase'){
          // 追上只惊吓，不吃；并趁机吞一口废物
          turtleEat(found.target,'chase');
          if(Eco.waste>0.05){Eco.waste=Math.max(0,Eco.waste-0.08);T.hunger=clamp(T.hunger-0.12,0,1);}
        }else turtleEat(found.target,found.kind);
      }
    }else if(P.distanceTo(T.target)<1.5){turtleTarget();}
    // 狂暴时持续清理废物
    if(T.frenzy&&Eco.waste>0){
      T._wasteEat=(T._wasteEat||0)+dt;
      if(T._wasteEat>1.2){T._wasteEat=0;Eco.waste=Math.max(0,Eco.waste-0.06);T.hunger=clamp(T.hunger-0.08,0,1);}
    }
    if(!T.frenzy){
      if(T.hunger<0.2)T.state='swim';
      T.baskTimer-=dt;
      if(T.baskTimer<=0)T.state='surface';
    }
    _tv.subVectors(T.target,P).setLength(T.frenzy?3.6:2.2);T.vel.lerp(_tv,dt*.8);
    P.addScaledVector(T.vel,dt);
    P.x=clamp(P.x,-16,6.2);P.y=clamp(P.y,1,15);P.z=clamp(P.z,-7.5,7.5);
    faceVel(T.grp,T.vel,3,dt);
  }else if(T.state==='surface'){
    T.target.set(ISLAND.cx-2,TANK.water-1.2,0); // 水面换气(岛边)
    _tv.subVectors(T.target,P).setLength(1.6);T.vel.lerp(_tv,dt*.8);
    P.addScaledVector(T.vel,dt);faceVel(T.grp,T.vel,2.5,dt);
    if(P.distanceTo(T.target)<1.6){
      if(night){T.state='sleep';T.sleepPos.set(R(-12,4),0.8,R(-5,5));}
      else{T.state='toRamp';}
    }
  }else if(T.state==='toRamp'){
    _tv.subVectors(RAMP_A,P).setLength(1.6);T.vel.lerp(_tv,dt*.8);
    P.addScaledVector(T.vel,dt);faceVel(T.grp,T.vel,2.5,dt);
    if(P.distanceTo(RAMP_A)<1.4){T.state='climb';T.climbT=0;}
  }else if(T.state==='climb'){
    T.climbT+=dt/9;
    const ct=Math.min(1,T.climbT);
    const k=ct<.5?2*ct*ct:1-Math.pow(-2*ct+2,2)/2;
    RAMP_CURVE.getPoint(k,P);
    RAMP_CURVE.getTangent(k,_tv);T.vel.copy(_tv);
    faceVel(T.grp,T.vel,3,dt);
    if(T.climbT>=1){T.state='bask';T.t=R(20,40);T.baskQ.copy(T.grp.quaternion);unlockAch('bask');}
  }else if(T.state==='bask'){
    T.t-=dt;
    T.hunger=Math.max(0,T.hunger-dt*0.03); // 晒太阳消化
    T.belly=Math.max(0,T.belly-dt*0.05);
    P.copy(RAMP_B);P.y+=Math.sin(t*.8)*.05;
    T.grp.quaternion.slerp(T.baskQ,Math.min(1,dt*1.5));
    if(T.t<0){T.state='slide';T.climbT=0;}
  }else if(T.state==='slide'){
    T.climbT+=dt/3.5;
    const k=Math.min(1,T.climbT);
    RAMP_CURVE.getPoint(1-k*k,P);
    RAMP_CURVE.getTangent(Math.max(0,1-k),_tv);_tv.negate();T.vel.copy(_tv);
    faceVel(T.grp,T.vel,3,dt);
    if(T.climbT>=1){T.state='swim';T.t=R(30,60);T.baskTimer=R(22,32);turtleTarget();}
  }
  // 乌龟经过水草会拨动
  if(T.state==='swim'||T.state==='hunt'||T.frenzy){
    plantSwayFrom(P.x,P.z,(T.frenzy?0.35:0.18)*dt*60);
  }
}
// ---------- 微粒与气泡
const moteGeo=new THREE.BufferGeometry();
{
  const N=1500,pos=new Float32Array(N*3);
  for(let i=0;i<N;i++){
    pos[i*3]=R(-17,17);pos[i*3+1]=R(0,17);pos[i*3+2]=R(-8.5,8.5);
  }
  moteGeo.setAttribute('position',new THREE.BufferAttribute(pos,3));
}
const moteMat=new THREE.PointsMaterial({color:0xffffff,size:.05,
  transparent:true,opacity:.4,depthWrite:false});
scene.add(new THREE.Points(moteGeo,moteMat));
const bubGeo=new THREE.SphereGeometry(.07,10,8);
const bubMat=new THREE.MeshPhysicalMaterial({color:0xffffff,roughness:0,
  transparent:true,opacity:.35,clearcoat:1});
const bubbles=[];
const bubbleSrc=[new THREE.Vector3(-13,.2,-5),new THREE.Vector3(-6,.2,6)];
for(let i=0;i<70;i++){
  const b=new THREE.Mesh(bubGeo,bubMat),s=bubbleSrc[i%2];
  b.position.set(s.x+R(-.3,.3),R(0,16),s.z+R(-.3,.3));
  b.scale.setScalar(R(.4,1.6));
  b.userData.s=i%2;
  scene.add(b);bubbles.push(b);
}

// ---------- food (鱼食 / 龟粮 外观区分; 尸体可被乌龟清理)
const foodGeo=new THREE.IcosahedronGeometry(.09,0),
  foodMat=new THREE.MeshStandardMaterial({color:0xc07a2e,roughness:.9}), // 鱼食: 棕橙小粒
  turtleFoodMat=new THREE.MeshStandardMaterial({color:0x3d8b5a,roughness:.55,emissive:0x1a4030,emissiveIntensity:.35}), // 龟粮: 青绿较大
  rotMat=new THREE.MeshStandardMaterial({color:0x8a6a3a,roughness:.95});
const turtleFoodGeo=new THREE.CylinderGeometry(.11,.14,.07,8);
function dropFood(x,z,n,kind){
  // kind: 'fish' | 'turtle' | true(corpse legacy)
  n=n||1;
  const isCorpse=kind===true||kind==='corpse';
  const isTurtle=kind==='turtle';
  for(let i=0;i<n;i++){
    const m=new THREE.Mesh(
      isTurtle?turtleFoodGeo:(foodGeo),
      isCorpse?rotMat:(isTurtle?turtleFoodMat:foodMat)
    );
    m.position.set(x+R(-1.5,1.5),TANK.water-.5,(z??R(-4,4))+R(-1.5,1.5));
    m.userData={w:R(0,6),eaten:false,age:0,corpse:isCorpse,kind:isCorpse?'corpse':(isTurtle?'turtle':'fish')};
    if(isCorpse)m.scale.setScalar(1.7);
    if(isTurtle){m.scale.setScalar(1.4);m.rotation.z=R(0,1);}
    scene.add(m);food.push(m);
  }
}
// 点一下够 3 条鱼吃; 鱼都吃饱(或缸内鱼食已够)后再点 = 龟粮
const FISH_PER_FEED=3;
function feed(x,z){
  const alive=fish.filter(f=>f.alive);
  const hungry=alive.filter(f=>f.hunger<0.88).length;
  const fishFoodLeft=food.filter(f=>!f.userData.eaten&&f.userData.kind==='fish').length;
  // 还缺鱼食: 投放 3 粒鱼食(约够 3 条)
  if(hungry>fishFoodLeft){
    dropFood(x,z,FISH_PER_FEED,'fish');
    toast('鱼食 x'+FISH_PER_FEED+(alive.length?` (约够${FISH_PER_FEED}条)`:''));
  }else{
    dropFood(x,z,2,'turtle');
    toast('龟粮');
  }
}
function updateFood(dt,t){
  let w=0;
  for(let i=0;i<food.length;i++){
    const f=food[i];
    if(f.userData.eaten)continue;
    if(f.position.y>0.15){
      f.position.y-=dt*.8;
      f.position.x+=Math.sin(t*1.5+f.userData.w)*.005;
    }else{
      f.userData.age+=dt;
      if(f.userData.age>12){ // 烂掉 → 废物
        Eco.waste=Math.min(1,Eco.waste+(f.userData.corpse?0.05:0.02));
        scene.remove(f);continue;
      }
      if(f.userData.age>6&&!f.userData.corpse){f.material=rotMat;} // 残饵变色
    }
    f.rotation.x+=dt;
    food[w++]=f;
  }
  food.length=w;
  if(food.length>160)scene.remove(food.shift());
}
// ---------- eggs (产卵/孵化/颜色遗传)
const eggs=[];
const eggGeo=new THREE.SphereGeometry(.17,12,10),
  eggMatBase=new THREE.MeshStandardMaterial({color:0xffe6b4,roughness:.35,transparent:true,opacity:.88,
    emissive:0x664422,emissiveIntensity:.25});
function layEgg(x,z,hueA,hueB,breedA,breedB){
  if(eggs.length>=MAX_EGGS)return;
  const m=new THREE.Mesh(eggGeo,eggMatBase.clone());
  m.position.set(x+R(-.8,.8),R(3,9),z+R(-.8,.8));
  scene.add(m);
  eggs.push({mesh:m,x:m.position.x,z:m.position.z,age:0,hatchIn:R(10,15),alive:true,
    hueA:hueA||PALETTES[0],hueB:hueB||PALETTES[1],breedA:breedA||'comet',breedB:breedB||'comet'});
}
function updateEggs(dt,t){
  let w=0;
  for(let i=0;i<eggs.length;i++){
    const e=eggs[i];
    if(!e.alive){scene.remove(e.mesh);continue;}
    e.age+=dt;
    e.mesh.scale.setScalar(1+Math.sin(t*4+e.x)*0.08);
    if(Eco.quality<0.25&&chance(0.2*dt)){scene.remove(e.mesh);continue;} // 水质太差卵坏死
    if(e.age>=e.hatchIn){
      scene.remove(e.mesh);
      if(fish.filter(f=>f.alive).length<MAX_FISH&&Eco.quality>0.3){
        const pos=e.mesh.position.clone();
        if(e.breedA!==e.breedB){
          spawnHybridFish(e.breedA,e.breedB,pos);
          toast('混种小鱼孵化了!');unlockAch('hybrid');
        }else{
          spawnFishByBreed(e.breedA,'baby',pos);
          toast('小鱼孵化了!');
        }
        unlockAch('first_hatch');
        blip(700,0.12,0.08);
      }
      continue;
    }
    eggs[w++]=e;
  }
  eggs.length=w;
}
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

// ---------- main loop
const clock=new THREE.Clock(),_v=new THREE.Vector3(),_q=new THREE.Quaternion(),_m=new THREE.Matrix4(),
  _up=new THREE.Vector3(0,1,0),_yr=new THREE.Quaternion().setFromAxisAngle(_up,Math.PI/2),_o=new THREE.Vector3();

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
  updateHUD(rdt);
  UI.saveT+=rdt;if(UI.saveT>5){UI.saveT=0;saveGame();} // 5秒自动存档
  if(View.fx)composer.render();else renderer.render(scene,camera);
  if(UI.firstFrame){UI.firstFrame=false;
    setTimeout(()=>{const l=$('loading');l.style.opacity=0;setTimeout(()=>l.remove(),900);
      maybeOnboard();
      setTimeout(()=>$('hint').style.opacity=0,9000);},900);}
  requestAnimationFrame(tick);
}

// ---------- HUD: toast / 警报 / 水状态仪表盘
const toastEl=$('toast'),alertEl=$('alert');

function toast(msg){
  if(UI.toastQ.length>2)UI.toastQ.shift();
  UI.toastQ.push(msg);
  if(!UI.toastTimer)nextToast();
}
function nextToast(){
  const m=UI.toastQ.shift();
  if(!m){UI.toastTimer=null;return;}
  toastEl.textContent=m;toastEl.classList.add('show');
  UI.toastTimer=setTimeout(()=>{
    toastEl.classList.remove('show');
    UI.toastTimer=setTimeout(nextToast,300);
  },1500);
}
const dashEl=$('dash');
$('dashPill').onclick=e=>{e.stopPropagation();dashEl.classList.toggle('open');};
const barColor=v=>v>0.55?'#3dcc7a':v>0.3?'#d4a017':'#d4452f';
function advice(){
  const tips=[];
  if(Eco.waste>0.55&&!Eco.filterOn)tips.push('开过滤');
  if(Eco.waste>0.7)tips.push('换水');
  if(Eco.oxygen<0.35)tips.push('缺氧');
  if(food.filter(f=>!f.userData.eaten&&!f.userData.corpse&&f.userData.age>6).length>2)tips.push('残饵多');
  const hungry=fish.filter(f=>f.alive&&f.hunger<0.25).length;
  if(hungry)tips.push(hungry+'条鱼饿');
  if(fish.filter(f=>f.alive).length>=MAX_FISH)tips.push('已满员');
  return tips.slice(0,2).join(' · ')||'生态稳定 🌿';
}

function updateHUD(dt){
  UI.hudT-=dt;if(UI.hudT>0)return;UI.hudT=0.25;
  const q=Math.round(Eco.quality*100),o=Math.round(Eco.oxygen*100),w=Math.round(Eco.waste*100);
  $('qFill').style.width=q+'%';$('qFill').style.background=barColor(Eco.quality);$('qVal').textContent=q+'%';
  $('oFill').style.width=o+'%';
  $('oFill').style.background=Eco.oxygen>0.55?'#5ec8ff':Eco.oxygen>0.3?'#d4a017':'#d4452f';
  $('oVal').textContent=o+'%';
  $('wFill').style.width=w+'%';
  $('wFill').style.background=Eco.waste>0.6?'#d4452f':Eco.waste>0.35?'#d4a017':'#3dcc7a';
  $('wVal').textContent=w+'%';
  const alive=fish.filter(f=>f.alive).length;
  const babies=fish.filter(f=>f.alive&&f.stage==='baby').length;
  $('fishVal').textContent='鱼 '+alive+(babies?'(幼'+babies+')':'')+(eggs.length?' 卵'+eggs.length:'');
  $('advice').textContent=advice();
  $('dQ').style.background=barColor(Eco.quality);
  $('dO').style.background=Eco.oxygen>0.55?'#5ec8ff':Eco.oxygen>0.3?'#d4a017':'#d4452f';
  $('dW').style.background=Eco.waste>0.6?'#d4452f':Eco.waste>0.35?'#d4a017':'#3dcc7a';
  // 药丸显示最差项: 哪里出问题一眼看到
  const bad=[['水质',1-Eco.quality,q+'%'],['氧气',1-Eco.oxygen,o+'%'],['废物',Eco.waste,w+'%']];
  bad.sort((a,b)=>b[1]-a[1]);
  $('dashMini').textContent=bad[0][0]+bad[0][2];
  let msg='';
  if(Eco.quality<0.18)msg='水质危险! 请换水';
  else if(Eco.oxygen<0.2)msg='严重缺氧! 请开过滤';
  else if(fish.some(f=>f.alive&&f.hunger<0.12))msg='有鱼快饿死了!';
  $('dashPill').classList.toggle('warn',!!msg);
  if(msg){alertEl.textContent=msg;alertEl.classList.add('show');}
  else alertEl.classList.remove('show');
}

// ---------- 工具栏弹窗
const openSheet=()=>{$('sheet').classList.add('open');$('sheetBg').classList.add('open');};
const closeSheet=()=>{$('sheet').classList.remove('open');$('sheetBg').classList.remove('open');};
function feedAction(){feed(R(-10,2),R(-5,5));blip(620,0.1,0.08);}
function waterAction(){
  Eco.waste*=0.45;Eco.oxygen=Math.min(1,Eco.oxygen+0.25);
  Stats.statWater++;saveAch();
  if(Stats.statWater>=10)unlockAch('water10');
  toast('已换水, 水质提升');blip(360,0.15,0.09);
}
function filterAction(){
  Eco.filterOn=!Eco.filterOn;
  $('bFilter').classList.toggle('on',Eco.filterOn);
  toast(Eco.filterOn?'过滤已开启':'过滤已关闭');
  blip(Eco.filterOn?500:280,0.12,0.09);
}
function addFishAction(){
  const f=spawnRandomFish();
  if(!f){toast('鱼缸满了!');blip(180,0.15,0.08);return;}
  toast('新'+(BREEDS[f.breed]?BREEDS[f.breed].label:'鱼')+'入缸!');blip(640,0.12,0.09);
}
function dayAction(){
  Eco.dayTarget=Eco.dayTarget>0.5?0:1;
  $('bDay').classList.toggle('on',!!Eco.dayTarget);
  toast(Eco.dayTarget?'白天':'夜晚');blip(Eco.dayTarget?700:300,0.15,0.09);
}
$('bFeed').onclick=feedAction;
$('bFish').onclick=addFishAction;
$('bWater').onclick=waterAction;
$('bFilter').onclick=filterAction;
$('bDay').onclick=dayAction;
$('bFx').onclick=e=>{View.fx=!View.fx;const b=e.currentTarget;
  b.classList.toggle('on',View.fx);toast(View.fx?'特效已开':'特效已关');};
$('bTrim').onclick=()=>trimPlants();
$('bFrenzy').onclick=()=>{
  if(!turtle.grp)return;
  turtle.frenzy=true;turtle.frenzyTimer=20;turtle.state='hunt';
  toast('乌龟狂暴20秒! 追逐鱼并吞废物');
  closeSheet();blip(140,0.3,0.12,'sawtooth');
};
$('bFs').onclick=()=>{closeSheet();document.documentElement.requestFullscreen?.();};
$('bResetT').onclick=()=>{
  showConfirm('重置鱼缸？','所有鱼、水质、存档将清空，回到开缸状态。',()=>{
    try{localStorage.removeItem(SAVE_KEY);}catch(e){}
    try{localStorage.removeItem('tank_onboarded');}catch(e){}
    location.reload();
  });
};
// ---------- 确认弹窗(商用标准: 危险操作二次确认)

function showConfirm(title,desc,onOk){
  $('cfTitle').textContent=title;$('cfDesc').textContent=desc;
  UI.cfOk=onOk;$('confirm').classList.add('show');
}
$('cfCancel').onclick=()=>{$('confirm').classList.remove('show');UI.cfOk=null;};
$('cfOk').onclick=()=>{$('confirm').classList.remove('show');if(UI.cfOk)UI.cfOk();UI.cfOk=null;};
// ---------- 设置: 音效 / 高清
try{Sfx.on=localStorage.getItem('tank_sound')!=='0';}catch(e){}
const _swS=$('bSound');if(_swS){
  _swS.classList.toggle('on',Sfx.on);
  _swS.onclick=()=>{Sfx.on=!Sfx.on;_swS.classList.toggle('on',Sfx.on);
    try{localStorage.setItem('tank_sound',Sfx.on?'1':'0');}catch(e){}
    setAmbient(Sfx.on);
    if(Sfx.on)blip(600,0.1,0.06);};
}

try{View.hdOn=localStorage.getItem('tank_hd')!=='0';}catch(e){}
const _swH=$('bHD');if(_swH){
  _swH.classList.toggle('on',View.hdOn);
  const applyHD=()=>renderer.setPixelRatio(View.hdOn?Math.min(devicePixelRatio,2):1);
  applyHD();
  _swH.onclick=()=>{View.hdOn=!View.hdOn;_swH.classList.toggle('on',View.hdOn);applyHD();
    try{localStorage.setItem('tank_hd',View.hdOn?'1':'0');}catch(e){}};
}
// ---------- 新手引导(首次运行)
const OB_STEPS=[
  {e:'👆',t:'投食',d:'点一下水面，就能在点击处投食。鱼儿会自己游过来吃。'},
  {e:'🔄',t:'旋转缩放',d:'单指拖动旋转视角，双指或滚轮缩放。10 秒不动会自动环绕。'},
  {e:'🧰',t:'鱼缸管家',d:'点工具箱或长按鱼缸打开管家：投食、加鱼、换水、昼夜都在里面。'},
];

function showObStep(){
  const s=OB_STEPS[UI.obStep];
  $('obEmoji').textContent=s.e;$('obTitle').textContent=s.t;$('obDesc').textContent=s.d;
  const dots=$('obDots').children;
  for(let i=0;i<dots.length;i++)dots[i].classList.toggle('on',i===UI.obStep);
  $('obNext').textContent=UI.obStep===OB_STEPS.length-1?'开始养鱼':'下一步';
}
function closeOnboard(){
  $('onboard').classList.remove('show');
  try{localStorage.setItem('tank_onboarded','1');}catch(e){}
}
$('obNext').onclick=()=>{
  blip(700,0.08,0.05);
  if(UI.obStep<OB_STEPS.length-1){UI.obStep++;showObStep();}
  else closeOnboard();
};
$('obSkip').onclick=closeOnboard;
function maybeOnboard(){
  let done=false;
  try{done=!!localStorage.getItem('tank_onboarded');}catch(e){}
  if(!done){UI.obStep=0;showObStep();$('onboard').classList.add('show');}
}
$('sheetBg').onclick=closeSheet;
$('bAch').onclick=()=>{
  closeSheet();
  $('achList').innerHTML=ACHS.map(a=>
    `<div class="arow${Stats.achGot[a.id]?' got':''}"><span class="ic">${a.icon}</span>`+
    `<span><div class="nm">${a.name}</div><div class="ds">${a.desc}</div></span></div>`).join('');
  $('ach').classList.add('show');blip(600,0.08,0.05);
};
$('achX').onclick=()=>$('ach').classList.remove('show');
$('ach').addEventListener('click',e=>{if(e.target.id==='ach')$('ach').classList.remove('show');});
// 顶部工具箱按钮: 点按开关管家(去X后靠它+点背景关闭)
$('bToolbox').onclick=e=>{e.stopPropagation();
  $('sheet').classList.contains('open')?closeSheet():openSheet();};
document.addEventListener('contextmenu',e=>e.preventDefault());

// ---------- 存档(localStorage, 5秒自动)
const SAVE_KEY='fishtank-3d-save-v1';

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

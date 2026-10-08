import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';

const R=(a,b)=>a+Math.random()*(b-a), RI=(a,b)=>Math.floor(R(a,b+1)), pick=a=>a[Math.floor(Math.random()*a.length)], chance=p=>Math.random()<p;
const $=id=>document.getElementById(id);
const clamp=THREE.MathUtils.clamp, lerp=THREE.MathUtils.lerp;

const IS_MOBILE=/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)||Math.min(innerWidth,innerHeight)<500;

const Eco   = { waste:0.22, quality:0.9, oxygen:0.85, filterOn:true,
                dayNight:1, dayTarget:1,
                autoWaterCD:0, autoFeedCD:0, autoFishCD:0, autoTrimCD:0,
                autoWatering:false };
const Sfx   = { on:true, ac:null, ambNodes:null };
const View  = { fx:true, hdOn:!IS_MOBILE, wreckBubbleT:0 };
const Stats = { achGot:{}, statClean:0, statWater:0 };
const UI    = { idleT:0, toastTimer:null, toastQ:[], hudT:0,
                cfOk:null, obStep:0, saveT:0, firstFrame:true,
                pdown:null, lpTimer:null, lpFired:false, mag:null };
const Creatures = { genomeId:0 };
function getAC(){
  if(!Sfx.ac)Sfx.ac=new (window.AudioContext||window.webkitAudioContext)();
  if(Sfx.ac.state==='suspended')Sfx.ac.resume();
  return Sfx.ac;
}
function blip(freq=480,dur=0.14,vol=0.08,type='sine'){
  if(!Sfx.on)return;
  try{
    getAC();
    const t0=Sfx.ac.currentTime,o=Sfx.ac.createOscillator(),g=Sfx.ac.createGain();
    o.type=type;o.frequency.setValueAtTime(freq,t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(40,freq*0.6),t0+dur);
    g.gain.setValueAtTime(0.001,t0);
    g.gain.exponentialRampToValueAtTime(vol,t0+0.012);
    g.gain.exponentialRampToValueAtTime(0.001,t0+dur);
    o.connect(g).connect(Sfx.ac.destination);o.start(t0);o.stop(t0+dur+0.02);
  }catch(_){}
}

const MAX_FISH=36, MAX_EGGS=8;

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
  blip(880,0.25,0.1);
}

function setAmbient(on){
  if(on&&Sfx.on){
    if(Sfx.ambNodes||!window.AudioContext&&!window.webkitAudioContext)return;
    try{
      getAC();
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

// ===== 场景尺寸 =====
const TANK={w:36,d:18,h:20.5,water:17};
const ISLAND={cx:12.5,cz:0,r:5,top:18.9};

const RAMP_PTS=[
  new THREE.Vector3(4.6,2.2,0.3),new THREE.Vector3(6.0,4.6,0.1),
  new THREE.Vector3(7.2,7.4,-0.2),new THREE.Vector3(8.4,10.6,0.2),
  new THREE.Vector3(9.6,13.6,-0.2),new THREE.Vector3(10.8,16.0,0.1),
  new THREE.Vector3(12.1,ISLAND.top+0.35,0)];
const RAMP_CURVE=new THREE.CatmullRomCurve3(RAMP_PTS);
const RAMP_A=RAMP_PTS[0].clone();
const RAMP_B=RAMP_PTS[RAMP_PTS.length-1].clone();

// ===== 渲染器 / 相机 / 后期 =====
const renderer=new THREE.WebGLRenderer({powerPreference:'high-performance'});
renderer.setPixelRatio(IS_MOBILE?1:Math.min(devicePixelRatio,2));
renderer.setSize(innerWidth,innerHeight);
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.2;
renderer.shadowMap.enabled=!IS_MOBILE;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();
  toast('GPU休息一下,正在恢复…','urgent');setTimeout(()=>location.reload(),1500);});
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
  renderer.setSize(innerWidth,innerHeight);composer.setPixelRatio(renderer.getPixelRatio());composer.setSize(innerWidth,innerHeight)});

const composer=new EffectComposer(renderer);
composer.addPass(new RenderPass(scene,camera));
const bloom=new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),.32,.55,.85);
bloom.enabled=!IS_MOBILE;
composer.addPass(bloom);

const grade=new ShaderPass({uniforms:{tDiffuse:{value:null},uTime:{value:0},uTint:{value:new THREE.Color(1,1,1)},uMurk:{value:0}},
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader:`uniform sampler2D tDiffuse;uniform float uTime;uniform vec3 uTint;uniform float uMurk;varying vec2 vUv;
  float g_hash(vec2 p){p=fract(p*vec2(234.34,435.345));p+=dot(p,p+34.23);return fract(p.x*p.y);}
  void main(){
    vec2 d=vUv-.5;float r2=dot(d,d);
    vec2 bend=d*r2*.014;
    vec3 col;
    col.r=texture2D(tDiffuse,vUv+bend).r;
    col.g=texture2D(tDiffuse,vUv).g;
    col.b=texture2D(tDiffuse,vUv-bend).b;
    float lum=dot(col,vec3(.299,.587,.114));
    vec3 shadowTint=vec3(.88,.97,1.01);
    vec3 hiTint=vec3(1.03,1.0,.96);
    col=mix(col*shadowTint,col*hiTint,smoothstep(.12,.75,lum));
    col=mix(col,col*uTint,.28);
    col=mix(col,col*vec3(.82,.95,.62),uMurk*.45);
    col*=1.-r2*1.15;
    float gr=g_hash(vUv*913.7+fract(uTime)*37.)-.5;
    col+=gr*.028;
    gl_FragColor=vec4(max(col,vec3(0.)),1.);
  }`});
composer.addPass(grade);
composer.addPass(new OutputPass());

const U={uTime:{value:0},uCaus:{value:1},uMurk:{value:0}};

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

// ===== 灯光 / 背景 / 沙地 / 水面 / 缸体 =====
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

const fillLights=[];
for(const [fx,fy,fz] of [[-12,22,-6],[8,22,-6],[-12,22,6],[8,22,6],[-2,24,0]]){
  const pl=new THREE.PointLight(0xfff0e0,1.5,42,1.5);
  pl.position.set(fx,fy,fz);
  scene.add(pl);
  fillLights.push(pl);
}

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

const surf=new THREE.Mesh(new THREE.PlaneGeometry(TANK.w+.4,TANK.d+.4,1,1).rotateX(Math.PI/2),
  new THREE.ShaderMaterial({uniforms:U,transparent:true,depthWrite:false,
    blending:THREE.AdditiveBlending,side:THREE.DoubleSide,
    vertexShader:`varying vec3 vW;
      void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;
        gl_Position=projectionMatrix*viewMatrix*w;}`,
    fragmentShader:`uniform float uTime;uniform float uCaus;varying vec3 vW;
      ${causticGLSL}
      void main(){
        float fadeX=1.-smoothstep(17.6,18.2,abs(vW.x));
        float fadeZ=1.-smoothstep(8.6,9.2,abs(vW.z));
        float fade=fadeX*fadeZ;
        float web=caustic(vW.xz*.32+vec2(uTime*.06,0.));
        gl_FragColor=vec4(vec3(.82,.95,1.)*(.07+web*.28)*uCaus*fade,1.);
      }`}));
surf.position.y=TANK.water;scene.add(surf);

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

{
  const glassMat=new THREE.MeshPhysicalMaterial({
    color:0xeaf6ff,transparent:true,opacity:.16,
    roughness:.03,metalness:0,
    transmission:IS_MOBILE?0:.92,thickness:.35,ior:1.45,
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
  const rimMat=new THREE.MeshStandardMaterial({color:0x9fd8ff,roughness:.2,metalness:.6,
    emissive:0x2a4a5a,emissiveIntensity:.4});
  const RT=.06,RH=.04;
  const rimBar=(w,d,px,pz)=>{
    const m=new THREE.Mesh(new THREE.BoxGeometry(w,RH,d),rimMat);
    m.position.set(px,TANK.water,pz);scene.add(m);
  };
  rimBar(TANK.w+.2,RT,0,-hd-.03);rimBar(TANK.w+.2,RT,0,hd+.03);
  rimBar(RT,TANK.d+.2,-hw-.03,0);rimBar(RT,TANK.d+.2,hw+.03,0);
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
  const stand=new THREE.Mesh(new THREE.BoxGeometry(TANK.w+2.4,7,TANK.d+2.4),
    new THREE.MeshStandardMaterial({color:0x2c1f12,roughness:.8}));
  stand.position.y=-3.6;scene.add(stand);
}

const hsl=(h,s,l)=>new THREE.Color().setHSL(((h%1)+1)%1,s,l);

// ===== 装饰: 石头 / 水草 / 酒桶 / 贝壳 / 晒背岛 =====
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

for(let i=0;i<10;i++){const r=rock(R(.7,2.2));const x=R(-16,5.5),z=R(-7.5,7.5);
  if(Math.abs(x+11)<6.2&&Math.abs(z-2)<4.2)continue;
  r.position.set(x,R(-.3,.1),z);r.scale.y*=.7;decor.add(r)}

const BARREL={x:-11,z:2,rot:.45,L:2.6,R:2.0};

function shelterSpot(along,across,yLo,yHi){
  const u=R(-along,along),v=R(-across,across),c=Math.cos(BARREL.rot),s=Math.sin(BARREL.rot);
  return new THREE.Vector3(BARREL.x+u*c+v*s,R(yLo,yHi),BARREL.z-u*s+v*c);
}
{
  const {L,R:Rm}=BARREL;
  const rAt=x=>Rm*(1-.2*(x/L)*(x/L));
  const woodTex=(()=>{
    const c=document.createElement('canvas');c.width=256;c.height=128;
    const g=c.getContext('2d');g.fillStyle='#4a3626';g.fillRect(0,0,256,128);
    for(let i=0;i<90;i++){g.fillStyle=`rgba(${R(120,190)|0},${R(80,120)|0},${R(40,70)|0},${R(.12,.32)})`;
      g.fillRect(R(0,256),R(0,128),R(30,120),R(1,3));}
    for(let i=0;i<40;i++){g.fillStyle=`rgba(20,12,8,${R(.2,.45)})`;g.fillRect(R(0,256),R(0,128),R(20,80),R(1,2));}
    for(let i=0;i<34;i++){g.fillStyle=`rgba(${R(170,205)|0},${R(80,105)|0},${R(35,55)|0},${R(.25,.5)})`;
      g.beginPath();g.ellipse(R(0,256),R(0,128),R(6,26),R(2,7),0,0,6.3);g.fill();}
    const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;
  })();
  const mossTex=(()=>{
    const c=document.createElement('canvas');c.width=128;c.height=128;
    const g=c.getContext('2d');g.fillStyle='#62b238';g.fillRect(0,0,128,128);
    for(let i=0;i<900;i++){const l=chance(.5);
      g.fillStyle=l?`rgba(160,230,90,${R(.25,.6)})`:`rgba(40,100,30,${R(.25,.55)})`;
      g.fillRect(R(0,128),R(0,128),R(1,3),R(1,3));}
    const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;
  })();
  const wood1=new THREE.MeshStandardMaterial({map:woodTex,color:0xb8a090,roughness:.9,side:THREE.DoubleSide});
  const wood2=new THREE.MeshStandardMaterial({map:woodTex,color:0x8f7864,roughness:.95,side:THREE.DoubleSide});
  const liner=new THREE.MeshStandardMaterial({color:0x1b140f,roughness:1,side:THREE.DoubleSide});
  const hoopMat=new THREE.MeshStandardMaterial({color:0x9a5a30,roughness:.9,metalness:.15});
  const mossMat=new THREE.MeshStandardMaterial({map:mossTex,color:0x8fd460,roughness:1});
  const barrel=new THREE.Group();
  function stave(a0,a1,x0,x1,mat,j0,j1){
    const nu=6,nv=3,pos=[],uv=[],idx=[];
    for(let i=0;i<=nu;i++)for(let j=0;j<=nv;j++){
      let x=x0+(x1-x0)*i/nu;
      if(j0&&i===0)x+=R(-.3,.3);
      if(j1&&i===nu)x+=R(-.3,.3);
      const r=rAt(x),a=a0+(a1-a0)*j/nv;
      pos.push(x,r*Math.sin(a),r*Math.cos(a));uv.push((x+L)/(2*L)*2,j/nv);
    }
    for(let i=0;i<nu;i++)for(let j=0;j<nv;j++){const p=i*(nv+1)+j,q=p+nv+1;idx.push(p,q,p+1,p+1,q,q+1);}
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    g.setIndex(idx);g.computeVertexNormals();
    barrel.add(new THREE.Mesh(g,mat));
  }
  const N=16,da=Math.PI*2/N;
  const HOLE={0:1.9,1:1.6,2:.9,15:1.4};
  for(let k=0;k<N;k++){
    const a0=k*da+.012,a1=(k+1)*da-.012,mat=k%2?wood2:wood1;
    if(HOLE[k]!==undefined){
      const hw=HOLE[k]+R(-.15,.15),cx=-.2;
      stave(a0,a1,-L,cx-hw,mat,false,true);
      stave(a0,a1,cx+hw,L,mat,true,false);
    }else stave(a0,a1,-L,L,mat,false,false);
  }
  const pts=[];for(let i=0;i<=12;i++){const x=-L+2*L*i/12;pts.push(new THREE.Vector2(rAt(x)*.93,x));}
  barrel.add(new THREE.Mesh(new THREE.LatheGeometry(pts,28).rotateZ(Math.PI/2),liner));
  for(const sx of [-1,1]){
    const re=rAt(sx*L);
    const ring=new THREE.Mesh(new THREE.RingGeometry(re*.93,re*1.005,32).rotateY(Math.PI/2),wood2);
    ring.position.x=sx*L;barrel.add(ring);
    const hoop=new THREE.Mesh(new THREE.TorusGeometry(rAt(sx*(L-.45))+.03,.07,6,40),hoopMat);
    hoop.rotation.y=Math.PI/2;hoop.position.x=sx*(L-.45);barrel.add(hoop);
  }
  function mossBlob(x,a,sx,sy,sz){
    const g=new THREE.IcosahedronGeometry(1,2),p=g.attributes.position;
    for(let i=0;i<p.count;i++){const k=R(.82,1.18);p.setXYZ(i,p.getX(i)*k,p.getY(i)*k,p.getZ(i)*k);}
    g.computeVertexNormals();
    const m=new THREE.Mesh(g,mossMat),r=rAt(x)+.03;
    m.position.set(x,r*Math.sin(a),r*Math.cos(a));
    m.rotation.x=Math.PI/2-a;m.rotation.y=R(0,6);
    m.scale.set(sx,sy,sz);barrel.add(m);
  }
  for(const x of [-1.6,-.3,1.1])mossBlob(x+R(-.2,.2),R(1.4,1.9),R(.45,.65),R(.16,.24),R(.45,.65));
  barrel.position.set(BARREL.x,Rm-.12,BARREL.z);barrel.rotation.y=BARREL.rot;
  barrel.traverse(o=>{if(o.isMesh){o.castShadow=o.receiveShadow=true}});
  decor.add(barrel);
}

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

const wreckBubblePos=new THREE.Vector3(-11,1.4,2);

function updateWreckBubbles(dt){
  View.wreckBubbleT-=dt;
  if(View.wreckBubbleT<=0){
    View.wreckBubbleT=R(6,12);
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

{
  const isl=new THREE.Group();
  const put=(x,y,z,s,sy)=>{const r=rock(s);r.position.set(x,y,z);r.scale.y=sy||1;isl.add(r)};
  put(12.5,15.2,0,4.6,.75);put(10.6,13.6,1.8,3.2,.7);put(14.6,13.8,-1.6,3.4,.7);
  put(11.8,16.6,-2.2,2.4,.7);put(13.8,16.8,2,2.6,.72);put(12.4,17.6,0,2.8,.62);
  put(9.2,11.8,-.6,2.6,.75);put(8,8.6,.8,2.8,.8);put(7,5.4,-.4,2.6,.85);put(6.4,2.6,.2,2.2,.9);
  isl.traverse(o=>{if(o.isMesh){o.castShadow=o.receiveShadow=true}});
  scene.add(isl);
}

const plantClusters=[];
const SICK_LEAF=new THREE.Color(0x8a7a3a);
{
  const greens=[hsl(.29,.6,.32),hsl(.33,.55,.28),hsl(.25,.65,.36),hsl(.36,.5,.3)];
  function addCluster(cx,cz,blades,bh,bw){
    const grp=new THREE.Group();grp.position.set(cx,0,cz);decor.add(grp);
    const c={x:cx,z:cz,grp,h:0.55,hVis:0.55,health:1,baseH:1,blades:[],sway:0,swayDir:0,flash:0,growPulse:0,windPhase:R(0,6.28),windSpeed:R(.7,1.3)};
    for(let j=0;j<blades;j++){
      const col=pick(greens).clone().offsetHSL(R(-.02,.02),0,R(-.06,.06));
      const b=blade(col,R(bh*.4,bh),R(bw*.6,bw));
      b.position.set(R(-.9,.9),0,R(-.9,.9));b.rotation.y=R(0,6);
      b.userData.baseCol=b.material.color.clone();
      b.userData.uGrow.value=0.35+R(0,0.25);
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
function plantCoverAt(x,z){
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
    if(p.h>prev+1e-6)p.growPulse=Math.min(1,(p.growPulse||0)+dt*2.5);
    else p.growPulse=Math.max(0,(p.growPulse||0)-dt*0.8);
    const overgrown=p.h>p.baseH*1.35;
    const purify=overgrown?0.004:0.0065;
    Eco.waste=Math.max(0,Eco.waste-p.h*p.health*purify*dt);
    Eco.oxygen=clamp(Eco.oxygen+p.h*p.health*(Eco.dayNight>0.5?0.032:-0.006)*dt,0,1);
    if(overgrown)Eco.waste=Math.min(1,Eco.waste+0.0015*dt*p.h);
    if(Eco.quality<0.3)p.health=Math.max(0.1,p.health-0.012*dt);
    else p.health=Math.min(1,p.health+0.012*dt);
    p.hVis+=(p.h-p.hVis)*Math.min(1,dt*(p.h<p.hVis?6.5:1.8));
    const hv=p.hVis;
    const fat=0.92+Math.min(1,hv/Math.max(0.2,p.baseH))*0.12;
    p.grp.scale.set(fat,hv,fat);
    p.sway=(p.sway||0)*Math.max(0,1-dt*2.2);
    p.swayDir=(p.swayDir||0)*Math.max(0,1-dt*1.2);
    const flow=(Eco.filterOn?1.35:0.85)*(0.75+Eco.dayNight*0.35);
    const idle=0.22*flow;
    const hit=Math.min(0.7,p.sway||0);
    const swayAmt=idle+hit;
    const ph=p.windPhase+tNow*p.windSpeed;
    p.grp.rotation.z=Math.sin(ph)*0.07*swayAmt*3.2 + Math.sin(ph*0.37)*0.025*swayAmt;
    p.grp.rotation.x=Math.cos(ph*0.82)*0.045*swayAmt*3.0 + Math.sin(ph*1.1+1.2)*0.02*swayAmt;
    p.grp.rotation.y=Math.sin(ph*0.45+p.windPhase)*0.04*swayAmt;
    if(p.flash>0)p.flash=Math.max(0,p.flash-dt);
    const sickK=(1-p.health)*0.75;
    const growK=p.growPulse||0;
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
      if(b.userData.uBend){
        const leafWind=0.9+0.35*Math.sin(phase*4+tNow*0.3);
        const bendT=(0.85*flow*leafWind)+growK*0.35+hit*0.9;
        b.userData.uBend.value+=(bendT-b.userData.uBend.value)*Math.min(1,dt*2.5);
      }
      b.rotation.z=Math.sin(tNow*(0.9+phase)+phase*5)*0.06*swayAmt;
      b.rotation.x=Math.cos(tNow*(0.7+phase*0.5)+phase)*0.04*swayAmt;
      b.material.color.copy(b.userData.baseCol).lerp(SICK_LEAF,sickK);
      const fl=p.flash||0;
      const ge=growK*0.12*(Eco.dayNight>0.4?1:0.3);
      b.material.emissive.setRGB(0.04*fl+0.02*ge,0.22*fl+0.18*ge,0.06*fl+0.04*ge);
    }
    p.grp.visible=p.hVis>0.05;
  }
}
function trimPlants(silent){
  let n=0;
  for(const p of plantClusters)if(p.h>p.baseH*0.7){p.h*=0.62;Eco.waste=Math.min(1,Eco.waste+0.012);n++;p.flash=0.8;p.sway=(p.sway||0)+1.2;}
  if(!silent)toast(n?'已修剪 '+n+' 丛水草':'水草还不需要修剪','manual');
  blip(420,0.12,0.09);
}

function interactPlant(p){
  if(!p)return false;
  p.flash=1.0;p.sway=(p.sway||0)+1.5;
  if(p.h>p.baseH*1.2){
    p.h*=0.55;Eco.waste=Math.min(1,Eco.waste+0.01);
    toast('修剪了这丛水草','manual');blip(400,0.1,0.08);return true;
  }
  if(p.health<0.75){
    p.health=Math.min(1,p.health+0.28);
    Eco.oxygen=Math.min(1,Eco.oxygen+0.04);
    p.growPulse=1;
    p.h=Math.min(p.baseH*1.2,p.h+0.08);
    toast('照料水草 状态好转','manual');blip(520,0.1,0.08);return true;
  }
  Eco.oxygen=Math.min(1,Eco.oxygen+0.015);
  toast('拨动了水草','manual');blip(360,0.06,0.05);return true;
}

function fishGrazePlant(f,dt){
  if(f.hunger>0.55||f.mode==='flee')return;
  const hit=nearestPlant(f.grp.position.x,f.grp.position.z);
  if(!hit||hit.dist>plantRadius(hit.plant)*0.85)return;
  const p=hit.plant;
  if(p.h<0.35||p.health<0.2)return;
  const rate=f.stage==='baby'?0.04:0.025;
  p.h=Math.max(0.2,p.h-rate*dt);
  p.sway=(p.sway||0)+dt*0.8;
  f.hunger=Math.min(1,f.hunger+rate*dt*1.8);
  Eco.waste=Math.min(1,Eco.waste+0.002*dt);
  if(chance(dt*0.15))f.mode='forage';
}

// ===== 取暖灯 =====
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

// ===== 鱼: 基因 / 贴图 / 建模 / 生成 =====
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
  const pal=pick([
    [hsl(.07,.85,.55),hsl(.07,.85,.62)],
    [hsl(.08,.9,.5),hsl(0,0,.92)],
    [hsl(0,0,.12),hsl(.07,.7,.45)],
    [hsl(0,0,.95),hsl(.07,.85,.55)],
    [hsl(.35,.45,.4),hsl(.35,.5,.55)],
  ]);
  g.c1=pal[0];g.c2=pal[1];
  g.pattern=pick(['plain','vbars','spots','gradient','mottled','hstripe']);
  g.patN=RI(2,6);g.finCol=chance(.5)?g.c1:g.c2;g.tailCol=chance(.3)?g.c2:g.finCol;
  g.eye=R(.07,.12);g.shine=R(.2,.8);
  g.school=g.len<.9&&chance(.6);g.speed=R(.7,1.2);g.freq=R(5,8);
  return g;}

function genGenomeFor(breed,hue){
  const B=(BREEDS[breed]&&BREEDS[breed].len)?BREEDS[breed]:BREEDS.comet,g=genGenome();
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
  if(P==='koi'){
    x.globalAlpha=1;
    const patch=(cx,cy,rw,rh)=>{x.beginPath();x.ellipse(cx,cy,rw,rh,R(-.3,.3),0,7);x.fill();};
    patch(W*.88,H*.40,W*.09,H*.24);
    const n=4+(Math.random()*3|0);
    for(let i=0;i<n;i++)patch(R(W*.15,W*.78),R(H*.22,H*.78),R(W*.04,W*.09),R(H*.12,H*.26));
    x.globalAlpha=.3;
    for(let i=0;i<n*10;i++){x.beginPath();x.arc(R(0,W),R(H*.2,H*.8),R(2,7),0,7);x.fill();}
  }
  if(P==='clown'){
    x.globalAlpha=1;
    for(const bx of [W*.78,W*.52,W*.28]){
      x.fillStyle='#111';x.fillRect(bx-W*.035,0,W*.07,H);
      x.fillStyle='#f8f8f8';x.fillRect(bx-W*.022,0,W*.044,H);
    }
  }
  if(P==='bluetang'){
    x.globalAlpha=1;
    x.fillStyle='#0d1b2a';
    x.beginPath();x.moveTo(W*.95,H*.5);
    x.bezierCurveTo(W*.7,H*.05,W*.45,H*.15,W*.35,H*.5);
    x.bezierCurveTo(W*.45,H*.85,W*.7,H*.95,W*.95,H*.5);x.fill();
    const yg=x.createLinearGradient(W*.18,0,0,0);
    yg.addColorStop(0,'rgba(250,200,40,0)');yg.addColorStop(1,'rgba(250,200,40,.95)');
    x.fillStyle=yg;x.fillRect(0,0,W*.2,H);
  }
  if(P==='yellowtang'){
    x.globalAlpha=.15;x.fillStyle='#fff';
    for(let i=0;i<30;i++){x.beginPath();x.arc(R(0,W),R(0,H),R(3,9),0,7);x.fill();}
  }
  if(P==='royalgramma'){
    const rg=x.createLinearGradient(W,0,0,0);
    rg.addColorStop(0,'rgba(120,60,180,.85)');rg.addColorStop(.55,'rgba(120,60,180,.25)');
    rg.addColorStop(1,'rgba(250,200,60,.55)');
    x.globalAlpha=1;x.fillStyle=rg;x.fillRect(0,0,W,H);
  }
  if(P==='mandarin'){
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
  if(P==='moorish'){
    x.globalAlpha=.92;x.fillStyle='#151515';
    for(const bx of [W*.72,W*.45]){
      x.beginPath();x.moveTo(bx,0);x.lineTo(bx+W*.09,0);
      x.lineTo(bx+W*.05,H);x.lineTo(bx-W*.04,H);x.closePath();x.fill();
    }
    x.globalAlpha=.8;x.fillStyle='#f0c030';x.fillRect(W*.86,0,W*.05,H);
  }
  if(P==='shark'){
    const sg=x.createLinearGradient(0,0,0,H);
    sg.addColorStop(0,'rgba(70,90,110,.9)');sg.addColorStop(.55,'rgba(70,90,110,.15)');
    sg.addColorStop(.62,'rgba(255,255,255,.1)');sg.addColorStop(1,'rgba(240,240,240,.75)');
    x.globalAlpha=1;x.fillStyle=sg;x.fillRect(0,0,W,H);
  }
  if(P==='angelfish'){
    x.globalAlpha=.9;x.fillStyle='#1a1a1a';
    for(const bx of [W*.78,W*.58,W*.38,W*.18]){
      x.beginPath();x.moveTo(bx,0);x.lineTo(bx+W*.05,0);
      x.lineTo(bx+W*.03,H);x.lineTo(bx-W*.02,H);x.closePath();x.fill();
    }
  }
  if(P==='guppy'){
    const gg=x.createLinearGradient(W,0,0,0);
    gg.addColorStop(0,'rgba(255,110,30,.9)');gg.addColorStop(.5,'rgba(60,200,220,.55)');
    gg.addColorStop(1,'rgba(40,120,220,.35)');
    x.globalAlpha=1;x.fillStyle=gg;x.fillRect(0,0,W,H);
    x.globalAlpha=.8;
    for(let i=0;i<14;i++){x.fillStyle=pick(['#ff4040','#40ff80','#ffff40','#ff40c0']);
      x.beginPath();x.arc(R(W*.2,W*.8),R(H*.2,H*.8),R(3,8),0,7);x.fill();}
  }
  if(P==='neon'){
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
const swimChunk=`vec3 transformed=position;float k=clamp(.45-position.x/uLen,0.,1.4);transformed.z+=sin(uPh-position.x*5./uLen)*k*k*uAmp*uLen*.3;`;
function swimMaterial(mat,U2){mat.onBeforeCompile=s=>{Object.assign(s.uniforms,U2);
  s.vertexShader='uniform float uPh;uniform float uAmp;uniform float uLen;\n'+s.vertexShader.replace('#include <begin_vertex>',swimChunk)};return mat;}
function buildFish(g){
  const L=g.len,H=g.h,Wd=g.w,U2={uPh:{value:R(0,6)},uAmp:{value:.3},uLen:{value:L}};
  const body=new THREE.SphereGeometry(1,IS_MOBILE?24:48,IS_MOBILE?16:24),p=body.attributes.position,uv=body.attributes.uv;
  for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i);const t=(y+1)/2;
    let prof=Math.pow(Math.max(0,Math.sin(Math.PI*Math.pow(t,g.headPow))),.75);
    prof*=Math.min(1,t<.15?.35+t*4.3:1);
    const top=x>0?(1+g.hump*Math.sin(Math.PI*t)):g.belly;
    p.setXYZ(i,y*L/2,x*H/2*prof*top,z*Wd/2*prof);uv.setXY(i,t,(x+1)/2);}
  body.computeVertexNormals();
  const bp={map:fishTexture(g),roughness:.32,metalness:.06};
  if(!IS_MOBILE)Object.assign(bp,{clearcoat:1,clearcoatRoughness:.25,iridescence:g.shine,iridescenceIOR:1.4,sheen:.4,sheenColor:g.c2});
  const mat=swimMaterial(new (IS_MOBILE?THREE.MeshStandardMaterial:THREE.MeshPhysicalMaterial)(bp),U2);
  const grp=new THREE.Group(),bm=new THREE.Mesh(body,mat);bm.castShadow=true;grp.add(bm);
  const finMat=col=>swimMaterial(new (IS_MOBILE?THREE.MeshStandardMaterial:THREE.MeshPhysicalMaterial)({map:finTexture(col),transparent:true,opacity:g.finAlpha,
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
  const er=Math.max(H*.12,L*g.eye*.5);
  for(const s of [1,-1]){const e=new THREE.Group();
    e.add(new THREE.Mesh(new THREE.SphereGeometry(er,20,14),EYE_IRIS));
    const pu=new THREE.Mesh(new THREE.SphereGeometry(er*.62,16,12),EYE_PUPIL);pu.position.z=s*er*.5;e.add(pu);
    e.position.set(L*.34,H*.1,s*Wd*.36*.9);e.scale.z=.6;grp.add(e)}
  return {grp,U2,bodyMat:mat};}

const fish=[],food=[];
const bounds={xMin:-16.5,xMax:6.8,yMin:1,yMax:15,zMin:-8,zMax:8};
const BMIN=new THREE.Vector3(bounds.xMin,bounds.yMin,bounds.zMin),BMAX=new THREE.Vector3(bounds.xMax,bounds.yMax,bounds.zMax);
const aliveCount=()=>fish.filter(f=>f.alive).length;
const adultsAlive=()=>fish.filter(f=>f.alive&&f.stage==='adult').length;
const STRESS_EMISSIVE=new THREE.Color(0xb05a28);
function addFishEntry(grp,U2,g,eco){
  const f=Object.assign({g,grp,U2,bodyMat:null,
    vel:new THREE.Vector3(R(-1,1),R(-.1,.1),R(-.3,.3)).setLength(g.speed*1.5),
    target:new THREE.Vector3(),tt:0,alive:true,
    stage:'adult',age:R(20,60),hunger:R(.35,.6),
    breedCD:R(10,20),courtT:0,starveT:0,mode:'cruise',dartT:0,breed:null,hue:null,koi:false},
    eco||{});
  newTarget(f);scene.add(grp);fish.push(f);return f;}
function newTarget(f){
  const night=Eco.dayTarget<0.5,P=f.grp.position;
  const lowO=Eco.oxygen<0.25;
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
  if(!lowO&&!f.koi&&f.g.len<1.3&&chance(.33)){
    f.target.copy(shelterSpot(3.6,1.6,1.0,3.0));
  }
  f.tt=R(3.5,8);
}
function removeFish(f){scene.remove(f.grp);f.grp.traverse(o=>{o.geometry?.dispose?.();if(o.material){o.material.map?.dispose?.();o.material.dispose?.()}});
  fish.splice(fish.indexOf(f),1);}

function finishFish(g,eco,pos){
  const {grp,U2,bodyMat}=buildFish(g);
  grp.position.copy(pos||new THREE.Vector3(R(-12,0),R(3,10),R(-5,5)));
  const f=addFishEntry(grp,U2,g,Object.assign({bodyMat,
    hunger:eco.stage==='baby'?0.55:R(.35,.6),age:eco.stage==='baby'?0:R(20,60)},eco));
  f.baseEmissive=bodyMat.emissive.clone();
  return f;
}
function babyScale(g,stage){if(stage==='baby'){g.len*=.45;g.h*=.45;g.w*=.45;}}

function spawnEcoFish(breed,hue,stage,pos){
  breed=breed||pick(['comet','fantail','pearl']);hue=hue||pick(PALETTES);
  const g=genGenomeFor(breed,hue);
  babyScale(g,stage);
  return finishFish(g,{breed,hue,stage:stage||'adult'},pos);
}

function spawnKoi(stage,pos){
  const g=genGenome();
  g.body='torpedo';g.tail='fork';
  g.len=R(1.5,1.9);g.h=g.len*R(.2,.26);g.w=g.len*R(.16,.2);
  g.tailLen=R(.35,.5);g.tailH=R(.8,1.1);
  g.speed=R(.8,1.1);g.freq=4;g.cruise=1;g.school=false;
  g.c1=new THREE.Color(0xf7f4ec);g.c2=new THREE.Color(0xd8401f);
  g.pattern='koi';g.patN=5;
  g.finCol=new THREE.Color(0xf0e8dc);g.tailCol=new THREE.Color(0xe8ddcc);
  g.finAlpha=.95;g.shine=.6;
  g.dorsalH=.5;g.analH=.4;g.eye=R(.07,.11);g.headPow=.85;g.hump=.1;g.belly=1;
  babyScale(g,stage);
  return finishFish(g,{breed:'koi',koi:true,stage:stage||'adult'},pos);
}

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

function spawnRandomFish(){
  if(aliveCount()>=MAX_FISH)return null;
  const r=Math.random();
  let f;
  if(r<0.27){
    f=spawnEcoFish(pick(['comet','fantail','pearl']),Object.assign({},pick(PALETTES)),'adult');
  }else if(r<0.36){
    f=spawnKoi('adult');
  }else{
    f=spawnNewFish();
  }
  if(f)f.grp.scale.setScalar(1.2);
  return f;
}

function speciesVisual(breed){
  const cfg=NEW_SPECIES.find(s=>s.breed===breed);
  if(cfg)return{c1:cfg.c1,c2:cfg.c2,pattern:cfg.pattern,fin:cfg.fin};
  if(breed==='koi')return{c1:0xf7f4ec,c2:0xd8401f,pattern:'koi',fin:0xf0e8dc};
  const h=pick(PALETTES);
  return{c1:parseInt(h.light.slice(1),16),c2:parseInt(h.dark.slice(1),16),pattern:null,fin:parseInt(h.light.slice(1),16)};
}
const _hx=n=>'#'+n.toString(16).padStart(6,'0');

function spawnHybridFish(breedA,breedB,pos){
  const va=speciesVisual(breedA),vb=speciesVisual(breedB);
  const g=genGenome();
  g.body='torpedo';g.tail=chance(.5)?'fork':'round';
  g.len=R(.9,1.4);g.h=g.len*R(.26,.36);g.w=g.len*R(.15,.19);
  babyScale(g,'baby');
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

function spawnFishByBreed(breed,stage,pos){
  const cfg=NEW_SPECIES.find(s=>s.breed===breed);
  if(cfg)return spawnNewFish(cfg,stage,pos);
  if(breed==='koi')return spawnKoi(stage,pos);
  if(!BREEDS[breed]||!BREEDS[breed].len)breed=pick(['comet','fantail','pearl']);
  return spawnEcoFish(breed,Object.assign({},pick(PALETTES)),stage||'baby',pos);
}
// ===== 鱼: 行为 =====
function fishDie(f,cause){
  if(!f.alive)return;f.alive=false;
  Eco.waste=Math.min(1,Eco.waste+(f.stage==='adult'?0.025:0.03));
  dropFood(f.grp.position.x,f.grp.position.z,1,true);
  if(cause==='starve')toast('有鱼饿死了! 快投食','urgent');
  else if(cause==='env')toast('水质恶化致死! 快换水','urgent');
  else if(cause!=='eaten')toast('一条鱼死了','urgent');
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
      blip(520,0.15,0.09);
    }
  }else f.courtT=0;
}
const _fv=new THREE.Vector3(),_sep=new THREE.Vector3(),_ali=new THREE.Vector3(),_coh=new THREE.Vector3(),_steer=new THREE.Vector3(),_tv=new THREE.Vector3();
const _q=new THREE.Quaternion(),_m=new THREE.Matrix4(),_up=new THREE.Vector3(0,1,0),_yr=new THREE.Quaternion().setFromAxisAngle(_up,Math.PI/2),_o=new THREE.Vector3();
function updateFish(f,dt,t){
  if(!f.alive)return;
  const P=f.grp.position,adult=f.stage==='adult';
  f.age+=dt;f.breedCD-=dt;
  f.hunger=Math.max(0,f.hunger-dt*(adult?0.005:0.011));
  Eco.waste=Math.min(1,Eco.waste+dt*(adult?0.0009:0.0006));
  Eco.oxygen=Math.max(0,Eco.oxygen-dt*(adult?0.002:0.0018));
  if(!adult&&f.age>(Eco.oxygen>0.55?16:20)){
    f.stage='adult';f.grp.scale.multiplyScalar(2.1);f.g.speed*=.9;
  }
  if(f.hunger<=0.01){f.starveT+=dt;if(f.starveT>20){fishDie(f,'starve');return;}}
  else f.starveT=0;
  if(Eco.quality<(adult?0.03:0.06)&&chance(0.03*dt)){fishDie(f,'env');return;}
  if(Eco.oxygen<(adult?0.02:0.04)&&chance(0.03*dt)){fishDie(f,'env');return;}
  const T=turtle.grp;
  let danger=Infinity;
  if(T&&!turtle.peaceful)danger=T.position.distanceTo(P);
  const fleeR=(f.stage==='baby'?8:6)+(turtle.frenzy?2.5:turtle.state==='hunt'?1.5:0);
  f.tt-=dt;
  f._rush=1;
  if(danger<fleeR){
    f.mode='flee';
    let bp=plantClusters[0],bs=-1;
    for(const p of plantClusters){
      const cover=p.h*p.health;
      const d=Math.hypot(p.x-P.x,p.z-P.z);
      const score=cover*3-d*0.15;
      if(score>bs){bs=score;bp=p;}
    }
    if(T){
      _steer.set(P.x-T.position.x,0,P.z-T.position.z);
      if(_steer.lengthSq()>0.01)_steer.normalize();
      if(turtle.frenzy&&f.g.len<1.3&&chance(.55)){
        f.target.copy(shelterSpot(2.0,.8,1.2,2.6)).clamp(BMIN,BMAX);
      }else f.target.set(
        clamp(bp.x+R(-1.2,1.2)+_steer.x*2.5,bounds.xMin,bounds.xMax),
        clamp(R(2,7),bounds.yMin,bounds.yMax),
        clamp(bp.z+R(-1.2,1.2)+_steer.z*2.5,bounds.zMin,bounds.zMax));
    }else f.target.set(bp.x+R(-1,1),R(2,6),bp.z+R(-1,1));
    f.tt=0.6;
  }else if(f.hunger<0.85){
    let best=null,bd=Infinity;
    for(const fd of food){
      if(fd.userData.eaten||fd.userData.kind!=='fish')continue;
      if(turtle.state==='hunt'&&T&&fd.position.distanceTo(T.position)<2.5)continue;
      const d=fd.position.distanceTo(P);
      const score=d/(0.5+f.hunger);
      if(score<bd){bd=score;best=fd;}
    }
    if(best){
      const realD=best.position.distanceTo(P);
      f.mode='forage';f.target.copy(best.position);
      let rush=realD<3?(1.2+(1-f.hunger)*0.6):1.05;
      if(f.hunger<0.25)rush*=1.45;
      f._rush=rush;
      const eatR=adult?0.9:0.7;
      if(realD<eatR){
        best.userData.eaten=true;
        f.hunger=Math.min(1,f.hunger+0.42);
        scene.remove(best);food.splice(food.indexOf(best),1);
        f.dartT=Math.max(f.dartT,0.35);
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
    if(d<sepDist){
      _sep.x+=dx/d;_sep.y+=dy/d;_sep.z+=dz/d;nSep++;
    }
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
  _fv.subVectors(f.target,P);
  const dist=_fv.length();
  if(dist>0.15)_fv.normalize();
  else if(f.mode==='cruise'){_fv.set(0,0,0);if(f.tt<0.5)newTarget(f);}
  const margin=1.8;
  if(P.x<bounds.xMin+margin)_fv.x+= (bounds.xMin+margin-P.x)*0.8;
  if(P.x>bounds.xMax-margin)_fv.x+= (bounds.xMax-margin-P.x)*0.8;
  if(P.y<bounds.yMin+margin)_fv.y+= (bounds.yMin+margin-P.y)*0.6;
  if(P.y>bounds.yMax-margin)_fv.y+= (bounds.yMax-margin-P.y)*0.6;
  if(P.z<bounds.zMin+margin)_fv.z+= (bounds.zMin+margin-P.z)*0.8;
  if(P.z>bounds.zMax-margin)_fv.z+= (bounds.zMax-margin-P.z)*0.8;
  let wGoal=1,wSep=1.4,wAli=0.7,wCoh=0.45;
  if(f.mode==='flee'){wGoal=1.6;wSep=0.8;wAli=0.2;wCoh=0.1;}
  else if(f.mode==='forage'){wGoal=1.8;wSep=1.1;wAli=0.25;wCoh=0.15;}
  else if(f.mode==='court'){wGoal=1.4;wSep=1.0;wAli=0.5;wCoh=0.6;}
  _steer.set(0,0,0);
  _steer.addScaledVector(_fv,wGoal);
  _steer.addScaledVector(_sep,wSep);
  if(nAli>0)_steer.addScaledVector(_ali.normalize(),wAli);
  if(nCoh>0){const cl=_coh.length();if(cl>0.01)_steer.addScaledVector(_coh.multiplyScalar(1/cl),wCoh);}
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
  const maxSp=sp*1.8;
  const cur=f.vel.length();
  if(cur>maxSp)f.vel.multiplyScalar(maxSp/cur);
  f.vel.y*=0.988;
  P.addScaledVector(f.vel,dt);
  P.x=clamp(P.x,bounds.xMin,bounds.xMax);
  P.y=clamp(P.y,bounds.yMin,bounds.yMax);
  P.z=clamp(P.z,bounds.zMin,bounds.zMax);
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
  }
}

// ===== 乌龟 =====
const turtle={grp:null,state:'swim',t:R(20,40),vel:new THREE.Vector3(),target:new THREE.Vector3(),
  climbT:0,baskQ:new THREE.Quaternion(),
  hunger:0.35,eatTimer:0,belly:0,baskTimer:R(22,32),breath:1,breathWarned:false,
  frenzy:false,frenzyTimer:0,peaceful:true,sleepPos:new THREE.Vector3()};
function turtleTarget(){turtle.target.set(R(-15,5),R(2.5,12),R(-7,7));}

function turtleShellTexture(){
  const S=256,c=document.createElement('canvas');c.width=c.height=S;
  const x=c.getContext('2d'),cx=S/2,cy=S/2,R2=S/2;
  const P=(nx,ny)=>[cx+nx*R2,cy+ny*R2];
  x.fillStyle='#2b331d';x.fillRect(0,0,S,S);
  const CREAM2='#e2d694',BASE1='#414d26',BASE2='#2e3620',SEAM='#c9bb78';
  function scute(pts,blotch){
    const Q=pts.map(p=>P(p[0],p[1]));
    const trace=(k)=>{
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
    if(blotch){
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
    x.strokeStyle='rgba(20,24,12,.22)';x.lineWidth=1;
    for(const k of [.55,.78]){trace(k);x.stroke();}
    trace(1);x.strokeStyle=SEAM;x.lineWidth=2.2;x.stroke();
  }
  const vw=[.20,.26,.28,.26,.20],vh=[.30,.34,.36,.34,.28];
  for(let i=0;i<5;i++){
    const nx=-.52+i*.26,w=vw[i]/2,h=vh[i]/2;
    scute([[nx-w*.7,-h],[nx+w*.7,-h],[nx+w,-h*.25],[nx+w*.7,h],[nx-w*.7,h],[nx-w,h*.25]],
      [nx+(i%2?.02:-.02),(i%2?.03:-.03),.115]);
  }
  for(let i=0;i<4;i++){
    const nx=-.40+i*.27,w=.13;
    for(const s of [1,-1]){
      const y0=.20*s,y1=.66*s;
      scute([[nx-w,y0],[nx+w,y0],[nx+w*.85,y1],[nx-w*.85,y1]],[nx,y0+(y1-y0)*.45,.14]);
    }
  }
  for(let i=0;i<22;i++){
    const a0=i/22*Math.PI*2,a1=(i+1)/22*Math.PI*2,am=(a0+a1)/2;
    const r0=.72,r1=.99;
    x.beginPath();
    x.arc(cx,cy,r0*R2,a0,a1);x.arc(cx,cy,r1*R2,a1,a0,true);x.closePath();
    x.fillStyle=i%2?BASE1:BASE2;x.fill();
    x.strokeStyle=CREAM2;x.lineWidth=3;
    x.beginPath();x.arc(cx,cy,.965*R2,a0+.02,a1-.02);x.stroke();
    x.fillStyle='rgba(25,30,15,.55)';
    x.beginPath();x.arc(cx+Math.cos(am)*.85*R2,cy+Math.sin(am)*.85*R2,7,0,7);x.fill();
    x.strokeStyle=SEAM;x.lineWidth=1.6;x.stroke();
  }
  scute([[.78,-.09],[.9,-.09],[.9,.09],[.78,.09]],[.84,0,.04]);
  for(let i=0;i<600;i++){x.fillStyle=`rgba(0,0,0,${R(.03,.08)})`;
    x.fillRect(R(0,S),R(0,S),2,2);}
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}
function turtleHeadTexture(){
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
  const shellGeo=new THREE.SphereGeometry(1,36,18,0,Math.PI*2,0,Math.PI*.58);
  {
    const pp=shellGeo.attributes.position,uv=shellGeo.attributes.uv;
    for(let i=0;i<pp.count;i++)uv.setXY(i,pp.getX(i)*.5+.5,pp.getZ(i)*.5+.5);
  }
  const shell=new THREE.Mesh(shellGeo,
    new THREE.MeshStandardMaterial({map:turtleShellTexture(),roughness:.55}));
  shell.scale.set(1.62,.62,1.12);shell.position.y=.3;
  shell.castShadow=true;grp.add(shell);
  const plastron=new THREE.Mesh(new THREE.SphereGeometry(1,24,16),
    new THREE.MeshStandardMaterial({color:0xd0b268,roughness:.6}));
  plastron.scale.set(1.42,.3,.92);plastron.position.y=-.02;
  grp.add(plastron);
  const headG=new THREE.Group();headG.position.set(1.78,.3,0);grp.add(headG);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.34,20,16),skin);
  head.scale.set(1.3,.95,.85);head.castShadow=true;headG.add(head);
  const snout=new THREE.Mesh(new THREE.SphereGeometry(.2,16,12),skin);
  snout.position.set(.34,-.05,0);snout.scale.set(1.15,.8,.8);headG.add(snout);
  const earM=new THREE.MeshStandardMaterial({color:0xd42a20,roughness:.55,
    emissive:0x550a06,emissiveIntensity:.35});
  for(const s of [1,-1]){
    const ear=new THREE.Mesh(new THREE.SphereGeometry(.12,14,12),earM);
    ear.position.set(-.02,.12,s*.3);ear.scale.set(1.5,1,.45);headG.add(ear);
    const iris=new THREE.Mesh(new THREE.SphereGeometry(.085,12,10),
      new THREE.MeshStandardMaterial({color:0xc09030,roughness:.25}));
    iris.position.set(.24,.16,s*.21);headG.add(iris);
    const pup=new THREE.Mesh(new THREE.SphereGeometry(.045,10,8),
      new THREE.MeshStandardMaterial({color:0x080808,roughness:.1}));
    pup.position.set(.29,.16,s*.23);headG.add(pup);
  }
  const tail=new THREE.Mesh(new THREE.ConeGeometry(.11,.5,10),skinDark);
  tail.rotation.z=Math.PI/2+.3;tail.position.set(-1.72,.12,0);grp.add(tail);
  const flippers={};
  const mkFin=(name,px,py,pz,len,wid)=>{
    const piv=new THREE.Group();piv.position.set(px,py,pz);grp.add(piv);
    const fin=new THREE.Mesh(new THREE.SphereGeometry(1,14,10),skin);
    fin.scale.set(len*.3,.09,wid);fin.position.set(0,0,(pz>0?1:-1)*len*.45);
    fin.castShadow=true;piv.add(fin);
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

function animTurtle(dt,t){
  const T=turtle;if(!T.grp||!T.grp.userData.flippers)return;
  const F=T.grp.userData.flippers;
  let freq=0,amp=0,rest=0;
  if(T.state==='swim'){freq=2.2;amp=.55;}
  else if(T.state==='hunt'){freq=T.frenzy?5:3.4;amp=.7;}
  else if(T.state==='surface'||T.state==='toRamp'){freq=2.6;amp=.6;}
  else if(T.state==='climb'){freq=1.2;amp=.35;}
  else if(T.state==='slide'){freq=3;amp=.5;}
  else{rest=.5;}
  T._pad=(T._pad||0)+dt*freq;
  const p=T._pad;
  const set=(o,ph,base)=>{
    const target=rest?base+rest:base+Math.sin(p+ph)*amp;
    o.rotation.x+=(target-o.rotation.x)*Math.min(1,dt*8);
  };
  set(F.FL,0,-.15);set(F.FR,Math.PI,-.15);
  set(F.BL,Math.PI*.5,-.1);set(F.BR,Math.PI*1.5,-.1);
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
  const T=turtle.grp.position;let bt=null,bd=Infinity,kind=null;
  for(const fd of food){
    if(fd.userData.eaten)continue;
    if(fd.userData.kind==='turtle'||fd.userData.corpse){
      const d=fd.position.distanceTo(T)+(fd.userData.corpse?-1.5:0);
      if(d<bd){bd=d;bt=fd;kind=fd.userData.corpse?'corpse':'turtleFood';}
    }
  }
  if(turtle.frenzy){
    for(const f of fish){
      if(!f.alive)continue;
      const d=f.grp.position.distanceTo(T);
      if(d<bd){bd=d;bt=f;kind='chase';}
    }
  }
  if(Eco.waste>0.08&&!turtle.frenzy){
    if(kind!=='turtleFood'||bd>6){
      const wx=R(-14,5),wz=R(-6.5,6.5);
      const d=Math.hypot(wx-T.x,wz-T.z)+2;
      if(d<bd||kind===null){
        bd=d;kind='waste';
        bt={position:new THREE.Vector3(wx,1.2,wz)};
      }
    }
  }
  return bt?{target:bt,dist:bd,kind}:null;
}
function turtleEat(target,kind){
  if(kind==='chase'){
    turtle.eatTimer=0.35;
    blip(180,0.08,0.06);
    return;
  }
  if(kind==='turtleFood'||kind==='corpse'){
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
function faceVel(obj,vel,k,dt){
  if(vel.lengthSq()>.0004){_m.lookAt(_o,vel,_up);_q.setFromRotationMatrix(_m).multiply(_yr);
    obj.quaternion.slerp(_q,Math.min(1,dt*k));}}
function updateTurtle(dt,t){
  const T=turtle;if(!T.grp)return;const P=T.grp.position;
  if(T.eatTimer>0)T.eatTimer-=dt;
  const night=Eco.dayTarget<0.5;
  if(T.frenzy){
    T.frenzyTimer-=dt;
    if(T.frenzyTimer<=0){T.frenzy=false;
      if(night){T.state='sleep';T.sleepPos.set(R(-12,4),0.8,R(-5,5));}
      toast('乌龟冷静下来了');}
  }
  T.hunger=clamp(T.hunger+dt*0.01,0,1);
  const under=T.state!=='surface'&&T.state!=='bask'&&T.state!=='climb'&&T.state!=='slide';
  if(under)T.breath=Math.max(0,T.breath-dt*(T.state==='sleep'?0.004:0.02));
  else T.breath=Math.min(1,T.breath+dt*0.6);
  if(T.breath<0.25&&under){
    T.state='surface';T.t=3;
    if(!T.breathWarned){T.breathWarned=true;toast('乌龟上浮换气');}
  }else if(T.breath>0.9)T.breathWarned=false;
  if(night&&!T.frenzy&&(T.state==='swim'||T.state==='hunt')){
    T.state='sleep';T.sleepPos.set(R(-12,4),0.8,R(-5,5));
  }
  if(!night&&T.state==='sleep')T.state='surface';
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
      T.target.copy(found.target.position||found.target.grp.position);
      const rr=found.kind==='chase'?2.2:found.kind==='waste'?1.8:1.5;
      const d=P.distanceTo(T.target);
      if(d<rr){
        if(found.kind==='chase'){
          turtleEat(found.target,'chase');
          if(Eco.waste>0.05){Eco.waste=Math.max(0,Eco.waste-0.08);T.hunger=clamp(T.hunger-0.12,0,1);}
        }else turtleEat(found.target,found.kind);
      }
    }else if(P.distanceTo(T.target)<1.5){turtleTarget();}
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
    T.target.set(ISLAND.cx-2,TANK.water-1.2,0);
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
    T.hunger=Math.max(0,T.hunger-dt*0.03);
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
  if(T.state==='swim'||T.state==='hunt'||T.frenzy){
    plantSwayFrom(P.x,P.z,(T.frenzy?0.35:0.18)*dt*60);
  }
}

// ===== 气泡 / 悬浮颗粒 / 食物 / 鱼卵 =====
const moteGeo=new THREE.BufferGeometry();
{
  const N=90,pos=new Float32Array(N*3);
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
for(let i=0;i<10;i++){
  const b=new THREE.Mesh(bubGeo,bubMat),s=bubbleSrc[i%2];
  b.position.set(s.x+R(-.3,.3),R(0,16),s.z+R(-.3,.3));
  b.scale.setScalar(R(.4,1.6));
  b.userData.s=i%2;
  scene.add(b);bubbles.push(b);
}

const foodGeo=new THREE.IcosahedronGeometry(.09,0),
  foodMat=new THREE.MeshStandardMaterial({color:0xc07a2e,roughness:.9}),
  turtleFoodMat=new THREE.MeshStandardMaterial({color:0x3d8b5a,roughness:.55,emissive:0x1a4030,emissiveIntensity:.35}),
  rotMat=new THREE.MeshStandardMaterial({color:0x8a6a3a,roughness:.95});
const turtleFoodGeo=new THREE.CylinderGeometry(.11,.14,.07,8);
function dropFood(x,z,n,kind){
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

const FISH_PER_FEED=3;
function feed(x,z){
  const alive=fish.filter(f=>f.alive);
  const hungry=alive.filter(f=>f.hunger<0.88).length;
  const fishFoodLeft=food.filter(f=>!f.userData.eaten&&f.userData.kind==='fish').length;
  if(hungry>fishFoodLeft){
    dropFood(x,z,FISH_PER_FEED,'fish');
    toast('鱼食 x'+FISH_PER_FEED+(alive.length?` (约够${FISH_PER_FEED}条)`:''),'manual');
  }else{
    dropFood(x,z,2,'turtle');
    toast('龟粮','manual');
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
      if(f.userData.age>12){
        Eco.waste=Math.min(1,Eco.waste+(f.userData.corpse?0.03:0.01));
        scene.remove(f);continue;
      }
      if(f.userData.age>6&&!f.userData.corpse){f.material=rotMat;}
    }
    f.rotation.x+=dt;
    food[w++]=f;
  }
  food.length=w;
  if(food.length>160)scene.remove(food.shift());
}

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
    if(Eco.quality<0.25&&chance(0.2*dt)){scene.remove(e.mesh);continue;}
    if(e.age>=e.hatchIn){
      scene.remove(e.mesh);
      if(aliveCount()<MAX_FISH&&Eco.quality>0.3){
        const pos=e.mesh.position.clone();
        try{
          if(e.breedA!==e.breedB){
            spawnHybridFish(e.breedA,e.breedB,pos);
            toast('混种小鱼孵化了!');unlockAch('hybrid');
          }else{
            spawnFishByBreed(e.breedA,'baby',pos);
            toast('小鱼孵化了!');
          }
          unlockAch('first_hatch');
          blip(700,0.12,0.08);
        }catch(err){console.error('[tank] 孵化失败,丢弃该蛋',err);}
      }
      continue;
    }
    eggs[w++]=e;
  }
  eggs.length=w;
}

// ===== 生态 / 自动任务 =====
function updateEco(dt){
  if(Eco.filterOn){
    Eco.waste=Math.max(0,Eco.waste-0.040*dt);
    Eco.oxygen=Math.min(1,Eco.oxygen+0.030*dt);
  }else{
    Eco.oxygen=clamp(Eco.oxygen+(Eco.dayNight>0.5?0.008:-0.002)*dt,0,1);
  }
  let nA=0,nB=0;for(const f of fish)if(f.alive){if(f.stage==='adult')nA++;else nB++;}
  const n=nA+nB*0.5;
  if(n>10)Eco.waste=Math.min(1,Eco.waste+0.0005*(n-10)*dt);
  if(Eco.dayNight<0.5)Eco.oxygen=Math.max(0,Eco.oxygen-0.002*dt);
  const target=clamp(1-Eco.waste*0.9-Math.max(0,n-10)*0.008,0,1);
  Eco.quality+=(target-Eco.quality)*Math.min(1,dt*(target<Eco.quality?0.25:0.6));
  Eco.autoWaterCD=Math.max(0,Eco.autoWaterCD-dt);
  if(!Eco.autoWatering&&Eco.quality<0.6&&Eco.autoWaterCD<=0){
    Eco.autoWatering=true;
    toast('自动换水中…');
  }
  if(Eco.autoWatering){
    Eco.waste*=Math.exp(-1.0*dt);
    Eco.oxygen=Math.min(1,Eco.oxygen+0.12*dt);
    Eco.quality=Math.min(1,Math.max(Eco.quality,1-Eco.waste*0.9)+0.12*dt);
    if(Eco.waste<0.04){
      Eco.waste=0;Eco.quality=1;Eco.oxygen=Math.min(1,Eco.oxygen+0.1);
      Eco.autoWatering=false;Eco.autoWaterCD=20;
      toast('自动换水完成 水质已满');
    }
  }
  Eco.autoFeedCD=Math.max(0,Eco.autoFeedCD-dt);
  if(Eco.autoFeedCD<=0){
    let hungriest=null;
    for(const f of fish)if(f.alive&&f.hunger<0.3&&(!hungriest||f.hunger<hungriest.hunger))hungriest=f;
    if(hungriest){
      Eco.autoFeedCD=8;
      const hp=hungriest.grp.position;
      dropFood(clamp(hp.x,-15,5),clamp(hp.z,-7,7),3,'fish');
      toast('有鱼饿了，已自动投喂');
    }
  }
  for(let i=fish.length-1;i>=0;i--)if(!fish[i].alive)removeFish(fish[i]);
  Eco.autoFishCD=Math.max(0,Eco.autoFishCD-dt);
  const aliveN=aliveCount();
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
  Eco.autoTrimCD=Math.max(0,Eco.autoTrimCD-dt);
  if(Eco.autoTrimCD<=0&&plantClusters.length){
    let sum=0;for(const p of plantClusters)sum+=p.h/p.baseH;
    if(sum/plantClusters.length>0.85){Eco.autoTrimCD=30;trimPlants(true);}
  }
  if(aliveN>=20)unlockAch('school20');
  if(aliveN>=MAX_FISH)unlockAch('full36');
  if(Eco.quality>0.999)unlockAch('eco100');
}

// ===== 手势: 点按投食 · 长按放大镜 · 拖动旋转 =====
const MAG={zoom:2.6,size:150};
const magEl=$('mag'),magC=$('magC'),magCtx=magC.getContext('2d');
function moveMag(x,y){
  if(!UI.mag)return;
  UI.mag.x=x;UI.mag.y=y;
  const s=MAG.size,gap=26;
  const px=Math.min(Math.max(x-s/2,6),innerWidth-s-6);
  let py=y-s-gap;
  if(py<6)py=Math.min(y+gap,innerHeight-s-6);
  magEl.style.transform='translate('+px+'px,'+py+'px)';
}
function showMag(x,y){
  UI.mag={x,y};controls.enabled=false;controls.autoRotate=false;
  magEl.classList.add('show');moveMag(x,y);blip(660,0.08,0.05);
}
function hideMag(){
  if(!UI.mag)return;
  UI.mag=null;controls.enabled=true;magEl.classList.remove('show');
}

function drawMag(){
  if(!UI.mag)return;
  const cv=renderer.domElement,k=cv.width/innerWidth,sw=MAG.size/MAG.zoom*k;
  const sx=Math.min(Math.max(UI.mag.x*k-sw/2,0),cv.width-sw),sy=Math.min(Math.max(UI.mag.y*k-sw/2,0),cv.height-sw);
  try{magCtx.drawImage(cv,sx,sy,sw,sw,0,0,magC.width,magC.height);}catch(_){}
}

const ray=new THREE.Raycaster(),ndc=new THREE.Vector2();

const TAP_LIM=8,LP_LIM=14,LP_MS=550;
renderer.domElement.addEventListener('pointerdown',e=>{
  UI.idleT=0;UI.lpFired=false;setAmbient(true);
  UI.pdown={x:e.clientX,y:e.clientY,t:performance.now()};
  $('dash').classList.remove('open');
  try{renderer.domElement.setPointerCapture(e.pointerId);}catch(_){}
  clearTimeout(UI.lpTimer);
  UI.lpTimer=setTimeout(()=>{UI.lpFired=true;showMag(UI.pdown.x,UI.pdown.y);},LP_MS);
});
renderer.domElement.addEventListener('pointermove',e=>{
  if(UI.mag){moveMag(e.clientX,e.clientY);return;}
  if(!UI.pdown||UI.lpFired)return;
  if(Math.hypot(e.clientX-UI.pdown.x,e.clientY-UI.pdown.y)>LP_LIM)clearTimeout(UI.lpTimer);
});
const endPointer=e=>{
  if(!UI.pdown)return;
  clearTimeout(UI.lpTimer);
  const wasLp=UI.lpFired;
  hideMag();
  const moved=Math.hypot(e.clientX-UI.pdown.x,e.clientY-UI.pdown.y);
  const dtMs=performance.now()-UI.pdown.t;
  UI.pdown=null;UI.lpFired=false;
  if(wasLp)return;
  if(moved<TAP_LIM&&dtMs<600){
    ndc.set(e.clientX/innerWidth*2-1,-(e.clientY/innerHeight)*2+1);
    ray.setFromCamera(ndc,camera);
    let hitPlant=null,hitD=1e9;
    for(const pl of plantClusters){
      if(!pl.grp.visible)continue;
      const ox=ray.ray.origin,dir=ray.ray.direction;
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
renderer.domElement.addEventListener('pointercancel',()=>{hideMag();UI.pdown=null;UI.lpFired=false;clearTimeout(UI.lpTimer);});

// ===== 昼夜 =====
const dayCfg={sun:3.4,sunCol:new THREE.Color(0xfff2dd),hemi:.9,
  fog:.015,caus:1,lamp:30,exposure:1.2};
const nightCfg={sun:.22,sunCol:new THREE.Color(0x8fb4dd),hemi:.22,
  fog:.024,caus:.12,lamp:110,exposure:.95};
const FOG_CLEAR=new THREE.Color(0x0d3a4d),FOG_MURK=new THREE.Color(0x2e3a1e);
const TINT_CLEAR=new THREE.Color(0x9fc8dd),TINT_MURK=new THREE.Color(0xa8b06a);

function applyDayNight(dt){
  Eco.dayNight+=(Eco.dayTarget-Eco.dayNight)*Math.min(1,dt*1.5);
  const d=Eco.dayNight;
  sun.intensity=lerp(nightCfg.sun,dayCfg.sun,d);
  sun.color.lerpColors(nightCfg.sunCol,dayCfg.sunCol,d);
  hemi.intensity=lerp(nightCfg.hemi,dayCfg.hemi,d);
  U.uCaus.value=lerp(nightCfg.caus,dayCfg.caus,d);
  lampLight.intensity=lerp(nightCfg.lamp,dayCfg.lamp,d);
  lampGlow.material.opacity=lerp(.95,.45,d);
  renderer.toneMappingExposure=lerp(nightCfg.exposure,dayCfg.exposure,d);
  const fillI=lerp(0.35,1.5,d);
  for(const pl of fillLights)pl.intensity=fillI;
  const murk=clamp(Eco.waste*1.2,0,1);
  scene.fog.color.lerpColors(FOG_CLEAR,FOG_MURK,murk);
  const camDist=camera.position.distanceTo(controls.target);
  scene.fog.density=lerp(nightCfg.fog,dayCfg.fog,d)*(1+murk*0.9)*(37/Math.max(37,camDist));
  U.uMurk.value=murk;
}

// ===== 主循环 =====
const clock=new THREE.Clock();

const _errSeen={};
function safe(name,fn){
  try{fn();}catch(e){
    const k=name+':'+(e&&e.message);
    if(!_errSeen[k]){_errSeen[k]=1;console.error('[tank]',name,e);
      let el=document.getElementById('errBox');
      if(!el){el=document.createElement('div');el.id='errBox';
        el.style.cssText='position:fixed;left:6px;bottom:6px;z-index:99;max-width:70vw;font:10px/1.3 monospace;color:#ffb4a8;background:rgba(0,0,0,.6);padding:4px 6px;border-radius:6px;pointer-events:none';
        document.body.appendChild(el);}
      el.textContent='错误['+name+'] '+(e&&e.message)+(e&&e.stack?' @'+String(e.stack).split('\n')[1]:'');}
  }
}
function tick(){
  try{tickBody();}catch(e){safe('主循环',()=>{throw e;});}
  requestAnimationFrame(tick);
}
function tickBody(){
  const rdt=Math.min(clock.getDelta(),.05),dt=rdt,t=clock.elapsedTime;
  U.uTime.value=t;
  applyDayNight(rdt);
  UI.idleT=UI.mag?0:UI.idleT+rdt;
  if(UI.idleT>10&&!controls.autoRotate)controls.autoRotate=true;
  controls.update();
  const aboveWater=camera.position.y>TANK.water+.5;
  topSurf.material.opacity+=(((aboveWater)?.06:.18)-topSurf.material.opacity)*Math.min(1,rdt*4);
  surf.visible=!aboveWater;
  safe('植物',()=>updatePlants(dt));
  safe('食物',()=>updateFood(dt,t));
  safe('鱼卵',()=>updateEggs(dt,t));
  safe('生态',()=>updateEco(dt));
  for(const f of fish)safe('鱼',()=>updateFish(f,dt,t));
  safe('乌龟',()=>{updateTurtle(dt,t);animTurtle(dt,t);});
  for(const b of bubbles){b.position.y+=dt*(1.1+b.scale.x);
    b.position.x+=Math.sin(t*3+b.userData.s*2)*.005;
    if(b.position.y>TANK.water-.3){const s=bubbleSrc[b.userData.s];b.position.set(s.x+R(-.3,.3),.2,s.z+R(-.3,.3))}}
  moteMat.opacity=.28+clamp(Eco.waste,0,1)*.5;
  const mp=moteGeo.attributes.position.array;
  for(let i=0;i<mp.length;i+=3){mp[i+1]+=dt*.05;if(mp[i+1]>17)mp[i+1]=0}
  moteGeo.attributes.position.needsUpdate=true;
  grade.uniforms.uTime.value=t;
  updateWreckBubbles(rdt);
  grade.uniforms.uTint.value.lerpColors(TINT_MURK,TINT_CLEAR,1-U.uMurk.value).multiplyScalar(.4+.6*Eco.dayNight);
  grade.uniforms.uMurk.value=U.uMurk.value;
  updateHUD(rdt);
  UI.saveT+=rdt;if(UI.saveT>5){UI.saveT=0;saveGame();}
  if(View.fx)composer.render();else renderer.render(scene,camera);
  drawMag();
  if(UI.firstFrame){UI.firstFrame=false;
    requestAnimationFrame(()=>{
      const elapsed=Date.now()-(window.__loadT0||Date.now());
      const wait=Math.max(0,6660-elapsed); // 引导页最少展示 6.66 秒
      setTimeout(()=>{
        const l=$('loading');
        if(l){l.classList.add('out');l.style.opacity='0';setTimeout(()=>l.remove(),380);}
        maybeOnboard();
      },wait);
    });}
}

// ===== 提示 / 日志 / HUD =====
const toastEl=$('toast');

const INFO_MAX=6,infoLog=[];
function logInfo(msg){
  const d=new Date(),hm=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  if(infoLog.length&&infoLog[0].m===msg)infoLog[0].t=hm;
  else{infoLog.unshift({m:msg,t:hm});if(infoLog.length>INFO_MAX)infoLog.length=INFO_MAX;}
  renderInfoLog();
}
function renderInfoLog(){
  const el=$('dashLog');
  el.innerHTML='';
  if(!infoLog.length){el.textContent='暂无动态';return;}
  for(const it of infoLog){
    const r=document.createElement('div');r.className='lg';
    const a=document.createElement('span');a.className='lt';a.textContent=it.t;
    const b=document.createElement('span');b.textContent=it.m;
    r.appendChild(a);r.appendChild(b);el.appendChild(r);
  }
}
function toast(msg,level){
  if(level!=='urgent'&&level!=='manual'){logInfo(msg);return;}
  const item={m:msg,u:level==='urgent'};
  if(item.u)UI.toastQ=UI.toastQ.filter(x=>x.u);
  if(UI.toastQ.length>2)UI.toastQ.shift();
  UI.toastQ.push(item);
  if(item.u&&UI.toastTimer){clearTimeout(UI.toastTimer);UI.toastTimer=null;nextToast();return;}
  if(!UI.toastTimer)nextToast();
}
function nextToast(){
  const m=UI.toastQ.shift();
  if(!m){UI.toastTimer=null;return;}
  toastEl.textContent=m.m;toastEl.classList.toggle('urgent',!!m.u);toastEl.classList.add('show');
  UI.toastTimer=setTimeout(()=>{
    toastEl.classList.remove('show');
    UI.toastTimer=setTimeout(nextToast,300);
  },m.u?2800:1500);
}
const dashEl=$('dash');
renderInfoLog();

function fastTap(el,fn){let last=0;
  el.addEventListener('pointerdown',e=>{e.stopPropagation();last=performance.now();fn(e);});
  el.addEventListener('click',e=>{e.stopPropagation();if(performance.now()-last<700)return;fn(e);});}
fastTap($('dashPill'),()=>{dashEl.classList.toggle('open');});
const barColor=v=>v>0.55?'#3dcc7a':v>0.3?'#d4a017':'#d4452f';
const oxyColor=v=>v>0.55?'#5ec8ff':v>0.3?'#d4a017':'#d4452f';
const wasteColor=v=>v>0.6?'#d4452f':v>0.35?'#d4a017':'#3dcc7a';
function advice(){
  const tips=[];
  if(Eco.waste>0.55&&!Eco.filterOn)tips.push('开过滤');
  if(Eco.waste>0.7)tips.push('换水');
  if(Eco.oxygen<0.35)tips.push('缺氧');
  if(food.filter(f=>!f.userData.eaten&&!f.userData.corpse&&f.userData.age>6).length>2)tips.push('残饵多');
  const hungry=fish.filter(f=>f.alive&&f.hunger<0.25).length;
  if(hungry)tips.push(hungry+'条鱼饿');
  if(aliveCount()>=MAX_FISH)tips.push('已满员');
  return tips.slice(0,2).join(' · ')||'生态稳定 🌿';
}

function updateHUD(dt){
  UI.hudT-=dt;if(UI.hudT>0)return;UI.hudT=0.25;
  const q=Math.round(Eco.quality*100),o=Math.round(Eco.oxygen*100),w=Math.round(Eco.waste*100);
  $('qFill').style.width=q+'%';$('qFill').style.background=barColor(Eco.quality);$('qVal').textContent=q+'%';
  $('oFill').style.width=o+'%';
  $('oFill').style.background=oxyColor(Eco.oxygen);
  $('oVal').textContent=o+'%';
  $('wFill').style.width=w+'%';
  $('wFill').style.background=wasteColor(Eco.waste);
  $('wVal').textContent=w+'%';
  const alive=aliveCount();
  const babies=fish.filter(f=>f.alive&&f.stage==='baby').length;
  $('fishVal').textContent='鱼 '+alive+(babies?'(幼'+babies+')':'')+(eggs.length?' 卵'+eggs.length:'');
  $('advice').textContent=advice();
  $('dQ').style.background=barColor(Eco.quality);
  $('dO').style.background=oxyColor(Eco.oxygen);
  $('dW').style.background=wasteColor(Eco.waste);
  const bad=[['水质',1-Eco.quality,q+'%'],['氧气',1-Eco.oxygen,o+'%'],['废物',Eco.waste,w+'%']];
  bad.sort((a,b)=>b[1]-a[1]);
  $('dashMini').textContent=bad[0][0]+bad[0][2];
}

// ===== 工具箱 / 全屏 / 音效 / 高清 =====
const openSheet=()=>{$('sheet').classList.add('open');$('sheetBg').classList.add('open');};
const closeSheet=()=>{$('sheet').classList.remove('open');$('sheetBg').classList.remove('open');};
function feedAction(){feed(R(-10,2),R(-5,5));blip(620,0.1,0.08);}
function waterAction(){
  Eco.waste*=0.45;Eco.oxygen=Math.min(1,Eco.oxygen+0.25);
  Stats.statWater++;saveAch();
  if(Stats.statWater>=10)unlockAch('water10');
  toast('已换水, 水质提升','manual');blip(360,0.15,0.09);
}
function filterAction(){
  Eco.filterOn=!Eco.filterOn;
  $('bFilter').classList.toggle('on',Eco.filterOn);
  toast(Eco.filterOn?'过滤已开启':'过滤已关闭','manual');
  blip(Eco.filterOn?500:280,0.12,0.09);
}
function addFishAction(){
  const f=spawnRandomFish();
  if(!f){toast('鱼缸满了!','manual');blip(180,0.15,0.08);return;}
  toast('新'+(BREEDS[f.breed]?BREEDS[f.breed].label:'鱼')+'入缸!','manual');blip(640,0.12,0.09);
}
function dayAction(){
  Eco.dayTarget=Eco.dayTarget>0.5?0:1;
  $('bDay').classList.toggle('on',!!Eco.dayTarget);
  toast(Eco.dayTarget?'白天':'夜晚','manual');
  blip(Eco.dayTarget?700:300,0.15,0.09);
}
$('bFeed').onclick=feedAction;
$('bFish').onclick=addFishAction;
$('bWater').onclick=waterAction;
$('bFilter').onclick=filterAction;
$('bDay').onclick=dayAction;
$('bFx').onclick=e=>{View.fx=!View.fx;const b=e.currentTarget;
  b.classList.toggle('on',View.fx);bloom.enabled=View.fx&&!IS_MOBILE;toast(View.fx?'特效已开':'特效已关','manual');};
$('bTrim').onclick=()=>trimPlants();
$('bFrenzy').onclick=()=>{
  if(!turtle.grp)return;
  turtle.frenzy=true;turtle.frenzyTimer=20;turtle.state='hunt';
  toast('乌龟狂暴20秒! 追逐鱼并吞废物','manual');
  closeSheet();blip(140,0.3,0.12,'sawtooth');
};

function isFullscreen(){
  return !!(document.fullscreenElement||document.webkitFullscreenElement);
}
function requestFS(el){
  const fn=el.requestFullscreen||el.webkitRequestFullscreen||el.webkitRequestFullScreen;
  return fn?fn.call(el):Promise.reject(new Error('unsupported'));
}
function exitFS(){
  const fn=document.exitFullscreen||document.webkitExitFullscreen||document.webkitCancelFullScreen;
  return fn?fn.call(document):Promise.reject(new Error('unsupported'));
}
$('bFs').onclick=()=>{
  closeSheet();
  const el=document.documentElement;
  const go=isFullscreen()?exitFS():requestFS(el);
  Promise.resolve(go).then(()=>{
    setTimeout(()=>{
      const on=isFullscreen();
      $('bFs').classList.toggle('on',on);
      toast(on?'已全屏':'已退出全屏','manual');
      blip(on?520:320,0.1,0.07);
    },120);
  }).catch(()=>{
    toast(IS_MOBILE?'当前浏览器不支持全屏':'全屏失败,请用浏览器菜单进入','urgent');
  });
};
document.addEventListener('fullscreenchange',()=>{$('bFs').classList.toggle('on',isFullscreen());});
document.addEventListener('webkitfullscreenchange',()=>{$('bFs').classList.toggle('on',isFullscreen());});
$('bResetT').onclick=()=>{
  showConfirm('重置鱼缸？','所有鱼、水质、存档将清空，回到开缸状态。',()=>{
    try{localStorage.removeItem(SAVE_KEY);}catch(e){}
    try{localStorage.removeItem('tank_onboarded');}catch(e){}
    location.reload();
  });
};

function showConfirm(title,desc,onOk){
  $('cfTitle').textContent=title;$('cfDesc').textContent=desc;
  UI.cfOk=onOk;$('confirm').classList.add('show');
}
$('cfCancel').onclick=()=>{$('confirm').classList.remove('show');UI.cfOk=null;};
$('cfOk').onclick=()=>{$('confirm').classList.remove('show');if(UI.cfOk)UI.cfOk();UI.cfOk=null;};

try{Sfx.on=localStorage.getItem('tank_sound')!=='0';}catch(e){}
const _swS=$('bSound');if(_swS){
  _swS.classList.toggle('on',Sfx.on);
  _swS.onclick=()=>{Sfx.on=!Sfx.on;_swS.classList.toggle('on',Sfx.on);
    try{localStorage.setItem('tank_sound',Sfx.on?'1':'0');}catch(e){}
    setAmbient(Sfx.on);
    if(Sfx.on)blip(600,0.1,0.06);};
}

try{const _hd=localStorage.getItem('tank_hd');if(_hd!==null)View.hdOn=_hd!=='0';}catch(e){}
const _swH=$('bHD');if(_swH){
  _swH.classList.toggle('on',View.hdOn);
  const applyHD=()=>{
    const r=View.hdOn?Math.min(devicePixelRatio,IS_MOBILE?1.5:2):1;
    renderer.setPixelRatio(r);renderer.setSize(innerWidth,innerHeight);
    composer.setPixelRatio(r);composer.setSize(innerWidth,innerHeight);};
  applyHD();
  _swH.onclick=()=>{View.hdOn=!View.hdOn;_swH.classList.toggle('on',View.hdOn);applyHD();
    try{localStorage.setItem('tank_hd',View.hdOn?'1':'0');}catch(e){}
    toast(View.hdOn?'高清已开':'高清已关','manual');
    blip(View.hdOn?640:300,0.1,0.07);};
}

const OB_STEPS=[
  {e:'👆',t:'投食',d:'点一下水面，就能在点击处投食。鱼儿会自己游过来吃。'},
  {e:'🔄',t:'旋转缩放',d:'单指拖动旋转视角，双指或滚轮缩放。10 秒不动会自动环绕。'},
  {e:'🧰',t:'鱼缸管家',d:'点左上角“工具箱”打开管家：投食、加鱼、换水、昼夜都在里面。长按鱼缸是放大镜。'},
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

fastTap($('bToolbox'),()=>{
  $('sheet').classList.contains('open')?closeSheet():openSheet();});
document.addEventListener('contextmenu',e=>e.preventDefault());

// ===== 存档 / 启动 =====
const SAVE_KEY='fishtank-3d-save-v1';

function saveGame(){
  try{
    const snap={v:3,waste:Eco.waste,quality:Eco.quality,oxygen:Eco.oxygen,filterOn:Eco.filterOn,dayTarget:Eco.dayTarget,
      fishes:fish.filter(f=>f.alive).map(f=>({x:f.grp.position.x,y:f.grp.position.y,z:f.grp.position.z,
        stage:f.stage,age:f.age,hunger:f.hunger,breed:f.breed,hue:f.hue,hybrid:f.hybrid,
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
      if(aliveCount()>=MAX_FISH)break;
      const pos=new THREE.Vector3(d.x??-6,d.y??6,d.z??0);
      let f;
      if(d.breed==='hybrid'&&d.hybrid){
        const [ba,bb]=String(d.hybrid).split('+');
        f=spawnHybridFish(ba||'comet',bb||'comet',pos);
      }else{
        f=spawnFishByBreed(d.breed||'comet',d.stage==='baby'?'baby':'adult',pos);
      }
      if(f)Object.assign(f,{age:d.age??0,hunger:d.hunger??0.5,breedCD:d.breedCD??10});
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

if(loadGame()){
  setTimeout(()=>toast('已恢复上次的鱼缸'),600);
}else{
  spawnEcoFish('comet',PALETTES[0],'adult');
  spawnEcoFish('fantail',PALETTES[1],'adult');
  spawnEcoFish('pearl',PALETTES[2],'adult');
  spawnKoi();spawnKoi();
  spawnNewFish(NEW_SPECIES[0]);spawnNewFish(NEW_SPECIES[1]);
  spawnNewFish(NEW_SPECIES[2]);spawnNewFish(NEW_SPECIES[4]);
}

window.__tank={camera,controls,scene,turtle,fish,food,eggs,lampLight,
  spawnHybridFish,spawnFishByBreed,spawnNewFish,spawnRandomFish,NEW_SPECIES,BREEDS,
  layEgg,fishDie,dropFood,feed,trimPlants,turtleFindPrey,turtleEat,tryBreed,
  eco:()=>({waste:Eco.waste,quality:Eco.quality,oxygen:Eco.oxygen,filterOn:Eco.filterOn,dayTarget:Eco.dayTarget})};
clearTimeout(window.__bootT);
tick();

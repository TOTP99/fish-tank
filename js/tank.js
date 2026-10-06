import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {BokehPass} from 'three/addons/postprocessing/BokehPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';

// 模型从 models/ 目录外部加载(拆分交付)
const MODEL_URL={turtle:'./models/turtle.glb',koi:'./models/koi.glb'};

const R=(a,b)=>a+Math.random()*(b-a), RI=(a,b)=>Math.floor(R(a,b+1)), pick=a=>a[Math.floor(Math.random()*a.length)], chance=p=>Math.random()<p;
const $=id=>document.getElementById(id);
const clamp=THREE.MathUtils.clamp, lerp=THREE.MathUtils.lerp;
// 轻音效(WebAudio 合成, 首次交互后可用)
let AC=null;
function blip(freq=480,dur=0.14,vol=0.08,type='sine'){
  try{
    if(!AC)AC=new (window.AudioContext||window.webkitAudioContext)();
    if(AC.state==='suspended')AC.resume();
    const t0=AC.currentTime,o=AC.createOscillator(),g=AC.createGain();
    o.type=type;o.frequency.setValueAtTime(freq,t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(40,freq*0.6),t0+dur);
    g.gain.setValueAtTime(0.001,t0);
    g.gain.exponentialRampToValueAtTime(vol,t0+0.012);
    g.gain.exponentialRampToValueAtTime(0.001,t0+dur);
    o.connect(g).connect(AC.destination);o.start(t0);o.stop(t0+dur+0.02);
  }catch(_){}
}

/* ================= 生态状态(与 2D 版同规则) =================
   废物: 鱼代谢+残饵+尸体 → 上升; 水草+过滤+换水 → 下降
   水质: 由废物和密度推导, 平滑跟随
   氧气: 白天水草产氧, 过滤增氧, 鱼呼吸消耗 */
let waste=0.22, quality=0.9, oxygen=0.85, filterOn=false;
const MAX_FISH=12, MAX_EGGS=8;

// 2D 版 8 套体色 → 3D 基因组颜色
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
// 2D 三品种 → 3D 体型/尾鳍/游速
const BREEDS={
  comet:  {label:'草金', body:'torpedo', tail:'fork',  len:[1.3,1.9], speed:[1.05,1.3],  cruise:1.0},
  fantail:{label:'扇尾', body:'deep',    tail:'veil',  len:[1.1,1.5], speed:[0.7,0.9],   cruise:0.78},
  pearl:  {label:'珍珠', body:'round',   tail:'round', len:[0.9,1.25],speed:[0.5,0.68],  cruise:0.58},
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

// 鱼缸尺寸
const TANK={w:36,d:18,h:20.5,water:17};
const ISLAND={cx:12.5,cz:0,r:5,top:18.9};          // 晒背岛(石堆)
// 乌龟上岸路线:沿石阶而上(每点都高于下方石头顶部,防穿模)
const RAMP_PTS=[
  new THREE.Vector3(4.6,2.2,0.3),new THREE.Vector3(6.0,4.6,0.1),
  new THREE.Vector3(7.2,7.4,-0.2),new THREE.Vector3(8.4,10.6,0.2),
  new THREE.Vector3(9.6,13.6,-0.2),new THREE.Vector3(10.8,16.0,0.1),
  new THREE.Vector3(12.1,ISLAND.top+0.35,0)];
const RAMP_CURVE=new THREE.CatmullRomCurve3(RAMP_PTS);
const RAMP_A=RAMP_PTS[0].clone();                    // 乌龟上岸起点
const RAMP_B=RAMP_PTS[RAMP_PTS.length-1].clone();    // 晒背点

// ---------- renderer / camera / controls
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.setSize(innerWidth,innerHeight);
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.15;
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(50,innerWidth/innerHeight,.1,300);
camera.position.set(3,11.5,37);
const controls=new OrbitControls(camera,renderer.domElement);
controls.target.set(0,8.5,0);
controls.enableDamping=true; controls.dampingFactor=.06;
controls.minDistance=16; controls.maxDistance=75;
controls.maxPolarAngle=1.45; controls.minPolarAngle=.12;
controls.enablePan=false;
controls.autoRotate=true; controls.autoRotateSpeed=.45;
let idleT=0;
controls.addEventListener('start',()=>{controls.autoRotate=false;idleT=0;});
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);composer.setSize(innerWidth,innerHeight)});

// ---------- cinematic post
const composer=new EffectComposer(renderer);
composer.addPass(new RenderPass(scene,camera));
const bokeh=new BokehPass(scene,camera,{focus:30,aperture:.0011,maxblur:.0045});
composer.addPass(bokeh);
const bloom=new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),.32,.55,.85);
composer.addPass(bloom);
const grade=new ShaderPass({uniforms:{tDiffuse:{value:null},uTime:{value:0},uTint:{value:new THREE.Color(1,1,1)}},
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader:`uniform sampler2D tDiffuse;uniform float uTime;uniform vec3 uTint;varying vec2 vUv;
  float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
  void main(){vec2 c=vUv-.5;float r=dot(c,c);vec2 off=c*r*.012;
    vec3 col=vec3(texture2D(tDiffuse,vUv+off).r,texture2D(tDiffuse,vUv).g,texture2D(tDiffuse,vUv-off).b);
    col*=mix(vec3(1.),uTint,.25);col*=1.-r*1.1;
    col+=(h(vUv*vec2(1920.,1080.)+fract(uTime)*91.)-.5)*.025;
    gl_FragColor=vec4(max(col,0.),1.);}`});
composer.addPass(grade);
composer.addPass(new OutputPass());
let fx=true;

// ---------- shared uniforms: caustics
const U={uTime:{value:0},uCaus:{value:1}};
const causticGLSL=`
float cN(vec2 p){vec2 i=floor(p),f=fract(p);float m=1.;for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec2 g=vec2(float(x),float(y));
 vec2 o=fract(sin(vec2(dot(i+g,vec2(127.1,311.7)),dot(i+g,vec2(269.5,183.3))))*43758.5);o=.5+.5*sin(uTime*.8+6.28*o);m=min(m,length(g+o-f));}return m;}
float caustic(vec2 p){return pow(1.-cN(p*.9),6.)*1.4+pow(1.-cN(p*1.7+3.),6.)*.8;}`;

// ---------- lights
const hemi=new THREE.HemisphereLight(0x9fd8ff,0x1c2a20,.75);scene.add(hemi);
const sun=new THREE.DirectionalLight(0xfff2dd,3);sun.position.set(6,30,10);sun.castShadow=true;
Object.assign(sun.shadow.camera,{left:-26,right:26,top:26,bottom:-26});
sun.shadow.mapSize.set(2048,2048);sun.shadow.bias=-.0004;scene.add(sun);

// ---------- background: soft vertical gradient
{
  const c=document.createElement('canvas');c.width=4;c.height=256;const g=c.getContext('2d');
  const gr=g.createLinearGradient(0,0,0,256);
  gr.addColorStop(0,'#1a5a74');gr.addColorStop(.55,'#0d3a4d');gr.addColorStop(1,'#041820');
  g.fillStyle=gr;g.fillRect(0,0,4,256);
  const bg=new THREE.CanvasTexture(c);bg.colorSpace=THREE.SRGBColorSpace;
  scene.background=bg;
}
scene.fog=new THREE.FogExp2(0x0d3a4d,.015);

// ---------- sand
const sandGeo=new THREE.PlaneGeometry(37,19,110,60);sandGeo.rotateX(-Math.PI/2);
{
  const p=sandGeo.attributes.position,seed=R(0,100);
  for(let i=0;i<p.count;i++){const X=p.getX(i),Z=p.getZ(i);
    p.setY(i,Math.sin(X*.3+seed)*.25+Math.cos(Z*.4+X*.1+seed*2)*.3+Math.sin(X*2.1+Z*1.7)*.04);}
  p.needsUpdate=true;sandGeo.computeVertexNormals();
}
const sandTex=(()=>{const c=document.createElement('canvas');c.width=c.height=512;const g=c.getContext('2d');
  g.fillStyle='#d8c49a';g.fillRect(0,0,512,512);
  for(let i=0;i<26000;i++){const v=165+Math.random()*70|0;g.fillStyle=`rgb(${v},${v*.88|0},${v*.68|0})`;g.fillRect(Math.random()*512,Math.random()*512,1.6,1.6)}
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(9,6);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;return t})();
const sand=new THREE.Mesh(sandGeo,new THREE.MeshStandardMaterial({map:sandTex,roughness:1}));
sand.receiveShadow=true;scene.add(sand);
const causMesh=new THREE.Mesh(sandGeo,new THREE.ShaderMaterial({uniforms:U,transparent:true,depthWrite:false,
  blending:THREE.AdditiveBlending,polygonOffset:true,polygonOffsetFactor:-2,
  vertexShader:'varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}',
  fragmentShader:'uniform float uTime;uniform float uCaus;varying vec3 vW;'+causticGLSL+
  'void main(){float d=length(vW.xz-vec2(0.,0.))/26.;gl_FragColor=vec4(vec3(.9,1.,.85)*caustic(vW.xz)*.4*uCaus*(1.-clamp(d,0.,1.)),1.);}'}));
scene.add(causMesh);
// 水面(从下看的波光)
const surf=new THREE.Mesh(new THREE.PlaneGeometry(46,28,1,1).rotateX(Math.PI/2),new THREE.ShaderMaterial({uniforms:U,
  transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,
  vertexShader:'varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}',
  fragmentShader:'uniform float uTime;uniform float uCaus;varying vec3 vW;'+causticGLSL+
  'void main(){float d=clamp(length(vW.xz)/34.,0.,1.);float c=caustic(vW.xz*.35+vec2(uTime*.05,0.));gl_FragColor=vec4(vec3(.8,.95,1.)*(.08+c*.25)*uCaus*(1.-d),1.);}'}));
surf.position.y=TANK.water;scene.add(surf);
// 水面(从上看的一层):相机在水上时几乎透明,避免挡住俯视
const topSurf=new THREE.Mesh(new THREE.PlaneGeometry(TANK.w,TANK.d,48,24),
  new THREE.MeshPhongMaterial({color:0x2e7d9e,transparent:true,opacity:.18,shininess:60,specular:0x335566,depthWrite:false}));
topSurf.rotation.x=-Math.PI/2;topSurf.position.y=TANK.water+.02;
topSurf.material.onBeforeCompile=s=>{s.uniforms.uTime=U.uTime;
  s.vertexShader='uniform float uTime;\n'+s.vertexShader.replace('#include <begin_vertex>',
  'vec3 transformed=position;transformed.z+=sin(position.x*.9+uTime*1.4)*.08+cos(position.y*.7+uTime)*.08;')};
scene.add(topSurf);

// ---------- glass tank + frame
{
  const glassMat=new THREE.MeshPhysicalMaterial({color:0xdff2ff,transparent:true,opacity:.07,roughness:.04,
    metalness:0,side:THREE.DoubleSide,depthWrite:false});
  const mkWall=(w,h,px,py,pz,ry)=>{
    const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),glassMat);
    m.position.set(px,py,pz);m.rotation.y=ry;scene.add(m);};
  const hw=TANK.w/2,hd=TANK.d/2;
  mkWall(TANK.w,TANK.h, 0,TANK.h/2,-hd,0);
  mkWall(TANK.w,TANK.h, 0,TANK.h/2, hd,Math.PI);
  mkWall(TANK.d,TANK.h,-hw,TANK.h/2,0, Math.PI/2);
  mkWall(TANK.d,TANK.h, hw,TANK.h/2,0,-Math.PI/2);
  // 反光描边:顶部水线
  const edge=new THREE.Mesh(new THREE.BoxGeometry(TANK.w+.3,.18,TANK.d+.3),
    new THREE.MeshStandardMaterial({color:0x9fd8ff,roughness:.2,metalness:.6,emissive:0x2a4a5a,emissiveIntensity:.4}));
  edge.position.y=TANK.water;scene.add(edge);
  // 木框
  const wood=new THREE.MeshStandardMaterial({color:0x6e4f30,roughness:.65});
  const bar=(w,h,d,px,py,pz)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),wood);
    m.position.set(px,py,pz);m.castShadow=true;scene.add(m)};
  const ey=TANK.h+.25;
  for(const sx of [-1,1])for(const sz of [-1,1])bar(.7,ey,.7,sx*(hw+.15),ey/2,sz*(hd+.15));
  for(const y of [.35,ey]){bar(TANK.w+1,.7,.7,0,y,-hd-.15);bar(TANK.w+1,.7,.7,0,y,hd+.15);
    bar(.7,.7,TANK.d+1,-hw-.15,y,0);bar(.7,.7,TANK.d+1,hw-.15,y,0)}
  // 底柜
  const cab=new THREE.Mesh(new THREE.BoxGeometry(TANK.w+2.4,7,TANK.d+2.4),new THREE.MeshStandardMaterial({color:0x2c1f12,roughness:.8}));
  cab.position.y=-3.6;scene.add(cab);
}

// ---------- decor helpers (ported)
const hsl=(h,s,l)=>new THREE.Color().setHSL(((h%1)+1)%1,s,l);
function rock(r0,flat){const g=new THREE.SphereGeometry(r0,28,18),p=g.attributes.position,
    a=R(1,3),b=R(1,3),s=R(0,9),fl=flat??.62;
  for(let i=0;i<p.count;i++){const v=new THREE.Vector3().fromBufferAttribute(p,i),n=v.clone().normalize();
    const d=1+.22*Math.sin(n.x*a*2+s)*Math.cos(n.z*b*2+s)+.08*Math.sin(n.x*9+n.y*7+s);v.multiplyScalar(d);v.y*=fl;p.setXYZ(i,v.x,v.y,v.z)}
  g.computeVertexNormals();
  const r=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:hsl(R(.06,.1),R(.18,.32),R(.15,.27)),roughness:.95}));
  r.castShadow=r.receiveShadow=true;r.rotation.y=R(0,6);return r;}
function blade(color,height,width){const segs=14,g=new THREE.PlaneGeometry(width,height,1,segs);g.translate(0,height/2,0);
  const m=new THREE.MeshStandardMaterial({color,side:THREE.DoubleSide,roughness:.6});
  const ph={value:R(0,6)};
  m.onBeforeCompile=s=>{s.uniforms.uTime=U.uTime;s.uniforms.uPh=ph;s.uniforms.uH={value:height};
    s.vertexShader='uniform float uTime;uniform float uPh;uniform float uH;\n'+s.vertexShader.replace('#include <begin_vertex>',
    `vec3 transformed=position;float k=position.y/uH;transformed.x+=sin(uTime*.9+uPh+position.y*.5)*k*k*uH*.12;transformed.z+=cos(uTime*.7+uPh+position.y*.3)*k*k*uH*.08;`)};
  const mesh=new THREE.Mesh(g,m);mesh.castShadow=true;return mesh;}
const decor=new THREE.Group();scene.add(decor);
// 石头
for(let i=0;i<10;i++){const r=rock(R(.7,2.2));const x=R(-16,5.5);
  r.position.set(x,R(-.3,.1),R(-7.5,7.5));r.scale.y*=.7;decor.add(r)}
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
    const c={x:cx,z:cz,grp,h:1,health:1,baseH:1,blades:[]};
    for(let j=0;j<blades;j++){
      const col=pick(greens).clone().offsetHSL(R(-.02,.02),0,R(-.06,.06));
      const b=blade(col,R(bh*.4,bh),R(bw*.6,bw));
      b.position.set(R(-.9,.9),0,R(-.9,.9));b.rotation.y=R(0,6);
      b.userData.baseCol=b.material.color.clone();grp.add(b);c.blades.push(b);
    }
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
function updatePlants(dt){
  for(const p of plantClusters){
    const light=dayNight>0.5?0.09:0.02;
    const grow=light*(0.3+waste*1.2)*(0.5+oxygen*0.8)*dt*p.health;
    const maxH=p.baseH*(1.1+waste*0.6);
    if(p.health>0.2)p.h=Math.min(maxH,p.h+grow);
    waste=Math.max(0,waste-p.h*p.health*0.006*dt);
    oxygen=clamp(oxygen+p.h*p.health*(dayNight>0.5?0.030:-0.006)*dt,0,1);
    if(quality<0.3)p.health=Math.max(0.12,p.health-0.03*dt);
    else p.health=Math.min(1,p.health+0.012*dt);
    p.grp.scale.y=p.h;
    const sickK=(1-p.health)*0.75; // 水质太差 → 水草枯黄
    for(const b of p.blades)b.material.color.copy(b.userData.baseCol).lerp(SICK_LEAF,sickK);
    p.grp.visible=p.h>0.05;
  }
}
function trimPlants(){
  for(const p of plantClusters)if(p.h>p.baseH*0.7){p.h*=0.65;waste=Math.min(1,waste+0.04);}
  toast('🌿 水草已修剪');blip(420,0.12,0.09);
}
// 取暖灯
const lampLight=new THREE.SpotLight(0xffc37a,30,45,.5,.45,1.6);
const lampGlow=(()=>{const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d');
  const gr=g.createRadialGradient(64,64,4,64,64,64);gr.addColorStop(0,'rgba(255,210,140,.9)');gr.addColorStop(1,'rgba(255,180,100,0)');
  g.fillStyle=gr;g.fillRect(0,0,128,128);const t=new THREE.CanvasTexture(c);
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));
  sp.scale.setScalar(7);return sp})();
{
  const g=new THREE.Group();
  const cord=new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,8),new THREE.MeshStandardMaterial({color:0x111111}));
  cord.position.y=4;g.add(cord);
  const shade=new THREE.Mesh(new THREE.ConeGeometry(1.6,1.8,24,1,true),
    new THREE.MeshStandardMaterial({color:0x222222,roughness:.5,metalness:.7,side:THREE.DoubleSide}));
  g.add(shade);
  const bulb=new THREE.Mesh(new THREE.SphereGeometry(.45,16,12),
    new THREE.MeshBasicMaterial({color:0xffd9a0}));
  bulb.position.y=-.6;g.add(bulb);
  lampGlow.position.y=-.6;g.add(lampGlow);
  g.position.set(RAMP_B.x,27,RAMP_B.z);scene.add(g);
  lampLight.position.set(RAMP_B.x,26.4,RAMP_B.z);
  lampLight.target.position.set(RAMP_B.x,RAMP_B.y,RAMP_B.z);
  scene.add(lampLight,lampLight.target);
}

// ---------- procedural fish (genome, ported; 淡水配色)
let genomeId=0;
function genGenome(){
  const big=chance(.05),tiny=!big&&chance(.2);
  const g={id:genomeId++,len:big?R(2.6,4):tiny?R(.4,.7):R(.9,2)};
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
function finTexture(col){const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d');
  x.fillStyle='#'+col.getHexString();x.fillRect(0,0,128,128);x.strokeStyle='rgba(0,0,0,.35)';x.lineWidth=1.2;
  for(let i=0;i<16;i++){x.beginPath();x.moveTo(64,128);x.lineTo(i*8.5,0);x.stroke()}
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;}
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
  const er=Math.max(H*.12,L*g.eye*.5);
  const irisM=new THREE.MeshStandardMaterial({color:hsl(R(.08,.16),R(.3,.8),R(.35,.7)),roughness:.4});
  const pupM=new THREE.MeshStandardMaterial({color:0x020202,roughness:.1});
  for(const s of [1,-1]){const e=new THREE.Group();
    e.add(new THREE.Mesh(new THREE.SphereGeometry(er,20,14),irisM));
    const pu=new THREE.Mesh(new THREE.SphereGeometry(er*.62,16,12),pupM);pu.position.z=s*er*.5;e.add(pu);
    e.position.set(L*.34,H*.1,s*Wd*.36*.9);e.scale.z=.6;grp.add(e)}
  return {grp,U2,bodyMat:mat};}

// ---------- GLB models: 自动摆正(+X为头), 肚皮贴地, 缩放到目标体长
function orientModel(root,headName,tailName,targetLen){
  root.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(root);
  const size=box.getSize(new THREE.Vector3());
  const ax=size.x>=size.z?'x':'z';
  let head=null,tail=null;
  root.traverse(o=>{if(o.name===headName)head=o;if(o.name===tailName)tail=o;});
  const inner=new THREE.Group();inner.add(root);
  if(head&&tail){
    const hp=new THREE.Vector3(),tp=new THREE.Vector3();
    head.getWorldPosition(hp);tail.getWorldPosition(tp);
    const dir=hp[ax]-tp[ax];
    if(ax==='z')inner.rotation.y=dir>0?Math.PI/2:-Math.PI/2;
    else if(dir<0)inner.rotation.y=Math.PI;
  }else if(ax==='z'){inner.rotation.y=Math.PI/2;}
  inner.position.y=-box.min.y;
  const wrap=new THREE.Group();wrap.add(inner);
  wrap.scale.setScalar(targetLen/Math.max(size.x,size.z));
  return wrap;}
const mixers=[];
function loadGLB(url,headName,tailName,targetLen,onReady){
  fetch(url).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.arrayBuffer();})
  .then(buf=>{new GLTFLoader().parse(buf,'',gltf=>{
    const root=gltf.scene;
    root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.frustumCulled=false;}});
    const wrap=orientModel(root,headName,tailName,targetLen);
    let mixer=null;
    if(gltf.animations.length){mixer=new THREE.AnimationMixer(root);
      mixer.clipAction(gltf.animations[0]).play();mixers.push(mixer);}
    scene.add(wrap);
    onReady(wrap,mixer);
  },e=>console.warn('glb parse',url,e));})
  .catch(e=>console.warn('glb fetch',url,e));}

// ---------- fish population (生态版: 2D 规则 → 3D)
const fish=[],food=[];
const bounds={xMin:-16.5,xMax:6.8,yMin:1,yMax:15,zMin:-8,zMax:8};
const adultsAlive=()=>fish.filter(f=>f.alive&&f.stage==='adult').length;
const STRESS_EMISSIVE=new THREE.Color(0xb05a28);
function addFishEntry(grp,U2,g,mixer,eco){
  const f=Object.assign({g,grp,U2,mixer:mixer||null,bodyMat:null,
    vel:new THREE.Vector3(R(-1,1),R(-.1,.1),R(-.3,.3)).setLength(g.speed*1.5),
    target:new THREE.Vector3(),tt:0,alive:true,
    stage:'adult',age:R(20,60),hunger:R(.35,.6),armor:0,bites:0,biteFlash:0,
    breedCD:R(10,20),courtT:0,starveT:0,mode:'cruise',dartT:0,breed:null,hue:null,koi:false},
    eco||{});
  newTarget(f);scene.add(grp);fish.push(f);return f;}
function newTarget(f){
  const night=dayTarget<0.5,P=f.grp.position;
  f.target.set(R(bounds.xMin+1,bounds.xMax-1),
    night&&chance(.7)?R(1.5,4):R(bounds.yMin+1,bounds.yMax-2),
    R(bounds.zMin+1,bounds.zMax-1));
  f.tt=R(4,9);
}
function removeFish(f){scene.remove(f.grp);f.grp.traverse(o=>{if(o.material){o.material.map?.dispose?.();o.material.dispose?.()}});
  fish.splice(fish.indexOf(f),1);}
// 程序化鱼: 指定品种+体色(2D 三品种)
function spawnEcoFish(breed,hue,stage,pos){
  breed=breed||pick(['comet','fantail','pearl']);hue=hue||pick(PALETTES);
  const g=genGenomeFor(breed,hue);
  if(stage==='baby'){g.len*=.45;g.h*=.45;g.w*=.45;}
  const {grp,U2,bodyMat}=buildFish(g);
  grp.position.copy(pos||new THREE.Vector3(R(-12,4),R(2,12),R(-6,6)));
  const f=addFishEntry(grp,U2,g,null,{breed,hue,stage:stage||'adult',bodyMat,
    hunger:stage==='baby'?0.4:R(.35,.6),age:stage==='baby'?0:R(20,60)});
  f.baseEmissive=bodyMat.emissive.clone();
  return f;
}
// 锦鲤(GLB): 完整生态行为, 不参与繁殖(花纹固定)
let koiCount=0;
function spawnKoi(){
  loadGLB(MODEL_URL.koi,'Bone.006_end_08','Bone.004_end_07',R(1.5,1.9),(wrap)=>{
    let bodyMat=null;
    wrap.traverse(o=>{if(o.isMesh){o.material=o.material.clone();if(!bodyMat)bodyMat=o.material;}});
    const g={id:genomeId++,len:1.7,h:.5,w:.3,school:false,speed:R(.8,1.1),freq:4,cruise:1,scanned:true};
    wrap.position.set(R(-12,0),R(3,10),R(-5,5));
    const f=addFishEntry(wrap,null,g,null,{breed:'comet',koi:true,bodyMat});
    f.baseEmissive=bodyMat?bodyMat.emissive.clone():new THREE.Color(0,0,0);
    koiCount++;syncFishSub();
  });}
function fishDie(f,cause){
  if(!f.alive)return;f.alive=false;
  waste=Math.min(1,waste+(f.stage==='adult'?0.04:0.05));
  dropFood(f.grp.position.x,f.grp.position.z,1,true); // 尸体(乌龟会清理)
  if(cause==='starve')toast('🐟 有鱼饿死了! 快投食');
  else if(cause==='env')toast('☠️ 水质恶化致死! 快换水');
  else if(cause!=='eaten')toast('🐟 一条鱼死了');
  blip(200,0.2,0.08,'triangle');
}
function fishStress(f){
  let s=0;
  if(f.hunger<0.35)s+=(0.35-f.hunger)*1.4;
  if(f.hunger<0.15)s+=0.25;
  if(quality<0.45)s+=(0.45-quality)*0.9;
  if(oxygen<0.4)s+=(0.4-oxygen)*1.1;
  if(f.mode==='flee')s+=0.35;
  return clamp(s,0,1);
}
function tryBreed(f,dt){
  if(f.koi||f.stage!=='adult'||f.breedCD>0)return;
  if(f.hunger<0.35||f.hunger>0.95||quality<0.5||oxygen<0.35)return;
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
      toast('💕 金鱼产卵了!');blip(520,0.15,0.09);
    }
  }else f.courtT=0;
}
const _fv=new THREE.Vector3();
function updateFish(f,dt,t){
  if(!f.alive)return;
  const P=f.grp.position,adult=f.stage==='adult';
  f.age+=dt;f.breedCD-=dt;
  if(f.biteFlash>0)f.biteFlash=Math.max(0,f.biteFlash-dt);
  // 代谢: 耗氧, 产废物
  f.hunger=Math.max(0,f.hunger-dt*(adult?0.011:0.03));
  waste=Math.min(1,waste+dt*(adult?0.0016:0.0012));
  oxygen=Math.max(0,oxygen-dt*(adult?0.0042:0.0038));
  if(!adult&&f.age>(oxygen>0.55?16:20)){ // 长大
    f.stage='adult';f.grp.scale.multiplyScalar(2.1);
    f.g.speed*=.9;
  }
  if(f.hunger<=0.01){f.starveT+=dt;if(f.starveT>4){fishDie(f,'starve');return;}}
  else f.starveT=0;
  if(quality<(adult?0.07:0.13)&&chance(0.05*dt)){fishDie(f,'env');return;}
  if(oxygen<(adult?0.05:0.09)&&chance(0.06*dt)){fishDie(f,'env');return;}
  // —— 行为决策 ——
  const T=turtle.grp;
  let danger=Infinity;
  if(T&&!turtle.peaceful)danger=T.position.distanceTo(P);
  const fleeR=(f.stage==='baby'?7:5.5)+(turtle.state==='hunt'?1.5:0);
  f.tt-=dt;
  if(danger<fleeR){
    f.mode='flee';
    let bp=plantClusters[0],bs=-1; // 躲进最茂盛的水草
    for(const p of plantClusters){const s=p.h*p.health;if(s>bs){bs=s;bp=p;}}
    f.target.set(bp.x+R(-1,1),R(2,6),bp.z+R(-1,1));f.tt=0.8;
  }else{
    if(f.mode==='flee')f.mode='cruise';
    if(f.hunger<0.8){
      let best=null,bd=Infinity;
      for(const fd of food){if(fd.userData.eaten)continue;
        if(turtle.state==='hunt'&&T&&fd.position.distanceTo(T.position)<3)continue;
        const d=fd.position.distanceTo(P);if(d<bd){bd=d;best=fd;}}
      if(best){
        f.mode='forage';f.target.copy(best.position);
        if(bd<(adult?.9:.7)){
          best.userData.eaten=true;
          f.hunger=Math.min(1,f.hunger+0.38);
          if(adult)f.armor=Math.min(1,f.armor+0.15); // 吃饱长铠甲
          scene.remove(best);food.splice(food.indexOf(best),1);
        }
      }else if(f.tt<0){f.mode='cruise';newTarget(f);}
    }else if(f.tt<0){f.mode='cruise';newTarget(f);}
  }
  tryBreed(f,dt);
  // 草金吃饱后偶尔嬉戏冲刺
  if(f.breed==='comet'&&f.mode==='cruise'&&f.dartT<=0&&f.hunger>0.5&&chance(dt*0.12)){
    f.dartT=1.1;
    f.target.set(clamp(P.x+R(-8,8),bounds.xMin,bounds.xMax),
      clamp(P.y+R(-3,3),bounds.yMin,bounds.yMax),clamp(P.z+R(-4,4),bounds.zMin,bounds.zMax));
  }
  // —— 移动 ——
  let sp=f.g.speed*(f.g.cruise||1)*(f.mode==='flee'?1.9:f.mode==='forage'?1.25:f.mode==='court'?0.9:0.8);
  if(quality<0.3)sp*=0.75;
  if(oxygen<0.25)sp*=0.7;
  if(f.hunger<0.2)sp*=0.7;
  if(dayTarget<0.5)sp*=0.45; // 夜里沉底休息
  if(f.dartT>0){f.dartT-=dt;sp*=2.1;}
  _fv.subVectors(f.target,P);
  const dist=_fv.length();
  if(dist>0.01)_fv.setLength(sp*1.6);
  f.vel.lerp(_fv,dt*(f.mode==='flee'?1.8:0.6));
  // 群游: 巡游时轻微跟随邻居
  if(f.mode==='cruise'){
    _o.set(0,0,0);let nn=0;
    for(const o of fish){if(o===f||!o.alive)continue;
      if(o.grp.position.distanceTo(P)<7){_o.add(o.vel);nn++;}}
    if(nn>0)f.vel.lerp(_o.multiplyScalar(1/nn),dt*0.5);
  }
  f.vel.y*=.985;P.addScaledVector(f.vel,dt);
  P.x=clamp(P.x,bounds.xMin,bounds.xMax);P.y=clamp(P.y,bounds.yMin,bounds.yMax);P.z=clamp(P.z,bounds.zMin,bounds.zMax);
  const spd=f.vel.length();
  if(f.U2){f.U2.uPh.value+=dt*f.g.freq*(.4+spd*.5);
    f.U2.uAmp.value=lerp(f.U2.uAmp.value,.12+Math.min(spd,4)*.09,dt*2);}
  if(spd>.02){_m.lookAt(_o,f.vel,_up);_q.setFromRotationMatrix(_m).multiply(_yr);
    f.grp.quaternion.slerp(_q,Math.min(1,dt*2.5));}
  // —— 紧迫体色: 发红 + 被咬闪红 ——
  if(f.bodyMat){
    const s=fishStress(f);
    f.bodyMat.emissive.copy(f.baseEmissive).lerp(STRESS_EMISSIVE,s*0.55);
    if(f.biteFlash>0)f.bodyMat.emissive.lerp(new THREE.Color(0xff2814),Math.min(0.6,f.biteFlash));
  }
}

// ---------- turtle (生态版: 捕猎/呼吸/睡眠/晒背/狂暴)
// 状态: swim 戏水 | hunt 捕猎 | surface 上浮换气 | toRamp/climb/bask/slide 晒背流程 | sleep 夜眠
const turtle={grp:null,mixer:null,state:'swim',t:R(20,40),vel:new THREE.Vector3(),target:new THREE.Vector3(),
  climbT:0,baskQ:new THREE.Quaternion(),
  hunger:0.35,eatTimer:0,belly:0,baskTimer:R(22,32),breath:1,breathWarned:false,
  frenzy:false,frenzyTimer:0,peaceful:true,sleepPos:new THREE.Vector3(),_ps:'swim'};
function turtleTarget(){turtle.target.set(R(-15,5),R(2.5,12),R(-7,7));}
loadGLB(MODEL_URL.turtle,'head_05','tail1_01',2.7,(wrap,mixer)=>{
  turtle.grp=wrap;turtle.mixer=mixer;
  wrap.position.set(-6,6,2);turtleTarget();turtle.t=R(25,45);
});
function turtleFindPrey(){
  const T=turtle.grp.position;let bt=null,bd=Infinity,kind=null;
  for(const fd of food){
    if(fd.userData.eaten)continue;
    const d=fd.position.distanceTo(T)+(fd.userData.corpse?-2:0);
    if(d<bd){bd=d;bt=fd;kind='food';}
  }
  for(const e of eggs){
    if(!e.alive)continue;
    const cover=plantCoverAt(e.x,e.z);
    if(!turtle.frenzy&&cover>0.55)continue; // 藏好的卵吃不到
    const d=e.mesh.position.distanceTo(T)+cover*8;
    if(d<bd){bd=d;bt=e;kind='egg';}
  }
  for(const f of fish){
    if(!f.alive||f.armor>=0.4)continue; // 铠甲鱼吃不动
    let shielded=false;
    for(const a of fish){ // 铠甲鱼保护身边小鱼
      if(a!==f&&a.alive&&a.armor>=0.4&&a.grp.position.distanceTo(f.grp.position)<3){shielded=true;break;}
    }
    if(shielded)continue;
    if(turtle.frenzy){
      const d=f.grp.position.distanceTo(T);
      if(d<bd){bd=d;bt=f;kind=f.stage==='adult'?'adult':'baby';}
      continue;
    }
    if(f.stage!=='baby')continue;
    const cover=plantCoverAt(f.grp.position.x,f.grp.position.z);
    if(cover>0.5)continue; // 躲进水草就安全
    const d=f.grp.position.distanceTo(T)+cover*10;
    if(d<bd){bd=d;bt=f;kind='baby';}
  }
  return bt?{target:bt,dist:bd,kind}:null;
}
function turtleEat(target,kind){
  if(kind==='food'){target.userData.eaten=true;scene.remove(target);food.splice(food.indexOf(target),1);}
  else if(kind==='egg')target.alive=false;
  else if(kind==='baby'){fishDie(target,'eaten');toast('🦖 乌龟吃掉了一条小鱼!');}
  else if(kind==='adult'){
    target.bites=(target.bites||0)+1;target.biteFlash=0.4;
    if(target.bites>=3){fishDie(target,'eaten');toast('🦖 大鱼被乌龟吃掉了!');}
    else toast('🦖 乌龟在咬大鱼!');
  }
  turtle.eatTimer=turtle.frenzy?0.3:0.55;
  turtle.hunger=clamp(turtle.hunger-(kind==='baby'?0.5:kind==='egg'?0.2:kind==='adult'?0.3:0.32),0,1);
  turtle.belly=Math.min(1,turtle.belly+(kind==='baby'?0.4:kind==='egg'?0.15:kind==='adult'?0.5:0.28));
  waste=Math.min(1,waste+(kind==='adult'?0.02:0.01));
  blip(kind==='adult'?160:220,0.12,0.09);
}
const _tv=new THREE.Vector3(),_tq=new THREE.Quaternion(),_tm=new THREE.Matrix4(),
  _tup=new THREE.Vector3(0,1,0),_tyr=new THREE.Quaternion().setFromAxisAngle(_tup,Math.PI/2),_to=new THREE.Vector3();
function faceVel(obj,vel,k,dt){
  if(vel.lengthSq()>.0004){_tm.lookAt(_to,vel,_tup);_tq.setFromRotationMatrix(_tm).multiply(_tyr);
    obj.quaternion.slerp(_tq,Math.min(1,dt*k));}}
function updateTurtle(dt,t){
  const T=turtle;if(!T.grp)return;const P=T.grp.position;
  if(T.eatTimer>0)T.eatTimer-=dt;
  const night=dayTarget<0.5;
  if(T.frenzy){ // 狂暴 20 秒
    T.frenzyTimer-=dt;
    if(T.frenzyTimer<=0){T.frenzy=false;
      if(night){T.state='sleep';T.sleepPos.set(R(-12,4),0.8,R(-5,5));}
      toast('🦖 乌龟冷静下来了');}
  }
  T.hunger=clamp(T.hunger+dt*0.01,0,1);
  // —— 呼吸: 水下持续耗气(约50秒), 睡眠极慢; 水面/晒背快速回气 ——
  const under=T.state!=='surface'&&T.state!=='bask'&&T.state!=='climb'&&T.state!=='slide';
  if(under)T.breath=Math.max(0,T.breath-dt*(T.state==='sleep'?0.004:0.02));
  else T.breath=Math.min(1,T.breath+dt*0.6);
  if(T.breath<0.25&&under){
    T.state='surface';T.t=3;
    if(!T.breathWarned){T.breathWarned=true;toast('🐢 乌龟上浮换气');}
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
    if(T.mixer)T.mixer.timeScale=.15;
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
        if(T.mixer)T.mixer.timeScale=1;
      }
    }
  }else if(T.state==='hunt'){
    const found=turtleFindPrey();
    if(found){
      const tp=found.kind==='egg'?found.target.mesh.position:found.target.position||found.target.grp.position;
      T.target.copy(tp);
      const rr=found.kind==='baby'?1.6:found.kind==='adult'?2:1.4;
      const d=P.distanceTo(tp);
      if(d<rr)turtleEat(found.target,found.kind);
    }else if(P.distanceTo(T.target)<1.5){turtleTarget();}
    if(!T.frenzy){
      if(T.hunger<0.2)T.state='swim';
      T.baskTimer-=dt;
      if(T.baskTimer<=0)T.state='surface';
    }
    _tv.subVectors(T.target,P).setLength(T.frenzy?3.4:2.4);T.vel.lerp(_tv,dt*.8);
    P.addScaledVector(T.vel,dt);
    P.x=clamp(P.x,-16,6.2);P.y=clamp(P.y,1,15);P.z=clamp(P.z,-7.5,7.5);
    faceVel(T.grp,T.vel,3,dt);
    if(T.mixer)T.mixer.timeScale=1.4;
  }else if(T.state==='surface'){
    T.target.set(ISLAND.cx-2,TANK.water-1.2,0); // 水面换气(岛边)
    _tv.subVectors(T.target,P).setLength(1.6);T.vel.lerp(_tv,dt*.8);
    P.addScaledVector(T.vel,dt);faceVel(T.grp,T.vel,2.5,dt);
    if(T.mixer)T.mixer.timeScale=.8;
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
    if(T.mixer)T.mixer.timeScale=.5;
    if(T.climbT>=1){T.state='bask';T.t=R(20,40);T.baskQ.copy(T.grp.quaternion);}
  }else if(T.state==='bask'){
    T.t-=dt;
    T.hunger=Math.max(0,T.hunger-dt*0.03); // 晒太阳消化
    T.belly=Math.max(0,T.belly-dt*0.05);
    P.copy(RAMP_B);P.y+=Math.sin(t*.8)*.05;
    T.grp.quaternion.slerp(T.baskQ,Math.min(1,dt*1.5));
    if(T.mixer)T.mixer.timeScale=.1;
    if(T.t<0){T.state='slide';T.climbT=0;}
  }else if(T.state==='slide'){
    T.climbT+=dt/3.5;
    const k=Math.min(1,T.climbT);
    RAMP_CURVE.getPoint(1-k*k,P);
    RAMP_CURVE.getTangent(Math.max(0,1-k),_tv);_tv.negate();T.vel.copy(_tv);
    faceVel(T.grp,T.vel,3,dt);
    if(T.mixer)T.mixer.timeScale=.8;
    if(T.climbT>=1){T.state='swim';T.t=R(30,60);T.baskTimer=R(22,32);turtleTarget();}
  }
}
// ---------- ambient: motes & bubbles
const moteGeo=new THREE.BufferGeometry().setAttribute('position',
  new THREE.Float32BufferAttribute(Array.from({length:4500},(_,i)=>i%3===1?R(0,17):i%3===0?R(-17,17):R(-8.5,8.5)),3));
scene.add(new THREE.Points(moteGeo,new THREE.PointsMaterial({color:0xffffff,size:.05,transparent:true,opacity:.4,depthWrite:false})));
const bubGeo=new THREE.SphereGeometry(.07,10,8),
  bubMat=new THREE.MeshPhysicalMaterial({color:0xffffff,roughness:0,transparent:true,opacity:.35,clearcoat:1});
const bubbles=[],bubbleSrc=[new THREE.Vector3(-13,.2,-5),new THREE.Vector3(-6,.2,6)];
for(let i=0;i<70;i++){const b=new THREE.Mesh(bubGeo,bubMat);const s=bubbleSrc[i%2];
  b.position.set(s.x+R(-.3,.3),R(0,16),s.z+R(-.3,.3));b.scale.setScalar(R(.4,1.6));
  b.userData.s=i%2;scene.add(b);bubbles.push(b)}

// ---------- food (生态: 下沉+腐烂→废物, 尸体可被乌龟清理)
const foodGeo=new THREE.IcosahedronGeometry(.09,0),
  foodMat=new THREE.MeshStandardMaterial({color:0xc07a2e,roughness:.9}),
  rotMat=new THREE.MeshStandardMaterial({color:0x8a6a3a,roughness:.95});
function dropFood(x,z,n,corpse){
  n=n||1;
  for(let i=0;i<n;i++){
    const m=new THREE.Mesh(foodGeo,corpse?rotMat:foodMat);
    m.position.set(x+R(-1.5,1.5),TANK.water-.5,(z??R(-4,4))+R(-1.5,1.5));
    m.userData={w:R(0,6),eaten:false,age:0,corpse:!!corpse};
    if(corpse)m.scale.setScalar(1.7);
    scene.add(m);food.push(m);
  }
}
function feed(x,z){dropFood(x,z,12,false);}
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
        waste=Math.min(1,waste+(f.userData.corpse?0.05:0.02));
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
    if(quality<0.25&&chance(0.2*dt)){scene.remove(e.mesh);continue;} // 水质太差卵坏死
    if(e.age>=e.hatchIn){
      scene.remove(e.mesh);
      if(fish.filter(f=>f.alive).length<MAX_FISH&&quality>0.3){
        spawnEcoFish(chance(.5)?e.breedA:e.breedB,mixHue(e.hueA,e.hueB),'baby',e.mesh.position.clone());
        toast('🐣 小鱼孵化了!');blip(700,0.12,0.08);
      }
      continue;
    }
    eggs[w++]=e;
  }
  eggs.length=w;
}
// ---------- 生态主更新
function updateEco(dt){
  if(filterOn){
    waste=Math.max(0,waste-0.030*dt);
    oxygen=Math.min(1,oxygen+0.020*dt);
  }else{
    oxygen=clamp(oxygen+(dayNight>0.5?0.008:-0.004)*dt,0,1);
  }
  const n=fish.filter(f=>f.alive).length;
  if(n>6)waste=Math.min(1,waste+0.002*(n-6)*dt); // 过密加剧污染
  if(dayNight<0.5)oxygen=Math.max(0,oxygen-0.004*dt); // 夜晚耗氧
  const target=clamp(1-waste*0.9-Math.max(0,n-6)*0.03,0,1);
  quality+=(target-quality)*Math.min(1,dt*0.6);
  for(let i=fish.length-1;i>=0;i--)if(!fish[i].alive)removeFish(fish[i]); // 清理死鱼
}
// TP 铜牌商标: 底柜正面中央, 点击打开鱼缸管家(无手势后的唯一入口)
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
const plaqueRay=new THREE.Raycaster(),plaqueNdc=new THREE.Vector2();
function plaqueHit(e){
  plaqueNdc.set(e.clientX/innerWidth*2-1,-(e.clientY/innerHeight)*2+1);
  plaqueRay.setFromCamera(plaqueNdc,camera);
  return plaqueRay.intersectObject(plaque,false).length>0;
}
// 手势: 点按喂食 · 长按开管家 · 拖动旋转 · 双指缩放 · 10秒闲置自动环绕(点铜牌只开管家不喂食)
const ray=new THREE.Raycaster(),ndc=new THREE.Vector2();
let pdown=null,lpTimer=null,lpFired=false;
const TAP_LIM=8,LP_LIM=14,LP_MS=550;
renderer.domElement.addEventListener('pointerdown',e=>{
  idleT=0;lpFired=false;
  pdown={x:e.clientX,y:e.clientY,t:performance.now()};
  $('dash').classList.remove('open');
  try{renderer.domElement.setPointerCapture(e.pointerId);}catch(_){}
  clearTimeout(lpTimer);
  lpTimer=setTimeout(()=>{lpFired=true;openSheet();},LP_MS);
});
renderer.domElement.addEventListener('pointermove',e=>{
  if(!pdown||lpFired){
    renderer.domElement.style.cursor=plaqueHit(e)?'pointer':'default';
    return;
  }
  if(Math.hypot(e.clientX-pdown.x,e.clientY-pdown.y)>LP_LIM)clearTimeout(lpTimer);
});
const endPointer=e=>{
  if(!pdown)return;
  clearTimeout(lpTimer);
  const wasLp=lpFired;
  const moved=Math.hypot(e.clientX-pdown.x,e.clientY-pdown.y);
  const dtMs=performance.now()-pdown.t;
  pdown=null;lpFired=false;
  if(wasLp)return;
  if(moved<TAP_LIM&&dtMs<600){
    if(plaqueHit(e)){openSheet();return;}
    ndc.set(e.clientX/innerWidth*2-1,-(e.clientY/innerHeight)*2+1);
    ray.setFromCamera(ndc,camera);
    const t=(TANK.water-4-ray.ray.origin.y)/ray.ray.direction.y;
    if(t>0){const p=ray.ray.at(t,new THREE.Vector3());
      feed(clamp(p.x,-15,5),clamp(p.z,-7,7));}
  }
};
renderer.domElement.addEventListener('pointerup',endPointer);
renderer.domElement.addEventListener('pointercancel',()=>{pdown=null;lpFired=false;clearTimeout(lpTimer);});

// ---------- day / night
const dayCfg={sun:3,sunCol:new THREE.Color(0xfff2dd),hemi:.75,bg:new THREE.Color(0x1a5a74),
  fog:.015,caus:1,lamp:30,exposure:1.15};
const nightCfg={sun:.22,sunCol:new THREE.Color(0x8fb4dd),hemi:.22,bg:new THREE.Color(0x020d16),
  fog:.024,caus:.12,lamp:110,exposure:.95};
let dayNight=1,dayTarget=1; // 1=day 0=night
function applyDayNight(k,dt){
  dayNight+=(dayTarget-dayNight)*Math.min(1,dt*1.5);
  const d=dayNight;
  sun.intensity=lerp(nightCfg.sun,dayCfg.sun,d);
  sun.color.lerpColors(nightCfg.sunCol,dayCfg.sunCol,d);
  hemi.intensity=lerp(nightCfg.hemi,dayCfg.hemi,d);
  scene.fog.density=lerp(nightCfg.fog,dayCfg.fog,d);
  U.uCaus.value=lerp(nightCfg.caus,dayCfg.caus,d);
  lampLight.intensity=lerp(nightCfg.lamp,dayCfg.lamp,d);
  lampGlow.material.opacity=lerp(.95,.45,d);
  renderer.toneMappingExposure=lerp(nightCfg.exposure,dayCfg.exposure,d);
}

// ---------- main loop
const clock=new THREE.Clock(),_v=new THREE.Vector3(),_q=new THREE.Quaternion(),_m=new THREE.Matrix4(),
  _up=new THREE.Vector3(0,1,0),_yr=new THREE.Quaternion().setFromAxisAngle(_up,Math.PI/2),_o=new THREE.Vector3();
let turnT=12,firstFrame=true;
function tick(){
  const rdt=Math.min(clock.getDelta(),.05),dt=rdt,t=clock.elapsedTime;
  U.uTime.value=t;
  applyDayNight(0,rdt);
  idleT+=rdt;
  if(idleT>10&&!controls.autoRotate)controls.autoRotate=true;
  controls.update();
  // 相机在水面上方时:水面几乎透明 + 藏起"从下看的波光",避免俯视被挡
  const aboveWater=camera.position.y>TANK.water+.5;
  topSurf.material.opacity+=(((aboveWater)?.06:.18)-topSurf.material.opacity)*Math.min(1,rdt*4);
  surf.visible=!aboveWater;
  if(t>turnT){turnT=t+R(14,30);}
  // 生态更新
  updatePlants(dt);
  updateFood(dt,t);
  updateEggs(dt,t);
  updateEco(dt);
  for(const f of fish)updateFish(f,dt,t);
  for(const m of mixers)m.update(dt);
  updateTurtle(dt,t);
  for(const b of bubbles){b.position.y+=dt*(1.1+b.scale.x);
    b.position.x+=Math.sin(t*3+b.userData.s*2)*.005;
    if(b.position.y>TANK.water-.3){const s=bubbleSrc[b.userData.s];b.position.set(s.x+R(-.3,.3),.2,s.z+R(-.3,.3))}}
  const mp=moteGeo.attributes.position.array;
  for(let i=0;i<mp.length;i+=3){mp[i+1]+=dt*.05;if(mp[i+1]>17)mp[i+1]=0}
  moteGeo.attributes.position.needsUpdate=true;
  grade.uniforms.uTime.value=t;
  grade.uniforms.uTint.value.set(0x9fc8dd).multiplyScalar(.4+.6*dayNight);
  bokeh.uniforms.focus.value=camera.position.distanceTo(_v.set(0,9,0));
  updateHUD(rdt);
  saveT+=rdt;if(saveT>5){saveT=0;saveGame();} // 5秒自动存档
  if(fx)composer.render();else renderer.render(scene,camera);
  if(firstFrame){firstFrame=false;
    setTimeout(()=>{const l=$('loading');l.style.opacity=0;setTimeout(()=>l.remove(),900);
      setTimeout(()=>$('hint').style.opacity=0,9000);},400);}
  requestAnimationFrame(tick);
}

// ---------- HUD: toast / 警报 / 水状态仪表盘
const toastEl=$('toast'),alertEl=$('alert');
let toastTimer=null;const toastQ=[];
function toast(msg){
  if(toastQ.length>2)toastQ.shift();
  toastQ.push(msg);
  if(!toastTimer)nextToast();
}
function nextToast(){
  const m=toastQ.shift();
  if(!m){toastTimer=null;return;}
  toastEl.textContent=m;toastEl.classList.add('show');
  toastTimer=setTimeout(()=>{
    toastEl.classList.remove('show');
    toastTimer=setTimeout(nextToast,300);
  },1500);
}
const dashEl=$('dash');
$('dashPill').onclick=e=>{e.stopPropagation();dashEl.classList.toggle('open');};
const barColor=v=>v>0.55?'#3dcc7a':v>0.3?'#d4a017':'#d4452f';
function advice(){
  const tips=[];
  if(waste>0.55&&!filterOn)tips.push('开过滤');
  if(waste>0.7)tips.push('换水');
  if(oxygen<0.35)tips.push('缺氧');
  if(food.filter(f=>!f.userData.eaten&&!f.userData.corpse&&f.userData.age>6).length>2)tips.push('残饵多');
  const hungry=fish.filter(f=>f.alive&&f.hunger<0.25).length;
  if(hungry)tips.push(hungry+'条鱼饿');
  if(fish.filter(f=>f.alive).length>=MAX_FISH)tips.push('已满员');
  return tips.slice(0,2).join(' · ')||'生态稳定 🌿';
}
let hudT=0;
function updateHUD(dt){
  hudT-=dt;if(hudT>0)return;hudT=0.25;
  const q=Math.round(quality*100),o=Math.round(oxygen*100),w=Math.round(waste*100);
  $('qFill').style.width=q+'%';$('qFill').style.background=barColor(quality);$('qVal').textContent=q+'%';
  $('oFill').style.width=o+'%';
  $('oFill').style.background=oxygen>0.55?'#5ec8ff':oxygen>0.3?'#d4a017':'#d4452f';
  $('oVal').textContent=o+'%';
  $('wFill').style.width=w+'%';
  $('wFill').style.background=waste>0.6?'#d4452f':waste>0.35?'#d4a017':'#3dcc7a';
  $('wVal').textContent=w+'%';
  const alive=fish.filter(f=>f.alive).length;
  const babies=fish.filter(f=>f.alive&&f.stage==='baby').length;
  $('fishVal').textContent='🐟 '+alive+(babies?'(幼'+babies+')':'')+(eggs.length?' 🥚'+eggs.length:'');
  $('dayVal').textContent=dayTarget>0.5?'☀️':'🌙';
  $('filterVal').textContent=filterOn?'🌀开':'🌀关';
  $('advice').textContent=advice();
  $('dQ').style.background=barColor(quality);
  $('dO').style.background=oxygen>0.55?'#5ec8ff':oxygen>0.3?'#d4a017':'#d4452f';
  $('dW').style.background=waste>0.6?'#d4452f':waste>0.35?'#d4a017':'#3dcc7a';
  $('dashMini').textContent='水质'+q+'%';
  let msg='';
  if(quality<0.18)msg='⚠️ 水质危险! 请换水';
  else if(oxygen<0.2)msg='⚠️ 严重缺氧! 请开过滤';
  else if(fish.some(f=>f.alive&&f.hunger<0.12))msg='⚠️ 有鱼快饿死了!';
  $('dashPill').classList.toggle('warn',!!msg);
  if(msg){alertEl.textContent=msg;alertEl.classList.add('show');}
  else alertEl.classList.remove('show');
}

// ---------- 工具栏弹窗
const openSheet=()=>{$('sheet').classList.add('open');$('sheetBg').classList.add('open');};
const closeSheet=()=>{$('sheet').classList.remove('open');$('sheetBg').classList.remove('open');};
const syncFishSub=()=>{$('fishSub').textContent=`缸里 ${fish.filter(f=>f.alive).length} 条`;};
function feedAction(){feed(R(-10,2),R(-5,5));blip(620,0.1,0.08);}
function waterAction(){
  waste*=0.45;oxygen=Math.min(1,oxygen+0.25);
  toast('💧 已换水, 水质提升');blip(360,0.15,0.09);
}
function filterAction(){
  filterOn=!filterOn;
  $('bFilter').classList.toggle('on',filterOn);
  $('filterSub').textContent=filterOn?'已开启':'已关闭';
  toast(filterOn?'🌀 过滤已开启':'🌀 过滤已关闭');
  blip(filterOn?500:280,0.12,0.09);
}
function addFishAction(){
  if(fish.filter(f=>f.alive).length>=MAX_FISH){toast('🐟 鱼缸满了!');blip(180,0.15,0.08);return;}
  const hue=Object.assign({},pick(PALETTES));
  const f=spawnEcoFish(pick(['comet','fantail','pearl']),hue,'adult');
  f.grp.scale.setScalar(1.35);
  toast('🐟 新'+BREEDS[f.breed].label+'入缸!');blip(640,0.12,0.09);
  syncFishSub();
}
function dayAction(){
  dayTarget=dayTarget>0.5?0:1;
  $('bDay').classList.toggle('on',!!dayTarget);
  $('daySub').textContent=dayTarget?'白天':'黑夜';
  toast(dayTarget?'☀️ 白天':'🌙 夜晚');blip(dayTarget?700:300,0.15,0.09);
}
$('bFeed').onclick=feedAction;
$('bFish').onclick=addFishAction;
$('bWater').onclick=waterAction;
$('bFilter').onclick=filterAction;
$('bDay').onclick=dayAction;
$('bFx').onclick=e=>{fx=!fx;const b=e.currentTarget;
  b.classList.toggle('on',fx);$('fxSub').textContent=fx?'电影级已开':'已关闭';};
$('bTrim').onclick=()=>trimPlants();
$('bFrenzy').onclick=()=>{
  if(!turtle.grp)return;
  turtle.frenzy=true;turtle.frenzyTimer=20;turtle.state='hunt';
  toast('⚠️ 乌龟狂暴20秒! 会攻击所有鱼');
  closeSheet();blip(140,0.3,0.12,'sawtooth');
};
$('bFs').onclick=()=>{closeSheet();document.documentElement.requestFullscreen?.();};
$('bReset').onclick=()=>{try{localStorage.removeItem(SAVE_KEY);}catch(e){}location.reload();};
$('sheetX').onclick=closeSheet;
$('sheetBg').onclick=closeSheet;
document.addEventListener('contextmenu',e=>e.preventDefault());

// ---------- 存档(localStorage, 5秒自动)
const SAVE_KEY='fishtank-3d-save-v1';
let saveT=0;
function saveGame(){
  try{
    const snap={v:2,waste,quality,oxygen,filterOn,dayTarget,
      fishes:fish.filter(f=>f.alive&&!f.koi).map(f=>({x:f.grp.position.x,y:f.grp.position.y,z:f.grp.position.z,
        stage:f.stage,age:f.age,hunger:f.hunger,armor:f.armor,breed:f.breed,hue:f.hue,
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
  if(!s||s.v!==2||!Array.isArray(s.fishes)||!s.fishes.length)return false;
  try{
    waste=s.waste??waste;quality=s.quality??quality;oxygen=s.oxygen??oxygen;
    filterOn=!!s.filterOn;dayTarget=s.dayTarget??1;
    if(!turtle.grp)return false;
    for(const d of s.fishes){
      const f=spawnEcoFish(d.breed||'comet',d.hue||PALETTES[0],d.stage==='baby'?'baby':'adult',
        new THREE.Vector3(d.x??-6,d.y??6,d.z??0));
      Object.assign(f,{age:d.age??0,hunger:d.hunger??0.5,armor:d.armor??0,breedCD:d.breedCD??10});
    }
    if(s.turtle)Object.assign(turtle.grp.position,{x:s.turtle.x,y:s.turtle.y,z:s.turtle.z});
    Object.assign(turtle,{hunger:s.turtle?.hunger??0.35,belly:s.turtle?.belly??0});
    for(const e of (s.eggs||[]))layEgg(e.x,e.z,e.hueA,e.hueB,e.breedA,e.breedB);
    (s.plants||[]).forEach((sp,i)=>{if(plantClusters[i]){
      plantClusters[i].h=sp.h??1;plantClusters[i].health=sp.health??1;}});
    $('bFilter').classList.toggle('on',filterOn);
    $('filterSub').textContent=filterOn?'已开启':'已关闭';
    $('bDay').classList.toggle('on',!!dayTarget);
    $('daySub').textContent=dayTarget?'白天':'黑夜';
    return true;
  }catch(e){return false;}
}
window.addEventListener('pagehide',saveGame);
document.addEventListener('visibilitychange',()=>{if(document.hidden)saveGame();});

// ---------- go
spawnEcoFish('comet',PALETTES[0],'adult');   // 开缸三条: 草金 / 扇尾 / 珍珠
spawnEcoFish('fantail',PALETTES[1],'adult');
spawnEcoFish('pearl',PALETTES[2],'adult');
spawnKoi();spawnKoi();                        // 2 条观赏锦鲤
let restored=false;
// 乌龟模型异步加载, 等它就绪后再读档(需要 turtle.grp)
const _goTimer=setInterval(()=>{
  if(!turtle.grp)return;
  clearInterval(_goTimer);
  restored=loadGame();
  if(restored)setTimeout(()=>toast('📂 已恢复上次的鱼缸'),600);
  syncFishSub();
},300);
setTimeout(()=>{clearInterval(_goTimer);syncFishSub();},8000); // 模型失败时兜底
syncFishSub();
window.__tank={camera,controls,scene,turtle,fish,eggs,plaque,lampLight,
  eco:()=>({waste,quality,oxygen,filterOn,dayTarget})};
clearTimeout(window.__bootT);
tick();

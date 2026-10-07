import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {BokehPass} from 'three/addons/postprocessing/BokehPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {blip} from './audio.js';
import {ISLAND, RAMP_A, RAMP_B, TANK} from './config.js';
import {Eco, UI, View} from './state.js';
import {toast} from './ui.js';
import {$, R, RI, chance, clamp, pick} from './utils.js';

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

// ---------- 后期特效链: 渲染→景深→辉光→调色
const composer=new EffectComposer(renderer);
composer.addPass(new RenderPass(scene,camera));
const bokeh=new BokehPass(scene,camera,{focus:30,aperture:.0011,maxblur:.0045});
composer.addPass(bokeh);
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

export {U, bokeh, bubbleSrc, bubbles, camera, composer, controls, fillLights, fishGrazePlant, grade, hemi, hsl, interactPlant, lampGlow, lampLight, moteGeo, moteMat, plantClusters, plantCoverAt, plantRadius, plantSwayFrom, renderer, scene, shelterPos, sun, surf, topSurf, trimPlants, updatePlants, updateRays, updateWreckBubbles};

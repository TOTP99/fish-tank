import * as THREE from 'three';
import {blip} from './audio.js';
import {BREEDS, ISLAND, MAX_EGGS, MAX_FISH, NEW_SPECIES, PALETTES, RAMP_B, TANK} from './config.js';
import {Creatures, Eco, Stats} from './state.js';
import {saveAch, toast, unlockAch} from './ui.js';
import {$, R, RI, _m, _o, _q, _up, _yr, chance, clamp, lerp, pick} from './utils.js';
import {fishGrazePlant, hsl, plantClusters, plantCoverAt, plantSwayFrom, scene, shelterPos} from './world.js';

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

export {animTurtle, dropFood, eggs, feed, fish, fishDie, food, layEgg, removeFish, spawnEcoFish, spawnFishByBreed, spawnHybridFish, spawnKoi, spawnNewFish, spawnRandomFish, tryBreed, turtle, turtleEat, turtleFindPrey, updateEggs, updateFish, updateFood, updateTurtle};

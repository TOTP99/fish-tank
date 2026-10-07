import {blip, setAmbient} from './audio.js';
import {BREEDS, MAX_FISH, SAVE_KEY} from './config.js';
import {eggs, feed, fish, food, spawnRandomFish, turtle} from './creatures.js';
import {Eco, Sfx, Stats, UI, View} from './state.js';
import {$, R} from './utils.js';
import {renderer, trimPlants} from './world.js';

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

export {maybeOnboard, openSheet, saveAch, toast, unlockAch, updateHUD};

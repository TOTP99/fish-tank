import * as THREE from 'three';
const MAX_FISH=36, MAX_EGGS=8;

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

const TANK={w:36,d:18,h:20.5,water:17};
const ISLAND={cx:12.5,cz:0,r:5,top:18.9};          // 晒背岛

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

const SAVE_KEY='fishtank-3d-save-v1';

// 乌龟上岸路线:沿石阶而上(每点都高于下方石头顶部,防穿模)
const RAMP_PTS=[
  new THREE.Vector3(4.6,2.2,0.3),new THREE.Vector3(6.0,4.6,0.1),
  new THREE.Vector3(7.2,7.4,-0.2),new THREE.Vector3(8.4,10.6,0.2),
  new THREE.Vector3(9.6,13.6,-0.2),new THREE.Vector3(10.8,16.0,0.1),
  new THREE.Vector3(12.1,ISLAND.top+0.35,0)];
const RAMP_CURVE=new THREE.CatmullRomCurve3(RAMP_PTS);
const RAMP_A=RAMP_PTS[0].clone();                    // 乌龟上岸起点
const RAMP_B=RAMP_PTS[RAMP_PTS.length-1].clone();    // 晒背点

export {RAMP_PTS, RAMP_CURVE, RAMP_A, RAMP_B, BREEDS, ISLAND, MAX_EGGS, MAX_FISH, NEW_SPECIES, PALETTES, SAVE_KEY, TANK};

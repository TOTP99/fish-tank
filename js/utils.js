import * as THREE from 'three';

const R=(a,b)=>a+Math.random()*(b-a), RI=(a,b)=>Math.floor(R(a,b+1)), pick=a=>a[Math.floor(Math.random()*a.length)], chance=p=>Math.random()<p;
const $=id=>document.getElementById(id);
const clamp=THREE.MathUtils.clamp, lerp=THREE.MathUtils.lerp;

export {$, R, RI, chance, clamp, lerp, pick};

// 逐帧零分配: 跨模块共享临时变量
const _v=new THREE.Vector3(),_q=new THREE.Quaternion(),_m=new THREE.Matrix4(),
  _up=new THREE.Vector3(0,1,0),_yr=new THREE.Quaternion().setFromAxisAngle(_up,Math.PI/2),_o=new THREE.Vector3();

export {_v,_q,_m,_up,_yr,_o};

import {Sfx} from './state.js';

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

export {blip, setAmbient};

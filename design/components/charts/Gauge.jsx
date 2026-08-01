import React from 'react';
export function Gauge({value=0,max=100,color='var(--accent)',size=96,label,format=(v)=>Math.round(v),unit,style}){
  const cx=size/2,cy=size/2,rr=size/2-7,a0=-220,a1=40,span=a1-a0;
  const arc=(from,to)=>{const f=from*Math.PI/180,t=to*Math.PI/180;
    return 'M '+(cx+rr*Math.cos(f)).toFixed(2)+' '+(cy+rr*Math.sin(f)).toFixed(2)+' A '+rr+' '+rr+' 0 '+((to-from)>180?1:0)+' 1 '+(cx+rr*Math.cos(t)).toFixed(2)+' '+(cy+rr*Math.sin(t)).toFixed(2);};
  const p=Math.max(0,Math.min(1,value/max));
  return <div style={{position:'relative',width:size,height:size*0.82,...style}}>
    <svg width={size} height={size} style={{position:'absolute',top:0,left:0}}>
      <path d={arc(a0,a1)} fill="none" stroke="var(--surface-3)" strokeWidth="6" strokeLinecap="round"/>
      {p>0&&<path d={arc(a0,a0+span*p)} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"/>}
    </svg>
    <div style={{position:'absolute',inset:'0 0 '+size*0.06+'px 0',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:2}}>
      <span className="tnum" style={{font:'600 '+(size*0.24)+'px/1 var(--font-ui)',color:'var(--text-1)'}}>{format(value)}<span style={{font:'400 '+(size*0.11)+'px/1 var(--font-ui)',color:'var(--text-3)'}}> {unit}</span></span>
      {label&&<span className="hy-label" style={{fontSize:'var(--text-2xs)'}}>{label}</span>}
    </div>
  </div>;
}

import React from 'react';
export function Sparkline({data=[],color='var(--accent)',width=120,height=32,fill=true,dot=true,style}){
  if(!data.length)return <svg width={width} height={height} style={style}></svg>;
  const min=Math.min(...data),max=Math.max(...data),r=(max-min)||1;
  const pts=data.map((v,i)=>[i/(data.length-1)*(width-4)+2,height-3-((v-min)/r)*(height-6)]);
  const line=pts.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
  const last=pts[pts.length-1];
  return <svg width={width} height={height} style={{display:'block',overflow:'visible',...style}}>
    {fill&&<polygon points={'2,'+(height-1)+' '+line+' '+last[0].toFixed(1)+','+(height-1)} fill={color} opacity="0.12"/>}
    <polyline points={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
    {dot&&<circle cx={last[0]} cy={last[1]} r="2.2" fill={color}/>}
  </svg>;
}

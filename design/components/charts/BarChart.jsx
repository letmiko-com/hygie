import React from 'react';
export function BarChart({data=[],labels=[],color='var(--accent)',height=140,yFormat=(v)=>Math.round(v),highlight,style}){
  const max=Math.max(...data.filter(v=>v!=null),1);
  return <div style={{...style}}>
    <div style={{display:'flex',alignItems:'flex-end',gap:'6%',height,borderBottom:'1px solid var(--border-strong)'}}>
      {data.map((v,i)=><div key={i} title={v==null?'Pas de donnée':yFormat(v)} style={{flex:1,height:v==null?1:Math.max(2,v/max*100)+'%',background:v==null?'transparent':color,borderTop:v==null?'2px dotted var(--text-3)':'none',opacity:highlight==null||highlight===i?1:0.35,borderRadius:'2px 2px 0 0',minWidth:3}}></div>)}
    </div>
    {labels.length>0&&<div className="tnum" style={{display:'flex',gap:'6%',marginTop:5}}>{labels.map((l,i)=><span key={i} style={{flex:1,textAlign:'center',font:'400 var(--text-2xs)/1 var(--font-data)',color:'var(--chart-axis)',overflow:'hidden'}}>{l}</span>)}</div>}
  </div>;
}

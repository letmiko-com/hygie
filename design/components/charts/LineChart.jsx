import React from 'react';
export function LineChart({series=[],height=180,xLabels=[],yFormat=(v)=>Math.round(v),gridLines=4,area=false,style}){
  const roll=(d,n)=>d.map((_,i)=>{const a=d.slice(Math.max(0,i-n+1),i+1).filter(v=>v!=null);return a.length?+(a.reduce((x,y)=>x+y,0)/a.length):null;});
  const all=series.flatMap(s=>s.data).filter(v=>v!=null);
  const min=Math.min(...all),max=Math.max(...all),r=(max-min)||1;
  const Y=v=>100-((v-min)/r)*94-3;
  return <div style={{display:'flex',flexDirection:'column',gap:4,...style}}>
    <div style={{display:'flex',gap:8,alignItems:'stretch'}}>
      <div className="tnum" style={{display:'flex',flexDirection:'column',justifyContent:'space-between',textAlign:'right',font:'400 var(--text-2xs)/1 var(--font-data)',color:'var(--chart-axis)',padding:'2px 0',width:34,flex:'none'}}>
        {Array.from({length:gridLines+1},(_,i)=><span key={i}>{yFormat(max-(i/gridLines)*r)}</span>)}
      </div>
      <div style={{position:'relative',flex:1,height}}>
        <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{position:'absolute',inset:0}}>
          {Array.from({length:gridLines+1},(_,i)=><line key={i} x1="0" x2="100" y1={3+i/gridLines*94} y2={3+i/gridLines*94} stroke="var(--chart-grid)" strokeWidth="1" vectorEffect="non-scaling-stroke"/>)}
          {series.map((s,si)=>{
            const P=d=>d.map((v,i)=>v==null?null:(i/(d.length-1)*100).toFixed(2)+','+Y(v).toFixed(2)).filter(Boolean).join(' ');
            const pts=P(s.data);
            return <g key={si}>
              {(area||s.area)&&<polygon points={'0,100 '+pts+' 100,100'} fill={s.color} opacity="0.10"/>}
              <polyline points={pts} fill="none" stroke={s.color} strokeWidth={s.avg?1:(s.width||1.5)} strokeDasharray={s.dashed?'4 3':'none'} vectorEffect="non-scaling-stroke" strokeLinejoin="round" opacity={s.avg?0.3:(s.dashed?0.7:1)}/>
              {s.avg&&<polyline points={P(roll(s.data,s.avg))} fill="none" stroke={s.color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round"/>}
            </g>;})}
        </svg>
      </div>
    </div>
    {xLabels.length>0&&<div className="tnum" style={{display:'flex',justifyContent:'space-between',marginLeft:42,font:'400 var(--text-2xs)/1 var(--font-data)',color:'var(--chart-axis)'}}>{xLabels.map((l,i)=><span key={i}>{l}</span>)}</div>}
    {series.some(s=>s.label)&&<div style={{display:'flex',gap:14,marginLeft:42,marginTop:2}}>{series.filter(s=>s.label).map((s,i)=><span key={i} style={{display:'inline-flex',alignItems:'center',gap:5,font:'400 var(--text-xs)/1 var(--font-ui)',color:'var(--text-2)'}}><span style={{width:10,height:2,background:s.color,opacity:s.dashed?0.6:1}}></span>{s.label}</span>)}</div>}
  </div>;
}

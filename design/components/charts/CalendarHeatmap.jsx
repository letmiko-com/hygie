import React from 'react';
export function CalendarHeatmap({values=[],color='var(--accent)',cell=11,gap=3,dayLabels=['L','','M','','V','',''],style}){
  const weeks=Math.ceil(values.length/7);
  return <div style={{display:'flex',gap:6,...style}}>
    <div style={{display:'grid',gridTemplateRows:'repeat(7,'+cell+'px)',gap,font:'400 var(--text-2xs)/'+cell+'px var(--font-data)',color:'var(--chart-axis)'}}>
      {dayLabels.map((d,i)=><span key={i}>{d}</span>)}
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat('+weeks+','+cell+'px)',gridTemplateRows:'repeat(7,'+cell+'px)',gridAutoFlow:'column',gap}}>
      {values.map((v,i)=><div key={i} title={v==null?'Pas de donnée':undefined} style={{borderRadius:2,background:v==null?'transparent':(v===0?'var(--surface-2)':'color-mix(in oklab, '+color+' '+Math.round(18+v*82)+'%, transparent)'),border:v==null?'1px dashed var(--border-strong)':'1px solid transparent',boxSizing:'border-box'}}></div>)}
    </div>
  </div>;
}

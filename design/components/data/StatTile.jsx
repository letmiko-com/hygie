import React from 'react';
export function StatTile({label,value,unit,sub,color,align='left',style}){
  return <div style={{display:'flex',flexDirection:'column',gap:3,textAlign:align,minWidth:0,...style}}>
    <span className="hy-label">{label}</span>
    <span className="tnum" style={{font:'600 var(--text-xl)/1.1 var(--font-ui)',color:color||'var(--text-1)'}}>{value==null?'—':value}{unit&&<span style={{font:'400 var(--text-sm)/1 var(--font-ui)',color:'var(--text-3)'}}> {unit}</span>}</span>
    {sub&&<span className="tnum" style={{font:'400 var(--text-xs)/1.2 var(--font-data)',color:'var(--text-3)'}}>{sub}</span>}
  </div>;
}

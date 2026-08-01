import React from 'react';
const tones={neutral:['var(--surface-2)','var(--text-2)','var(--border)'],accent:['var(--accent-soft)','var(--accent-strong)','transparent'],ok:['var(--ok-soft)','var(--ok)','transparent'],warn:['var(--warn-soft)','var(--warn)','transparent'],danger:['var(--danger-soft)','var(--danger)','transparent']};
export function Badge({tone='neutral',color,dot,children,mono,style}){
  const [bg,fg,bd]=color?['color-mix(in oklab, '+color+' 14%, transparent)',color,'transparent']:tones[tone];
  return <span style={{display:'inline-flex',alignItems:'center',gap:5,height:18,padding:'0 7px',borderRadius:'var(--r-sm)',background:bg,color:fg,border:'1px solid '+bd,font:(mono?'500 var(--text-xs)/1 var(--font-data)':'500 var(--text-xs)/1 var(--font-ui)'),whiteSpace:'nowrap',...style}}>
    {dot&&<span style={{width:5,height:5,borderRadius:'50%',background:'currentColor',flex:'none'}}></span>}{children}
  </span>;
}

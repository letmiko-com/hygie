import React from 'react';
import {Icon} from '../core/Icon.jsx';
import {SourceBadge} from './SourceBadge.jsx';
export function SessionRow({icon='exercise',color='var(--data-activity)',title,date,duration,distance,stats=[],source,onClick,style}){
  return <div className="hy-row" onClick={onClick} style={{display:'flex',alignItems:'center',gap:12,padding:'9px 12px',borderRadius:'var(--r-md)',cursor:onClick?'pointer':'default',...style}}>
    <span style={{display:'flex',alignItems:'center',justifyContent:'center',width:32,height:32,borderRadius:'var(--r-md)',background:'color-mix(in oklab, '+color+' 13%, transparent)',color,flex:'none'}}><Icon name={icon} size={17}/></span>
    <div style={{flex:'1 1 200px',minWidth:0}}>
      <div style={{font:'500 var(--text-base)/1.25 var(--font-ui)',color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{title}</div>
      <div className="tnum" style={{font:'400 var(--text-xs)/1.3 var(--font-ui)',color:'var(--text-3)'}}>{[date,duration,distance].filter(Boolean).join(' · ')}</div>
    </div>
    <div className="tnum" style={{display:'flex',gap:18,flex:'none'}}>
      {stats.map((s,i)=><span key={i} style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:1}}>
        <span style={{font:'500 var(--text-sm)/1 var(--font-data)',color:s.color||'var(--text-1)'}}>{s.value==null?'—':s.value}</span>
        <span style={{font:'400 var(--text-2xs)/1 var(--font-ui)',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.04em'}}>{s.label}</span>
      </span>)}
    </div>
    {source&&<SourceBadge source={source} style={{flex:'none'}}/>}
    {onClick&&<Icon name="chevron_right" size={16} color="var(--text-3)" style={{flex:'none'}}/>}
  </div>;
}

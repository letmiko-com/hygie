import React from 'react';
import {Icon} from '../core/Icon.jsx';
import {Sparkline} from '../charts/Sparkline.jsx';
export function TrendChip({delta,label,invert,data,color,style}){
  const n=typeof delta==='number';
  const up=n?delta>0:String(delta||'').startsWith('+');
  const flat=n&&Math.abs(delta)<0.5;
  const good=flat?null:(invert?!up:up);
  const col=flat?'var(--text-3)':good?'var(--ok)':'var(--danger)';
  return <span className="tnum" title={label} style={{display:'inline-flex',alignItems:'center',gap:2,font:'500 var(--text-xs)/1 var(--font-data)',color:col,whiteSpace:'nowrap',...style}}>
    {data&&<Sparkline data={data} color={color||'var(--text-3)'} width={44} height={14} fill={false} dot={false} style={{marginRight:4}}/>}
    <Icon name={flat?'remove':up?'arrow_drop_up':'arrow_drop_down'} size={15} style={{margin:'0 -2px'}}/>
    {n?(up?'+':'')+String(delta).replace('.',',')+' %':delta}
    {label&&<span style={{color:'var(--text-3)',font:'400 var(--text-2xs)/1 var(--font-ui)',marginLeft:3}}>{label}</span>}
  </span>;
}

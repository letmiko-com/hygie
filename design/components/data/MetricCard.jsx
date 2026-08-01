import React from 'react';
import {Icon} from '../core/Icon.jsx';
import {Sparkline} from '../charts/Sparkline.jsx';
import {Skeleton} from './Skeleton.jsx';
export function MetricCard({icon,label,value,unit,delta,deltaLabel='vs période préc.',invert,data,color='var(--data-neutral)',state='ok',treatment='outlined',source,onClick,style}){
  const base={outlined:{background:'var(--surface)',border:'1px solid var(--border)'},tint:{background:'color-mix(in oklab, '+color+' 7%, var(--surface))',border:'1px solid color-mix(in oklab, '+color+' 22%, transparent)'},bare:{background:'transparent',border:'1px solid transparent'}}[treatment];
  const up=typeof delta==='number'?delta>0:String(delta||'').startsWith('+');
  const flat=typeof delta==='number'&&Math.abs(delta)<0.5;
  const deltaCol=flat?'var(--text-3)':(invert?!up:up)?'var(--ok)':'var(--danger)';
  return <div className={onClick?'hy-row':''} onClick={onClick} style={{display:'flex',flexDirection:'column',gap:10,padding:'12px 14px',borderRadius:'var(--r-lg)',cursor:onClick?'pointer':'default',minWidth:0,...base,...style}}>
    <div style={{display:'flex',alignItems:'center',gap:6}}>
      {icon&&<Icon name={icon} size={15} color={color}/>}
      <span className="hy-label" style={{flex:1,overflow:'hidden',textOverflow:'ellipsis'}}>{label}</span>
      {source}
    </div>
    {state==='loading'?<div style={{display:'flex',flexDirection:'column',gap:8}}><Skeleton width={110} height={26}/><Skeleton width="100%" height={30}/></div>
    :state==='empty'?<div style={{display:'flex',flexDirection:'column',gap:4}}>
      <span style={{font:'600 var(--text-2xl)/1 var(--font-ui)',color:'var(--text-3)'}}>—</span>
      <span style={{font:'400 var(--text-xs)/1.3 var(--font-ui)',color:'var(--text-3)',fontStyle:'italic'}}>Pas de donnée sur la période</span>
    </div>
    :<React.Fragment>
      <div style={{display:'flex',alignItems:'baseline',gap:6,flexWrap:'wrap'}}>
        <span className="tnum" style={{font:'600 var(--text-2xl)/1 var(--font-ui)',color:'var(--text-1)'}}>{value}</span>
        {unit&&<span style={{font:'400 var(--text-sm)/1 var(--font-ui)',color:'var(--text-3)'}}>{unit}</span>}
        {delta!=null&&<span className="tnum" title={deltaLabel} style={{marginLeft:'auto',display:'inline-flex',alignItems:'center',gap:2,font:'500 var(--text-xs)/1 var(--font-data)',color:deltaCol}}>
          <Icon name={flat?'remove':up?'arrow_drop_up':'arrow_drop_down'} size={16}/>{typeof delta==='number'?(up?'+':'')+delta+' %':delta}
        </span>}
      </div>
      {data&&<Sparkline data={data} color={color} width={999} height={30} style={{width:'100%'}}/>}
    </React.Fragment>}
  </div>;
}

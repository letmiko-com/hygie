import React from 'react';
import {Icon} from '../core/Icon.jsx';
const SOURCES={'apple-watch':['watch','Apple Watch'],'iphone':['smartphone','iPhone'],'withings':['monitor_weight','Withings'],'garmin':['watch','Garmin'],'healthfit':['sync_alt','HealthFit'],'sensor':['bluetooth','Capteur BT'],'other':['database','Autre']};
export function SourceBadge({source='other',label,style}){
  const [icon,name]=SOURCES[source]||SOURCES.other;
  return <span title={'Source : '+(label||name)} style={{display:'inline-flex',alignItems:'center',gap:4,height:18,padding:'0 6px',borderRadius:'var(--r-sm)',background:'var(--surface-2)',border:'1px solid var(--border)',color:'var(--text-3)',font:'500 var(--text-2xs)/1 var(--font-ui)',whiteSpace:'nowrap',...style}}>
    <Icon name={icon} size={11}/>{label||name}
  </span>;
}

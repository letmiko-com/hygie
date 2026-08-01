import React from 'react';
import {Icon} from '../core/Icon.jsx';
const STATES={fresh:{color:'var(--ok)',bg:'var(--ok-soft)',label:'À jour'},syncing:{color:'var(--accent)',bg:'var(--accent-soft)',label:'Synchronisation…',spin:true},stale:{color:'var(--warn)',bg:'var(--warn-soft)',label:'En retard'},error:{color:'var(--danger)',bg:'var(--danger-soft)',label:'Erreur'},never:{color:'var(--text-3)',bg:'var(--surface-2)',label:'Jamais synchronisé'}};
export function SyncBadge({status='fresh',label,detail,style}){
  const s=STATES[status]||STATES.never;
  return <span style={{display:'inline-flex',alignItems:'center',gap:6,height:20,padding:'0 8px',borderRadius:'var(--r-sm)',background:s.bg,color:s.color,font:'500 var(--text-xs)/1 var(--font-ui)',whiteSpace:'nowrap',...style}}>
    {s.spin?<Icon name="progress_activity" size={13} style={{animation:'hy-spin 1s linear infinite'}}/>:<span style={{width:6,height:6,borderRadius:'50%',background:'currentColor',flex:'none'}}></span>}
    {label||s.label}{detail&&<span className="tnum" style={{color:'var(--text-3)',font:'400 var(--text-xs)/1 var(--font-data)'}}>{detail}</span>}
  </span>;
}

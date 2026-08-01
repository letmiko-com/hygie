import React from 'react';
import {Icon} from '../core/Icon.jsx';
export function EmptyState({icon='database_off',title='Pas de donnée',hint,action,compact,style}){
  return <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:8,padding:compact?'20px 16px':'44px 24px',textAlign:'center',...style}}>
    <span style={{display:'flex',alignItems:'center',justifyContent:'center',width:compact?32:44,height:compact?32:44,borderRadius:'var(--r-full)',background:'var(--surface-2)',color:'var(--text-3)'}}><Icon name={icon} size={compact?17:22}/></span>
    <span style={{font:'600 var(--text-md)/1.3 var(--font-ui)',color:'var(--text-1)'}}>{title}</span>
    {hint&&<span style={{font:'400 var(--text-sm)/1.45 var(--font-ui)',color:'var(--text-3)',maxWidth:340}}>{hint}</span>}
    {action&&<div style={{marginTop:6}}>{action}</div>}
  </div>;
}

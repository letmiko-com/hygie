import React from 'react';
import {Icon} from './Icon.jsx';
export function IconButton({icon,label,size='md',variant='ghost',onClick,disabled,style}){
  const d=size==='sm'?'var(--control-h-sm)':'var(--control-h-md)';
  const pal=variant==='secondary'?{background:'var(--surface)',border:'1px solid var(--border-strong)',color:'var(--text-1)'}:{background:'transparent',border:'1px solid transparent',color:'var(--text-2)'};
  return <button className="hy-btn hy-ghost" title={label} aria-label={label} onClick={onClick} disabled={disabled}
    style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:d,height:d,borderRadius:'var(--r-md)',cursor:disabled?'default':'pointer',opacity:disabled?0.45:1,...pal,...style}}>
    <Icon name={icon} size={size==='sm'?16:18}/>
  </button>;
}

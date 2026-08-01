import React from 'react';
import {Icon} from './Icon.jsx';
export function Button({variant='primary',size='md',icon,children,disabled,onClick,style}){
  const pal={
    primary:{background:'var(--accent)',color:'var(--on-accent)',border:'1px solid transparent'},
    secondary:{background:'var(--surface)',color:'var(--text-1)',border:'1px solid var(--border-strong)'},
    ghost:{background:'transparent',color:'var(--text-2)',border:'1px solid transparent'},
    danger:{background:'var(--danger)',color:'oklch(0.99 0.005 25)',border:'1px solid transparent'},
  }[variant];
  return <button className={'hy-btn'+(variant==='ghost'?' hy-ghost':'')} onClick={onClick} disabled={disabled}
    style={{display:'inline-flex',alignItems:'center',justifyContent:'center',gap:6,height:size==='sm'?'var(--control-h-sm)':'var(--control-h-md)',padding:size==='sm'?'0 10px':'0 14px',borderRadius:'var(--r-md)',font:'500 var(--text-base)/1 var(--font-ui)',cursor:disabled?'default':'pointer',opacity:disabled?0.45:1,...pal,...style}}>
    {icon&&<Icon name={icon} size={size==='sm'?15:16}/>}{children}
  </button>;
}

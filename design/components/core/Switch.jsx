import React from 'react';
export function Switch({checked,onChange,label,disabled,style}){
  return <label style={{display:'inline-flex',alignItems:'center',gap:8,cursor:disabled?'default':'pointer',opacity:disabled?0.45:1,...style}}>
    <span onClick={disabled?null:onChange} role="switch" aria-checked={!!checked}
      style={{width:32,height:18,borderRadius:'var(--r-full)',background:checked?'var(--accent)':'var(--surface-3)',border:'1px solid '+(checked?'var(--accent)':'var(--border-strong)'),position:'relative',transition:'background var(--dur) var(--ease)',flex:'none'}}>
      <span style={{position:'absolute',top:2,left:checked?15:2,width:12,height:12,borderRadius:'50%',background:checked?'var(--on-accent)':'var(--text-3)',transition:'left var(--dur) var(--ease)'}}></span>
    </span>
    {label&&<span style={{font:'400 var(--text-base)/1.2 var(--font-ui)',color:'var(--text-1)'}}>{label}</span>}
  </label>;
}

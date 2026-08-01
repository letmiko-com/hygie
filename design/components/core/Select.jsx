import React from 'react';
import {Icon} from './Icon.jsx';
export function Select({label,options=[],value,onChange,size='md',style}){
  return <label style={{display:'flex',flexDirection:'column',gap:6,...style}}>
    {label&&<span className="hy-label">{label}</span>}
    <span style={{position:'relative',display:'inline-flex',alignItems:'center'}}>
      <select value={value} onChange={onChange}
        style={{appearance:'none',WebkitAppearance:'none',height:size==='sm'?'var(--control-h-sm)':'var(--control-h-md)',padding:'0 28px 0 10px',background:'var(--surface)',border:'1px solid var(--border-strong)',borderRadius:'var(--r-md)',color:'var(--text-1)',font:'400 var(--text-base)/1 var(--font-ui)',cursor:'pointer',width:'100%'}}>
        {options.map(o=>typeof o==='string'?<option key={o} value={o}>{o}</option>:<option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <Icon name="expand_more" size={16} color="var(--text-3)" style={{position:'absolute',right:8,pointerEvents:'none'}}/>
    </span>
  </label>;
}

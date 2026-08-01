import React from 'react';
import {Icon} from './Icon.jsx';
export function Input({label,icon,placeholder,value,onChange,hint,error,type='text',mono,style}){
  return <label style={{display:'flex',flexDirection:'column',gap:6,...style}}>
    {label&&<span className="hy-label">{label}</span>}
    <span style={{display:'flex',alignItems:'center',gap:8,height:'var(--control-h-md)',padding:'0 10px',background:'var(--surface)',border:'1px solid '+(error?'var(--danger)':'var(--border-strong)'),borderRadius:'var(--r-md)'}}>
      {icon&&<Icon name={icon} size={16} color="var(--text-3)"/>}
      <input type={type} placeholder={placeholder} value={value} onChange={onChange}
        style={{flex:1,minWidth:0,border:'none',outline:'none',background:'transparent',color:'var(--text-1)',font:(mono?'400 var(--text-base)/1 var(--font-data)':'400 var(--text-base)/1 var(--font-ui)')}}/>
    </span>
    {(error||hint)&&<span style={{font:'400 var(--text-sm)/1.3 var(--font-ui)',color:error?'var(--danger)':'var(--text-3)'}}>{error||hint}</span>}
  </label>;
}

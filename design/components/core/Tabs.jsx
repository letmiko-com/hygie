import React from 'react';
export function Tabs({items=[],active,onChange,style}){
  return <div role="tablist" style={{display:'flex',gap:2,borderBottom:'1px solid var(--border)',...style}}>
    {items.map(it=>{const t=typeof it==='string'?{id:it,label:it}:it;const on=t.id===active;
      return <button key={t.id} role="tab" aria-selected={on} onClick={()=>onChange&&onChange(t.id)}
        style={{padding:'8px 12px',marginBottom:-1,background:'none',border:'none',borderBottom:'2px solid '+(on?'var(--accent)':'transparent'),color:on?'var(--text-1)':'var(--text-2)',font:(on?'600':'400')+' var(--text-base)/1.2 var(--font-ui)',cursor:'pointer'}}>
        {t.label}{t.count!=null&&<span className="tnum" style={{marginLeft:6,font:'500 var(--text-xs)/1 var(--font-data)',color:'var(--text-3)'}}>{t.count}</span>}
      </button>;})}
  </div>;
}
export function SegmentedControl({items=[],active,onChange,size='md',style}){
  return <div role="tablist" style={{display:'inline-flex',gap:2,padding:2,background:'var(--surface-2)',border:'1px solid var(--border)',borderRadius:'var(--r-md)',...style}}>
    {items.map(it=>{const t=typeof it==='string'?{id:it,label:it}:it;const on=t.id===active;
      return <button key={t.id} onClick={()=>onChange&&onChange(t.id)}
        style={{height:size==='sm'?20:24,padding:size==='sm'?'0 8px':'0 10px',border:'none',borderRadius:'calc(var(--r-md) - 2px)',background:on?'var(--surface)':'transparent',boxShadow:on?'var(--shadow-1)':'none',color:on?'var(--text-1)':'var(--text-2)',font:(on?'600':'400')+' var(--text-sm)/1 var(--font-ui)',cursor:'pointer'}}>{t.label}</button>;})}
  </div>;
}

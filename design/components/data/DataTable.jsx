import React from 'react';
export function DataTable({columns=[],rows=[],onRowClick,dense,style}){
  const cell=(c,r)=>{const v=typeof c.render==='function'?c.render(r):r[c.key];return v==null?<span style={{color:'var(--text-3)'}}>—</span>:v;};
  return <table className="tnum" style={{width:'100%',borderCollapse:'collapse',font:'400 var(--text-base)/1.3 var(--font-ui)',...style}}>
    <thead><tr>
      {columns.map(c=><th key={c.key} className="hy-label" style={{textAlign:c.align||'left',padding:dense?'5px 10px':'7px 10px',borderBottom:'1px solid var(--border-strong)',whiteSpace:'nowrap',width:c.width}}>{c.label}</th>)}
    </tr></thead>
    <tbody>
      {rows.map((r,i)=><tr key={i} className={onRowClick?'hy-row':''} onClick={onRowClick?()=>onRowClick(r,i):null} style={{cursor:onRowClick?'pointer':'default'}}>
        {columns.map(c=><td key={c.key} style={{textAlign:c.align||'left',padding:dense?'5px 10px':'8px 10px',borderBottom:'1px solid var(--border)',whiteSpace:'nowrap',fontFamily:c.mono?'var(--font-data)':'inherit',fontSize:c.mono?'var(--text-sm)':'inherit',color:c.muted?'var(--text-3)':'inherit'}}>{cell(c,r)}</td>)}
      </tr>)}
    </tbody>
  </table>;
}

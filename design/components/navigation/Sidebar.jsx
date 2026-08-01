import React from 'react';
import {Icon} from '../core/Icon.jsx';
export function Logo({size=20,withWordmark=true,color='var(--accent)',style}){
  return <span style={{display:'inline-flex',alignItems:'center',gap:8,...style}}>
    <svg width={size} height={size} viewBox="0 0 32 32" fill={color} style={{flex:'none'}}><rect x="4" y="13" width="6" height="15" rx="3"></rect><rect x="13" y="4" width="6" height="24" rx="3"></rect><rect x="22" y="9" width="6" height="12" rx="3"></rect></svg>
    {withWordmark&&<span style={{font:'600 '+Math.round(size*0.85)+'px/1 var(--font-ui)',color:'var(--text-1)',letterSpacing:'-0.01em'}}>Hygie</span>}
  </span>;
}
export function Sidebar({items=[],active,onNavigate,user={name:'Anna Martin',email:'anna@exemple.fr'},syncStatus='fresh',syncDetail,footer,style}){
  const dot={fresh:'var(--ok)',syncing:'var(--accent)',stale:'var(--warn)',error:'var(--danger)',never:'var(--text-3)'}[syncStatus]||'var(--text-3)';
  return <nav style={{display:'flex',flexDirection:'column',width:212,minHeight:'100%',boxSizing:'border-box',padding:'14px 10px 10px',background:'var(--surface)',borderRight:'1px solid var(--border)',...style}}>
    <div style={{padding:'2px 8px 14px'}}><Logo/></div>
    <div style={{display:'flex',flexDirection:'column',gap:1,flex:1}}>
      {items.map(it=>it.section?<span key={it.section} className="hy-label" style={{padding:'14px 8px 5px'}}>{it.section}</span>:
        <button key={it.id} className={active===it.id?'':'hy-ghost hy-btn'} onClick={()=>onNavigate&&onNavigate(it.id)}
          style={{display:'flex',alignItems:'center',gap:9,height:30,padding:'0 8px',border:'none',borderRadius:'var(--r-md)',background:active===it.id?'var(--accent-soft)':'transparent',color:active===it.id?'var(--accent-strong)':'var(--text-2)',font:(active===it.id?'600':'400')+' var(--text-base)/1 var(--font-ui)',cursor:'pointer',textAlign:'left',width:'100%'}}>
          <Icon name={it.icon} size={17}/><span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{it.label}</span>
          {it.badge!=null&&<span className="tnum" style={{font:'500 var(--text-2xs)/1 var(--font-data)',color:'var(--text-3)'}}>{it.badge}</span>}
        </button>)}
    </div>
    {footer}
    <div className="hy-row" style={{display:'flex',alignItems:'center',gap:9,padding:8,borderRadius:'var(--r-md)',cursor:'pointer',borderTop:'1px solid var(--border)',marginTop:8}} title="Compte et réglages">
      <span style={{position:'relative',width:28,height:28,flex:'none'}}>
        <span style={{display:'flex',alignItems:'center',justifyContent:'center',width:28,height:28,borderRadius:'50%',background:'var(--surface-3)',color:'var(--text-2)',font:'600 var(--text-xs)/1 var(--font-ui)'}}>{(user.initials||user.name||'?').split(' ').map(s=>s[0]).join('').slice(0,2).toUpperCase()}</span>
        <span title={'Sync : '+syncStatus} style={{position:'absolute',right:-1,bottom:-1,width:9,height:9,borderRadius:'50%',background:dot,border:'2px solid var(--surface)'}}></span>
      </span>
      <span style={{flex:1,minWidth:0}}>
        <span style={{display:'block',font:'500 var(--text-sm)/1.2 var(--font-ui)',color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{user.name}</span>
        <span className="tnum" style={{display:'block',font:'400 var(--text-2xs)/1.2 var(--font-data)',color:'var(--text-3)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{syncDetail||user.email}</span>
      </span>
      <Icon name="unfold_more" size={14} color="var(--text-3)"/>
    </div>
  </nav>;
}

import React from 'react';
import {Icon} from '../core/Icon.jsx';
import {IconButton} from '../core/IconButton.jsx';
export const PRESETS=[{id:'24h',label:'24 h'},{id:'7d',label:'7 j'},{id:'1m',label:'1 m'},{id:'6m',label:'6 m'},{id:'1y',label:'1 an'},{id:'all',label:'Tout'}];
export function TimeNav({preset='1m',onPresetChange,rangeLabel='1 – 31 juil. 2026',onPrev,onNext,onRangeClick,compare=false,onCompareChange,compareLabel='vs juil. 2025',style}){
  return <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',...style}}>
    <div style={{display:'inline-flex',gap:2,padding:2,background:'var(--surface-2)',border:'1px solid var(--border)',borderRadius:'var(--r-md)'}}>
      {PRESETS.map(p=><button key={p.id} onClick={()=>onPresetChange&&onPresetChange(p.id)}
        style={{height:24,padding:'0 9px',border:'none',borderRadius:'calc(var(--r-md) - 2px)',background:preset===p.id?'var(--surface)':'transparent',boxShadow:preset===p.id?'var(--shadow-1)':'none',color:preset===p.id?'var(--text-1)':'var(--text-2)',font:(preset===p.id?'600':'400')+' var(--text-sm)/1 var(--font-ui)',cursor:'pointer',whiteSpace:'nowrap'}}>{p.label}</button>)}
    </div>
    <div style={{display:'inline-flex',alignItems:'center',gap:2}}>
      <IconButton icon="chevron_left" label="Période précédente" size="sm" onClick={onPrev}/>
      <button className="hy-btn hy-ghost" onClick={onRangeClick} title="Choisir une plage personnalisée"
        style={{display:'inline-flex',alignItems:'center',gap:7,height:'var(--control-h-md)',padding:'0 11px',background:'var(--surface)',border:'1px solid var(--border-strong)',borderRadius:'var(--r-md)',cursor:'pointer',color:'var(--text-1)'}}>
        <Icon name="calendar_month" size={15} color="var(--text-3)"/>
        <span className="tnum" style={{font:'500 var(--text-sm)/1 var(--font-data)'}}>{rangeLabel}</span>
        <Icon name="expand_more" size={14} color="var(--text-3)"/>
      </button>
      <IconButton icon="chevron_right" label="Période suivante" size="sm" onClick={onNext}/>
    </div>
    <button className="hy-btn" onClick={onCompareChange} title="Comparer avec une autre période"
      style={{display:'inline-flex',alignItems:'center',gap:6,height:'var(--control-h-md)',padding:'0 11px',borderRadius:'var(--r-md)',cursor:'pointer',background:compare?'var(--accent-soft)':'transparent',border:'1px solid '+(compare?'transparent':'var(--border-strong)'),color:compare?'var(--accent-strong)':'var(--text-2)',font:'500 var(--text-sm)/1 var(--font-ui)'}}>
      <Icon name="compare_arrows" size={15}/>{compare?compareLabel:'Comparer'}
    </button>
  </div>;
}

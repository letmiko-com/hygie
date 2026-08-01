import React,{useRef,useState} from 'react';
export function TimeScrubber({data=[],window:win=[0.6,0.9],onChange,height=48,color='var(--accent)',startLabel='2012',endLabel="aujourd'hui",style}){
  const ref=useRef(null);const drag=useRef(null);const [w,setW]=useState(win);
  const cur=onChange?win:w,set=onChange||setW;
  const pct=e=>{const b=ref.current.getBoundingClientRect();return Math.max(0,Math.min(1,(e.clientX-b.left)/b.width));};
  const down=(mode)=>e=>{e.preventDefault();drag.current={mode,start:pct(e),win:[...cur]};
    const move=ev=>{const d=drag.current;if(!d)return;const p=pct(ev),dx=p-d.start;let [a,b]=d.win;
      if(d.mode==='l')a=Math.min(d.win[0]+dx,b-0.02);else if(d.mode==='r')b=Math.max(d.win[1]+dx,a+0.02);
      else{const wd=b-a;a=Math.max(0,Math.min(1-wd,d.win[0]+dx));b=a+wd;}
      set([Math.max(0,a),Math.min(1,b)]);};
    const up=()=>{drag.current=null;document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);};
    document.addEventListener('pointermove',move);document.addEventListener('pointerup',up);};
  const min=Math.min(...data),max=Math.max(...data),r=(max-min)||1;
  const pts=data.map((v,i)=>(i/(data.length-1)*100).toFixed(2)+','+(97-((v-min)/r)*88).toFixed(2)).join(' ');
  const [a,b]=cur;
  return <div style={{...style}}>
    <div ref={ref} style={{position:'relative',height,borderRadius:'var(--r-sm)',background:'var(--surface-2)',border:'1px solid var(--border)',overflow:'hidden',touchAction:'none'}}>
      <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{position:'absolute',inset:0}}>
        <polygon points={'0,100 '+pts+' 100,100'} fill="var(--text-3)" opacity="0.18"/>
        <polyline points={pts} fill="none" stroke="var(--text-3)" strokeWidth="1" vectorEffect="non-scaling-stroke" opacity="0.6"/>
      </svg>
      <div onPointerDown={down('m')} style={{position:'absolute',top:0,bottom:0,left:a*100+'%',width:(b-a)*100+'%',background:'color-mix(in oklab, '+color+' 14%, transparent)',borderTop:'1.5px solid '+color,borderBottom:'1.5px solid '+color,cursor:'grab'}}></div>
      {[['l',a],['r',b]].map(([m,p])=><div key={m} onPointerDown={down(m)} style={{position:'absolute',top:0,bottom:0,left:'calc('+p*100+'% - 4px)',width:8,cursor:'ew-resize',display:'flex',alignItems:'center',justifyContent:'center'}}>
        <div style={{width:4,height:'70%',borderRadius:2,background:color}}></div>
      </div>)}
    </div>
    <div className="tnum" style={{display:'flex',justifyContent:'space-between',marginTop:4,font:'400 var(--text-2xs)/1 var(--font-data)',color:'var(--chart-axis)'}}><span>{startLabel}</span><span>{endLabel}</span></div>
  </div>;
}

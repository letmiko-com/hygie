const {MetricCard,StatTile,TrendChip,LineChart,EmptyState}=window.Hygie_70a315;
const slpPanel={background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--r-lg)',padding:14};
const PHASES=[{k:'deep',label:'Profond',color:'var(--data-sleep)',op:1},{k:'core',label:'Core',color:'var(--data-sleep)',op:0.55},{k:'rem',label:'REM',color:'var(--data-sleep)',op:0.3},{k:'awake',label:'Éveil',color:'var(--warn)',op:0.8}];
function NightBars({nights}){
  const max=9;
  const fmt=n=>{const h=Math.floor(n.total),m=Math.round((n.total-h)*60);return h+' h '+String(m).padStart(2,'0')+' — profond '+n.deep.toFixed(1)+' h';};
  return <div>
    <div style={{display:'flex',alignItems:'flex-end',gap:4,height:170,borderBottom:'1px solid var(--border-strong)'}}>
      {nights.map((n,i)=>n==null
        ?<div key={i} title="Pas de donnée (Watch non portée)" style={{flex:1,height:'40%',border:'1px dashed var(--border-strong)',borderBottom:'none',borderRadius:'2px 2px 0 0',boxSizing:'border-box'}}></div>
        :<div key={i} title={fmt(n)} style={{flex:1,display:'flex',flexDirection:'column-reverse',height:'100%'}}>
          {PHASES.map(p=><div key={p.k} style={{height:(n[p.k]/max*100)+'%',background:p.color,opacity:p.op,borderRadius:p.k==='awake'?'2px 2px 0 0':0}}></div>)}
        </div>)}
    </div>
    <div className="tnum" style={{display:'flex',justifyContent:'space-between',marginTop:5,font:'400 var(--text-2xs)/1 var(--font-data)',color:'var(--chart-axis)'}}><span>1 juil.</span><span>15 juil.</span><span>31 juil.</span></div>
    <div style={{display:'flex',gap:14,marginTop:10,alignItems:'center'}}>
      {PHASES.map(p=><span key={p.k} style={{display:'inline-flex',alignItems:'center',gap:5,font:'400 var(--text-xs)/1 var(--font-ui)',color:'var(--text-2)'}}><span style={{width:9,height:9,borderRadius:2,background:p.color,opacity:p.op}}></span>{p.label}</span>)}
      <span style={{display:'inline-flex',alignItems:'center',gap:5,font:'400 var(--text-xs)/1 var(--font-ui)',color:'var(--text-3)',marginLeft:'auto'}}><span style={{width:9,height:9,borderRadius:2,border:'1px dashed var(--border-strong)'}}></span>Pas de donnée — jamais compté comme 0</span>
    </div>
  </div>;
}
function HygieSleep({compare,compareLabel}){
  const D=window.HYGIE_DATA;
  const durNow=D.nights.map(n=>n?+n.total.toFixed(1):null);
  const durPrev=D.wave(31,7.1,0.6,6,42);
  const avg={deep:16,core:57,rem:22,awake:5};
  return <div style={{display:'flex',flexDirection:'column',gap:12}}>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(178px,1fr))',gap:10}}>
      <MetricCard icon="bedtime" label="Durée moyenne" value="7 h 24" delta={-1.2} data={D.wave(30,7.3,0.5,6,5)} color="var(--data-sleep)"/>
      <MetricCard icon="dark_mode" label="Sommeil profond" value="1 h 12" delta={4.1} data={D.wave(30,1.1,0.15,5,6)} color="var(--data-sleep)"/>
      <MetricCard icon="event_repeat" label="Régularité (coucher ±)" value="±38" unit="min" delta={-6.3} invert data={D.wave(30,44,8,5,7)} color="var(--data-sleep)"/>
      <MetricCard icon="schedule" label="Coucher moyen" value="23:12" delta="+18 min" invert data={D.nights.map(n=>n?n.bed:null).filter(v=>v!=null)} color="var(--data-sleep)" deltaLabel="vs période préc. — plus tard = moins bien"/>
    </div>
    <div style={slpPanel}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
        <span className="hy-label" style={{flex:1}}>Nuits — phases détaillées</span>
        <TrendChip delta={2.8} label="profond, vs période préc."/>
      </div>
      <NightBars nights={D.nights}/>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'3fr 2fr',gap:12}}>
      <div style={slpPanel}>
        <div className="hy-label" style={{marginBottom:12}}>Durée de sommeil (h) — moyenne glissante 7 nuits</div>
        <LineChart height={150} yFormat={v=>v.toFixed(1)} xLabels={['1 juil','8','15','22','31 juil']}
          series={compare?[{data:durNow,color:'var(--data-sleep)',label:'Cette période',avg:7},{data:durPrev,color:'var(--data-sleep)',label:compareLabel,dashed:true}]:[{data:durNow,color:'var(--data-sleep)',avg:7}]}/>
      </div>
      <div style={slpPanel}>
        <div className="hy-label" style={{marginBottom:14}}>Répartition moyenne des phases</div>
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {PHASES.map(p=><div key={p.k} style={{display:'flex',alignItems:'center',gap:10}}>
            <span style={{font:'400 var(--text-sm)/1 var(--font-ui)',color:'var(--text-2)',width:64,flex:'none'}}>{p.label}</span>
            <div style={{flex:1,height:10,background:'var(--surface-2)',borderRadius:'var(--r-sm)',overflow:'hidden'}}>
              <div style={{width:avg[p.k]+'%',height:'100%',background:p.color,opacity:p.op}}></div>
            </div>
            <span className="tnum" style={{font:'500 var(--text-sm)/1 var(--font-data)',width:44,textAlign:'right'}}>{avg[p.k]} %</span>
          </div>)}
        </div>
        <div style={{display:'flex',gap:24,marginTop:16,paddingTop:12,borderTop:'1px solid var(--border)'}}>
          <StatTile label="Nuits mesurées" value="29 / 31" sub="2 nuits sans donnée"/>
          <StatTile label="Segments (14 ans)" value="18 304"/>
        </div>
      </div>
    </div>
  </div>;
}
window.HygieSleep=HygieSleep;

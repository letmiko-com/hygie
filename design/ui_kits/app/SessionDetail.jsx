const {IconButton,Badge,SourceBadge,StatTile,TrendChip,LineChart,DataTable,Icon}=window.Hygie_70a315;
const detPanel={background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--r-lg)',padding:14};
function HygieSessionDetail({id,back}){
  const D=window.HYGIE_DATA;
  const s=D.sessions.find(x=>x.id===id)||D.sessions[0];
  const sp=D.SPORTS[s.sport];
  const fc=D.wave(52,s.fcAvg,12,6,s.id),alt=D.wave(52,54,28,9,s.id+3,0),pace=D.wave(52,5.05,0.35,7,s.id+5,2);
  return <div style={{display:'flex',flexDirection:'column',gap:12}}>
    <div style={{display:'flex',alignItems:'center',gap:10}}>
      <IconButton icon="arrow_back" label="Retour à la liste" variant="secondary" onClick={back}/>
      <span style={{display:'flex',alignItems:'center',justifyContent:'center',width:36,height:36,borderRadius:'var(--r-md)',background:'color-mix(in oklab, '+sp.color+' 13%, transparent)',color:sp.color}}><Icon name={sp.icon} size={20}/></span>
      <div style={{flex:1}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{font:'600 var(--text-xl)/1.2 var(--font-ui)'}}>{sp.label}</span>
          {s.record&&<Badge tone="accent" dot>Record — meilleur 10 km</Badge>}
        </div>
        <span className="tnum" style={{font:'400 var(--text-sm)/1.4 var(--font-data)',color:'var(--text-3)'}}>{s.date} 2026 · 07:12 → 08:04</span>
      </div>
      <SourceBadge source={s.source}/>
    </div>
    <div style={{...detPanel,display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(108px,1fr))',gap:'14px 20px'}}>
      <StatTile label="Durée" value={s.duration}/>
      <StatTile label="Distance" value={s.distance||null} sub={s.distance?null:'non mesurée'}/>
      <StatTile label={s.extra.label} value={s.extra.value} sub={<TrendChip delta={-4.6} invert label="vs moy. 90 j"/>}/>
      <StatTile label="FC moy." value={s.fcAvg} unit="bpm" color="var(--data-heart)" sub={<TrendChip delta={2.1} invert label="vs moy. 90 j"/>}/>
      <StatTile label="FC max" value={s.fcAvg+22} unit="bpm" color="var(--data-heart)"/>
      <StatTile label="Énergie" value={s.kcal.toLocaleString('fr-FR')} unit="kcal"/>
      <StatTile label="D+" value={s.gps?'84':null} unit={s.gps?'m':null} sub={s.gps?null:'pas de GPS'}/>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'1fr',gap:12}}>
      <div style={detPanel}>
        <div className="hy-label" style={{marginBottom:12}}>Fréquence cardiaque (bpm)</div>
        <LineChart height={150} area series={[{data:fc,color:'var(--data-heart)'}]} xLabels={['0:00','13:00','26:00','39:00',s.duration]}/>
      </div>
      <div style={{display:'grid',gridTemplateColumns:s.gps?'1fr 1fr':'1fr',gap:12}}>
        <div style={detPanel}>
          <div className="hy-label" style={{marginBottom:12}}>{s.sport==='bike'?'Puissance (W)':'Allure (min/km)'}</div>
          <LineChart height={110} series={[{data:s.sport==='bike'?D.wave(52,214,30,5,s.id+7,0):pace,color:'var(--data-distance)'}]} yFormat={v=>s.sport==='bike'?Math.round(v):v.toFixed(1)} xLabels={['0:00','fin']}/>
        </div>
        {s.gps&&<div style={detPanel}>
          <div className="hy-label" style={{marginBottom:12}}>Altitude (m)</div>
          <LineChart height={110} area series={[{data:alt,color:'var(--data-neutral)'}]} xLabels={['0:00','fin']}/>
        </div>}
      </div>
    </div>
    <div style={{display:'grid',gridTemplateColumns:s.gps?'5fr 4fr':'1fr',gap:12}}>
      <div style={{...detPanel,padding:'6px 10px'}}>
        <div className="hy-label" style={{padding:'8px 10px 2px'}}>Splits</div>
        <DataTable dense columns={[{key:'km',label:'Km',mono:true,width:50},{key:'pace',label:'Allure',align:'right',mono:true},{key:'fc',label:'FC moy',align:'right',mono:true},{key:'alt',label:'Dénivelé',align:'right',mono:true,muted:true}]} rows={D.splits}/>
      </div>
      {s.gps&&<div style={{...detPanel,padding:0,overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center',minHeight:280,background:'repeating-linear-gradient(45deg, var(--surface), var(--surface) 12px, var(--surface-2) 12px, var(--surface-2) 24px)'}}>
        <span className="tnum" style={{font:'500 var(--text-sm)/1.4 var(--font-data)',color:'var(--text-3)',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--r-md)',padding:'8px 14px'}}>TRACÉ GPS — carte à intégrer (372 séances géolocalisées)</span>
      </div>}
    </div>
  </div>;
}
window.HygieSessionDetail=HygieSessionDetail;

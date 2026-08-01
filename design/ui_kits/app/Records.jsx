const {StatTile,TrendChip,LineChart,DataTable,Sparkline,Badge,Icon}=window.Hygie_70a315;
const recPanel={background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--r-lg)',padding:14};
function RecordCard({r,openSession}){
  const D=window.HYGIE_DATA,sp=D.SPORTS[r.sport];
  return <div className={r.sessionId?'hy-row':''} onClick={r.sessionId?()=>openSession(r.sessionId):null}
    style={{...recPanel,display:'flex',flexDirection:'column',gap:8,cursor:r.sessionId?'pointer':'default',minWidth:0}}>
    <div style={{display:'flex',alignItems:'center',gap:6}}>
      <Icon name={sp.icon} size={15} color={sp.color}/>
      <span className="hy-label" style={{flex:1,overflow:'hidden',textOverflow:'ellipsis'}}>{r.label}</span>
      {r.recent&&<Badge tone="accent" dot>Nouveau</Badge>}
    </div>
    <div style={{display:'flex',alignItems:'baseline',gap:8}}>
      <span className="tnum" style={{font:'600 var(--text-2xl)/1 var(--font-ui)'}}>{r.value}</span>
      <span className="tnum" style={{font:'400 var(--text-xs)/1 var(--font-data)',color:'var(--text-3)',marginLeft:'auto'}}>{r.date}</span>
    </div>
    <div style={{display:'flex',alignItems:'center',gap:10}}>
      <Sparkline data={r.prog} color={sp.color} width={999} height={26} style={{width:'100%',flex:1}}/>
      <TrendChip delta={r.delta} invert={r.invert} label="12 mois"/>
    </div>
  </div>;
}
function HygieRecords({openSession}){
  const D=window.HYGIE_DATA;
  return <div style={{display:'flex',flexDirection:'column',gap:12}}>
    <div style={{display:'flex',alignItems:'baseline',gap:12}}>
      <h1 style={{margin:0,font:'600 var(--text-xl)/1.2 var(--font-ui)'}}>Records</h1>
      <span style={{font:'400 var(--text-sm)/1.3 var(--font-ui)',color:'var(--text-3)'}}>All-time et par sport — chaque record porte l'historique de sa progression. Clic → la séance où il a été établi.</span>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))',gap:10}}>
      {D.records.map(r=><RecordCard key={r.id} r={r} openSession={openSession}/>)}
    </div>
    <div style={{display:'grid',gridTemplateColumns:'5fr 4fr',gap:12}}>
      <div style={{...recPanel,padding:'6px 10px'}}>
        <div className="hy-label" style={{padding:'8px 10px 4px'}}>Records par sport</div>
        <DataTable columns={[
          {key:'sport',label:'Sport',width:90},
          {key:'event',label:'Épreuve'},
          {key:'rec',label:'Record',align:'right',mono:true},
          {key:'date',label:'Établi le',align:'right',mono:true,muted:true},
          {key:'trend',label:'12 mois',align:'right',render:r=>r.delta==null?null:<TrendChip delta={r.delta} invert={r.invert}/>}]}
          rows={D.recordRows} onRowClick={r=>r.sessionId&&openSession(r.sessionId)}/>
      </div>
      <div style={recPanel}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
          <span className="hy-label" style={{flex:1}}>Progression — 10 km (min)</span>
          <TrendChip delta={-14} invert label="depuis 2019"/>
        </div>
        <LineChart height={168} area yFormat={v=>v.toFixed(0)} xLabels={['2019','2020','2021','2022','2023','2024','2025','2026']}
          series={[{data:D.records[0].prog,color:'var(--data-activity)'}]}/>
        <div style={{font:'400 var(--text-xs)/1.5 var(--font-ui)',color:'var(--text-3)',marginTop:10}}>Meilleur temps par année. La progression d'un record est une tendance comme une autre : elle se lit dans le temps, pas comme une valeur isolée.</div>
      </div>
    </div>
  </div>;
}
window.HygieRecords=HygieRecords;

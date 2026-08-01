const {Input,Select,Tabs,SessionRow,StatTile,TrendChip,BarChart}=window.Hygie_70a315;
const sportPanel={background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--r-lg)',padding:14};
function HygieSport({openSession}){
  const D=window.HYGIE_DATA;
  const [tab,setTab]=React.useState('all');
  const [q,setQ]=React.useState('');
  const tabs=[{id:'all',label:'Toutes',count:961},{id:'strength',label:'Musculation',count:158},{id:'bike',label:'Vélo',count:158},{id:'walk',label:'Marche',count:153},{id:'run',label:'Course',count:144},{id:'yoga',label:'Yoga',count:104},{id:'row',label:'Rameur',count:79},{id:'more',label:'Autres…',count:165}];
  const list=D.sessions.filter(s=>(tab==='all'||s.sport===tab)&&(!q||D.SPORTS[s.sport].label.toLowerCase().includes(q.toLowerCase())));
  const months=[...new Set(list.map(s=>s.month))];
  return <div style={{display:'flex',flexDirection:'column',gap:12}}>
    <div style={{display:'flex',gap:24,alignItems:'flex-start'}}>
      <div style={{...sportPanel,display:'flex',gap:28,flex:1}}>
        <StatTile label="Séances" value="42" sub={<TrendChip delta={8} label="vs période préc."/>}/>
        <StatTile label="Durée totale" value="38 h 24" sub={<TrendChip delta={5.2} label="vs période préc."/>}/>
        <StatTile label="Distance" value="412" unit="km" sub={<TrendChip delta={-2.9} label="vs période préc."/>}/>
        <StatTile label="Énergie" value="24 450" unit="kcal" sub={<TrendChip delta={6.4} label="vs période préc."/>}/>
        <StatTile label="FC moy. en séance" value="138" unit="bpm" sub={<TrendChip delta={-1.8} invert label="vs période préc."/>}/>
      </div>
      <div style={{...sportPanel,flex:'0 1 300px',minWidth:220}}>
        <div className="hy-label" style={{marginBottom:8}}>Séances / semaine</div>
        <BarChart data={[4,5,3,6,5,7,6,5]} labels={['S23','S24','S25','S26','S27','S28','S29','S30']} color="var(--data-activity)" height={64}/>
      </div>
    </div>
    <div style={{display:'flex',gap:10,alignItems:'flex-end'}}>
      <Input icon="search" placeholder="Rechercher une séance…" value={q} onChange={e=>setQ(e.target.value)} style={{width:240}}/>
      <Select options={['Saison 2026','Saison 2025','Saison 2024']} style={{width:140}}/>
      <Tabs items={tabs} active={tab} onChange={setTab} style={{flex:1,overflow:'hidden'}}/>
    </div>
    <div style={{...sportPanel,padding:6}}>
      {months.map(m=><div key={m}>
        <div className="hy-label" style={{padding:'10px 12px 4px'}}>{m}</div>
        {list.filter(s=>s.month===m).map(s=>{const sp=D.SPORTS[s.sport];
          return <SessionRow key={s.id} icon={sp.icon} color={sp.color} title={sp.label} date={s.date} duration={s.duration} distance={s.distance}
            stats={[{label:'FC moy',value:s.fcAvg,color:'var(--data-heart)'},{label:s.extra.label,value:s.extra.value}]} source={s.source} onClick={()=>openSession(s.id)}/>;})}
      </div>)}
    </div>
  </div>;
}
window.HygieSport=HygieSport;

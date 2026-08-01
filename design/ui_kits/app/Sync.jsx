const {Button,StatTile,TrendChip,BarChart,DataTable,SyncBadge,SourceBadge,Badge,Icon}=window.Hygie_70a315;
const syncPanel={background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--r-lg)',padding:14};
function HygieSync({goDevices}){
  const D=window.HYGIE_DATA;
  return <div style={{display:'flex',flexDirection:'column',gap:12}}>
    <div style={{display:'flex',alignItems:'baseline',gap:12}}>
      <h1 style={{margin:0,font:'600 var(--text-xl)/1.2 var(--font-ui)'}}>Synchronisation</h1>
      <span style={{font:'400 var(--text-sm)/1.3 var(--font-ui)',color:'var(--text-3)'}}>Fraîcheur, volumes ingérés et trous de données de votre compte.</span>
    </div>
    <div style={{...syncPanel,display:'flex',alignItems:'center',gap:24,flexWrap:'wrap'}}>
      <div style={{display:'flex',flexDirection:'column',gap:6}}>
        <SyncBadge status="fresh" detail="il y a 4 min"/>
        <span className="tnum" style={{font:'400 var(--text-xs)/1.4 var(--font-data)',color:'var(--text-3)'}}>via Hygie Sync — iPhone 16 Pro</span>
      </div>
      <div style={{display:'flex',gap:28,flex:1,flexWrap:'wrap'}}>
        <StatTile label="Mesures totales" value="7 243 812" sub="97 types"/>
        <StatTile label="Période couverte" value="14 ans" sub="oct. 2012 → auj."/>
        <StatTile label="Ingéré — 30 j" value="1,15 M" sub={<TrendChip delta={3.4} label="vs mois préc."/>}/>
        <StatTile label="Séances" value="961" sub="372 avec GPS"/>
      </div>
      <Button icon="sync">Synchroniser maintenant</Button>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(250px,1fr))',gap:10}}>
      {D.syncSources.map(s=><div key={s.id} style={{...syncPanel,display:'flex',flexDirection:'column',gap:10}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <SourceBadge source={s.source} label={s.name}/>
          <SyncBadge status={s.status} detail={s.last} style={{marginLeft:'auto'}}/>
        </div>
        <div style={{display:'flex',gap:20}}>
          <StatTile label="30 jours" value={s.vol30} sub="mesures"/>
          <StatTile label="Types" value={s.types}/>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8,marginTop:'auto'}}>
          <span className="tnum" style={{font:'400 var(--text-2xs)/1.3 var(--font-data)',color:'var(--text-3)',flex:1}}>via {s.via}</span>
          <Button variant="ghost" size="sm" icon="settings" onClick={goDevices}>Gérer</Button>
        </div>
      </div>)}
    </div>
    <div style={{display:'grid',gridTemplateColumns:'3fr 2fr',gap:12}}>
      <div style={syncPanel}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
          <span className="hy-label" style={{flex:1}}>Mesures ingérées par jour — 30 j</span>
          <TrendChip delta={3.4} label="vs mois préc."/>
        </div>
        <BarChart data={D.syncDaily} labels={['3 juil','10','17','24','1 août']} color="var(--accent)" height={110} yFormat={v=>Math.round(v/1000)+' k'}/>
        <div style={{font:'400 var(--text-xs)/1.5 var(--font-ui)',color:'var(--text-3)',marginTop:8}}>Les barres en pointillé sont des jours <em>sans donnée reçue</em> — pas des jours à zéro mesure.</div>
      </div>
      <div style={{...syncPanel,display:'flex',flexDirection:'column',gap:4}}>
        <div className="hy-label" style={{marginBottom:8}}>Trous détectés</div>
        {D.gaps.map((g,i)=><div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 4px',borderTop:i?'1px solid var(--border)':'none'}}>
          <Icon name="error" size={16} color="var(--warn)" style={{flex:'none'}}/>
          <div style={{flex:1,minWidth:0}}>
            <span className="tnum" style={{display:'block',font:'500 var(--text-sm)/1.3 var(--font-data)'}}>{g.period}</span>
            <span style={{display:'block',font:'400 var(--text-xs)/1.3 var(--font-ui)',color:'var(--text-3)'}}>{g.types} — {g.cause}</span>
          </div>
          <Badge tone="warn">{g.n}</Badge>
        </div>)}
        <div style={{font:'400 var(--text-xs)/1.5 var(--font-ui)',color:'var(--text-3)',marginTop:'auto',paddingTop:8}}>Un trou reste visible dans les charts (pointillés) tant qu'un backfill ne l'a pas comblé.</div>
      </div>
    </div>
    <div style={{...syncPanel,padding:'6px 10px'}}>
      <div className="hy-label" style={{padding:'8px 10px 4px'}}>Types de données — top 8 sur 97</div>
      <DataTable dense columns={[
        {key:'type',label:'Type',render:r=><span style={{display:'inline-flex',alignItems:'center',gap:7}}><span style={{width:8,height:8,borderRadius:2,background:r.color,flex:'none'}}></span>{r.type}</span>},
        {key:'n',label:'Mesures',align:'right',mono:true},
        {key:'share',label:'Part',align:'right',mono:true,muted:true,render:r=>r.share?r.share.toFixed(1).replace('.',',')+' %':'< 0,1 %'},
        {key:'src',label:'Source principale',align:'right',muted:true}]}
        rows={D.dataTypes}/>
    </div>
  </div>;
}
window.HygieSync=HygieSync;

const {MetricCard,SourceBadge,SessionRow,StatTile,TrendChip,LineChart,BarChart,CalendarHeatmap,Gauge,Button}=window.Hygie_70a315;
const dashPanel={background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--r-lg)',padding:14};
const dashTitle={display:'flex',alignItems:'center',gap:8,marginBottom:12};
function DashSectionTitle({children,trend}){return <div style={dashTitle}><span className="hy-label" style={{flex:1}}>{children}</span>{trend}</div>;}
function HygieDashboard({compare,compareLabel,openSession,goSport}){
  const D=window.HYGIE_DATA;
  const fcNow=D.wave(31,142,10,5,2),fcPrev=D.wave(31,147,9,6,9);
  const kmWeek=[38,42,null,51,47,55,61,49];
  return <div style={{display:'flex',flexDirection:'column',gap:12}}>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(178px,1fr))',gap:10}}>
      <MetricCard icon="favorite" label="FC repos" value="52" unit="bpm" delta={-3.8} invert data={D.wave(30,54,2,4,1)} color="var(--data-heart)"/>
      <MetricCard icon="ecg" label="VFC" value="48" unit="ms" delta={6.1} data={D.wave(30,45,4,5,2)} color="var(--data-heart)"/>
      <MetricCard icon="local_fire_department" label="Énergie active / j" value="612" unit="kcal" delta={8.2} data={D.wave(30,560,60,4,3)} color="var(--data-energy)"/>
      <MetricCard icon="steps" label="Pas / j" value="9 842" delta={2.4} data={D.wave(30,9200,900,5,4)} color="var(--data-activity)"/>
      <MetricCard icon="bedtime" label="Sommeil moy." value="7 h 24" delta={-1.2} data={D.wave(30,7.3,0.5,6,5)} color="var(--data-sleep)"/>
      <MetricCard icon="speed" label="VO₂max" value="48,2" delta={0.8} data={D.wave(30,47.6,0.5,8,6)} color="var(--data-distance)"/>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'2fr 1fr',gap:12}}>
      <div style={dashPanel}>
        <DashSectionTitle trend={<TrendChip delta={-3.4} invert label="moyenne sur la période"/>}>Fréquence cardiaque — moyenne journalière</DashSectionTitle>
        <LineChart height={190} area xLabels={['1 juil','8','15','22','31 juil']}
          series={compare?[{data:fcNow,color:'var(--data-heart)',label:'Cette période',avg:7},{data:fcPrev,color:'var(--data-heart)',label:compareLabel,dashed:true}]:[{data:fcNow,color:'var(--data-heart)',label:'FC moy. (bpm)',avg:7}]}/>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <div style={dashPanel}>
          <DashSectionTitle>Aujourd'hui</DashSectionTitle>
          <div style={{display:'flex',alignItems:'center',gap:16}}>
            <Gauge value={412} max={600} unit="kcal" label="Énergie" color="var(--data-energy)" size={104}/>
            <div style={{display:'flex',flexDirection:'column',gap:10,flex:1}}>
              <StatTile label="Pas" value="6 214" sub="obj. 10 000"/>
              <StatTile label="Distance" value="4,8" unit="km"/>
            </div>
          </div>
        </div>
        <div style={dashPanel}>
          <DashSectionTitle trend={<TrendChip delta={12.5} label="vs période préc."/>}>Volume hebdo (km)</DashSectionTitle>
          <BarChart data={kmWeek} labels={['S23','S24','S25','S26','S27','S28','S29','S30']} color="var(--data-distance)" height={86}/>
        </div>
      </div>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'minmax(0,auto) minmax(320px,1fr)',gap:12}}>
      <div style={{...dashPanel,minWidth:0,overflowX:'auto'}}>
        <DashSectionTitle trend={<TrendChip delta={4.1} label="régularité 12 mois"/>}>Régularité d'entraînement — 52 semaines</DashSectionTitle>
        <CalendarHeatmap values={window.HYGIE_DATA.heatmap} color="var(--data-activity)"/>
        <div style={{display:'flex',gap:24,marginTop:12,paddingTop:10,borderTop:'1px solid var(--border)'}}>
          <StatTile label="Séances" value="42" sub={<TrendChip delta={8} label="vs période préc."/>}/>
          <StatTile label="Heures" value="38,4" sub={<TrendChip delta={5.2} label="vs période préc."/>}/>
          <StatTile label="Kilomètres" value="412" sub={<TrendChip delta={-2.9} label="vs période préc."/>}/>
        </div>
      </div>
      <div style={{...dashPanel,minWidth:0}}>
        <div style={dashTitle}>
          <span className="hy-label" style={{flex:1}}>Séances récentes</span>
          <Button variant="ghost" size="sm" icon="arrow_forward" onClick={goSport}>Tout voir</Button>
        </div>
        {window.HYGIE_DATA.sessions.slice(0,5).map(s=>{const sp=window.HYGIE_DATA.SPORTS[s.sport];
          return <SessionRow key={s.id} icon={sp.icon} color={sp.color} title={sp.label} date={s.date} duration={s.duration} distance={s.distance}
            stats={[{label:'FC moy',value:s.fcAvg,color:'var(--data-heart)'},{label:s.extra.label,value:s.extra.value}]} source={s.source} onClick={()=>openSession(s.id)}/>;})}
      </div>
    </div>
  </div>;
}
window.HygieDashboard=HygieDashboard;

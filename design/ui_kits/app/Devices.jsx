const {Button,Badge,SyncBadge,Icon,StatTile,DataTable}=window.Hygie_70a315;
const devPanel={background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--r-lg)',padding:14};
const devStripe={background:'repeating-linear-gradient(45deg, var(--surface), var(--surface) 12px, var(--surface-2) 12px, var(--surface-2) 24px)'};
const DEVICES=[
{id:1,icon:'smartphone',name:'iPhone 16 Pro',app:'Hygie Sync 1.4.2',status:'fresh',last:'il y a 4 min',paired:'12 janv. 2026',pushes:'2 340'},
{id:2,icon:'smartphone',name:'iPhone 13',app:'Hygie Sync 1.2.0',status:'never',last:'jamais depuis mars',paired:'8 mars 2024',pushes:'1 806',old:true}];
function HygieDevices({goSync}){
  const [pair,setPair]=React.useState(false);
  return <div style={{display:'flex',flexDirection:'column',gap:12,maxWidth:980}}>
    <div style={{display:'flex',alignItems:'baseline',gap:12}}>
      <h1 style={{margin:0,font:'600 var(--text-xl)/1.2 var(--font-ui)'}}>Appareils</h1>
      <span style={{font:'400 var(--text-sm)/1.3 var(--font-ui)',color:'var(--text-3)',flex:1}}>Les appareils appairés qui poussent vos données vers cette instance.</span>
      <Button icon="add" onClick={()=>setPair(!pair)}>Appairer un appareil</Button>
    </div>
    <div style={{display:'flex',alignItems:'center',gap:8,padding:'9px 12px',background:'var(--surface-2)',borderRadius:'var(--r-md)',color:'var(--text-2)',font:'400 var(--text-sm)/1.45 var(--font-ui)'}}>
      <Icon name="info" size={16}/>
      <span>Les capteurs (Apple Watch, Garmin, Withings) ne s'appairent pas ici : leurs mesures transitent par l'iPhone. Leur état se lit dans <a href="#" onClick={e=>{e.preventDefault();goSync();}}>Synchronisation</a>.</span>
    </div>
    {pair&&<div style={{...devPanel,display:'flex',gap:18,alignItems:'center'}}>
      <div style={{...devStripe,width:104,height:104,border:'1px solid var(--border)',borderRadius:'var(--r-md)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-3)',flex:'none'}}><Icon name="qr_code_2" size={32}/></div>
      <div style={{display:'flex',flexDirection:'column',gap:5,flex:1}}>
        <span style={{font:'500 var(--text-base)/1.3 var(--font-ui)'}}>Scannez ce code avec Hygie Sync sur le nouvel iPhone</span>
        <span style={{font:'400 var(--text-sm)/1.5 var(--font-ui)',color:'var(--text-2)'}}>Ou saisissez le code manuel dans l'app. L'appareil apparaîtra ici dès le premier envoi.</span>
        <div style={{display:'flex',alignItems:'baseline',gap:10,marginTop:4}}>
          <span className="tnum" style={{font:'600 var(--text-xl)/1 var(--font-data)',letterSpacing:'0.08em'}}>K2QM-58TF</span>
          <span className="tnum" style={{font:'400 var(--text-xs)/1 var(--font-data)',color:'var(--text-3)'}}>expire dans 9:12</span>
          <Button variant="ghost" size="sm" icon="refresh">Régénérer</Button>
        </div>
      </div>
    </div>}
    <div style={{display:'flex',flexDirection:'column',gap:10}}>
      {DEVICES.map(d=><div key={d.id} style={{...devPanel,display:'flex',alignItems:'center',gap:14,opacity:d.old?0.75:1}}>
        <span style={{display:'flex',alignItems:'center',justifyContent:'center',width:38,height:38,borderRadius:'var(--r-md)',background:'var(--surface-2)',color:'var(--text-2)',flex:'none'}}><Icon name={d.icon} size={20}/></span>
        <div style={{flex:'1 1 200px',minWidth:0}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{font:'500 var(--text-base)/1.25 var(--font-ui)'}}>{d.name}</span>
            {d.old&&<Badge tone="neutral">Inactif</Badge>}
          </div>
          <span className="tnum" style={{font:'400 var(--text-xs)/1.3 var(--font-data)',color:'var(--text-3)'}}>{d.app} · appairé le {d.paired}</span>
        </div>
        <SyncBadge status={d.status} detail={d.status==='never'?null:d.last} label={d.status==='never'?'Plus de sync '+d.last:null}/>
        <span className="tnum" style={{font:'500 var(--text-sm)/1 var(--font-data)',color:'var(--text-2)'}}>{d.pushes}<span style={{color:'var(--text-3)',font:'400 var(--text-2xs)/1 var(--font-ui)'}}> envois</span></span>
        <Button variant="ghost" size="sm" icon="link_off" style={{color:'var(--danger)'}}>Révoquer</Button>
      </div>)}
    </div>
    <div style={{display:'flex',gap:28,padding:'2px 4px'}}>
      <StatTile label="Appareils actifs" value="1"/>
      <StatTile label="Dernier envoi" value="il y a 4 min"/>
      <StatTile label="Fréquence moyenne" value="6" unit="sync/j"/>
    </div>
  </div>;
}
window.HygieDevices=HygieDevices;

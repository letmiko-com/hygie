const {Button,Input,Select,Icon,Badge}=window.Hygie_70a315;
const accPanel={background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--r-lg)',padding:16};
const {SegmentedControl:AccSeg}=window.Hygie_70a315;
function AccRow({label,hint,children}){
  return <div style={{display:'flex',alignItems:'center',gap:16,padding:'12px 0',borderTop:'1px solid var(--border)'}}>
    <div style={{flex:'1 1 220px'}}>
      <div style={{font:'500 var(--text-base)/1.3 var(--font-ui)'}}>{label}</div>
      {hint&&<div style={{font:'400 var(--text-xs)/1.4 var(--font-ui)',color:'var(--text-3)'}}>{hint}</div>}
    </div>
    {children}
  </div>;
}
function HygieAccount({logout,previewOnboarding}){
  const [theme,setTheme]=React.useState(document.documentElement.getAttribute('data-theme')||'auto');
  const setT=t=>{setTheme(t);if(t==='auto')document.documentElement.removeAttribute('data-theme');else document.documentElement.setAttribute('data-theme',t);};
  return <div style={{display:'flex',flexDirection:'column',gap:12,maxWidth:760}}>
    <h1 style={{margin:0,font:'600 var(--text-xl)/1.2 var(--font-ui)'}}>Réglages du compte</h1>
    <div style={accPanel}>
      <div style={{display:'flex',alignItems:'center',gap:12,paddingBottom:12}}>
        <span style={{display:'flex',alignItems:'center',justifyContent:'center',width:40,height:40,borderRadius:'50%',background:'var(--surface-3)',color:'var(--text-2)',font:'600 var(--text-md)/1 var(--font-ui)'}}>AM</span>
        <div style={{flex:1}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}><span style={{font:'600 var(--text-md)/1.3 var(--font-ui)'}}>Anna Martin</span><Badge tone="accent">Admin</Badge></div>
          <span className="tnum" style={{font:'400 var(--text-sm)/1.3 var(--font-data)',color:'var(--text-3)'}}>anna@exemple.fr</span>
        </div>
        <span style={{display:'inline-flex',alignItems:'center',gap:5,color:'var(--text-3)',font:'400 var(--text-xs)/1 var(--font-ui)'}}><Icon name="key" size={14}/>Identité gérée par magic link — pas de mot de passe</span>
      </div>
      <AccRow label="Langue" hint="Par défaut, Hygie suit la langue du navigateur.">
        <Select options={['Auto (navigateur) — Français','Français','English']} style={{width:240}}/>
      </AccRow>
      <AccRow label="Fuseau horaire" hint="Utilisé pour découper les journées et les nuits.">
        <Select options={['Europe/Paris (UTC+2)','Europe/London (UTC+1)','America/Montreal (UTC−4)']} style={{width:240}}/>
      </AccRow>
      <AccRow label="Unités">
        <AccSeg items={['Métrique','Impérial']} active="Métrique" onChange={()=>{}}/>
      </AccRow>
      <AccRow label="Thème" hint="Auto suit le réglage de l'appareil.">
        <AccSeg items={[{id:'auto',label:'Auto'},{id:'light',label:'Clair'},{id:'dark',label:'Sombre'}]} active={theme} onChange={setT}/>
      </AccRow>
      <AccRow label="Semaine commence le">
        <AccSeg items={['Lundi','Dimanche']} active="Lundi" onChange={()=>{}}/>
      </AccRow>
    </div>
    <div style={{...accPanel,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
      <div style={{flex:1,minWidth:200}}>
        <div style={{font:'500 var(--text-base)/1.3 var(--font-ui)'}}>Session</div>
        <div style={{font:'400 var(--text-xs)/1.4 var(--font-ui)',color:'var(--text-3)'}}>Connectée sur cet appareil depuis le 12 janv. 2026.</div>
      </div>
      <Button variant="ghost" size="sm" icon="slideshow" onClick={previewOnboarding}>Revoir l'onboarding</Button>
      <Button variant="secondary" icon="logout" onClick={logout}>Se déconnecter</Button>
    </div>
  </div>;
}
window.HygieAccount=HygieAccount;

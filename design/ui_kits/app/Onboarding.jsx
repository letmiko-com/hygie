const {Logo,Button,Icon,SyncBadge,Skeleton,MetricCard}=window.Hygie_70a315;
const obPanel={background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--r-lg)',padding:20};
const obStripe={background:'repeating-linear-gradient(45deg, var(--surface), var(--surface) 12px, var(--surface-2) 12px, var(--surface-2) 24px)'};
function HygieOnboarding({done}){
  const [step,setStep]=React.useState(0);
  const steps=['Bienvenue','Connecter vos sources','Premières données'];
  return <div style={{minHeight:'100vh',display:'flex',flexDirection:'column',alignItems:'center',padding:'48px 24px',boxSizing:'border-box',gap:24}}>
    <Logo size={26}/>
    <div style={{display:'flex',gap:8,alignItems:'center'}}>
      {steps.map((s,i)=><React.Fragment key={i}>
        <span style={{display:'inline-flex',alignItems:'center',gap:6,font:(i===step?'600':'400')+' var(--text-sm)/1 var(--font-ui)',color:i===step?'var(--text-1)':i<step?'var(--accent-strong)':'var(--text-3)'}}>
          <span className="tnum" style={{display:'flex',alignItems:'center',justifyContent:'center',width:18,height:18,borderRadius:'50%',background:i<step?'var(--accent-soft)':i===step?'var(--accent)':'var(--surface-3)',color:i<step?'var(--accent-strong)':i===step?'var(--on-accent)':'var(--text-3)',font:'600 var(--text-2xs)/1 var(--font-data)'}}>{i<step?'✓':i+1}</span>{s}
        </span>
        {i<2&&<span style={{width:28,height:1,background:'var(--border-strong)'}}></span>}
      </React.Fragment>)}
    </div>
    <div style={{width:'100%',maxWidth:720}}>
      {step===0&&<div style={{...obPanel,display:'flex',flexDirection:'column',gap:14,textAlign:'center',alignItems:'center',padding:36}}>
        <div style={{font:'600 var(--text-2xl)/1.2 var(--font-ui)'}}>Bienvenue sur Hygie, Anna</div>
        <div style={{font:'400 var(--text-md)/1.6 var(--font-ui)',color:'var(--text-2)',maxWidth:520}}>Hygie rassemble l'intégralité de vos données Apple Santé sur grand écran : sport, cœur, sommeil, sur n'importe quelle fenêtre temporelle. Vos données restent sur cette instance — rien ne part ailleurs, et chaque membre du foyer ne voit que les siennes.</div>
        <Button icon="arrow_forward" onClick={()=>setStep(1)}>Connecter mes sources</Button>
      </div>}
      {step===1&&<div style={{display:'flex',flexDirection:'column',gap:12}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div style={{...obPanel,display:'flex',flexDirection:'column',gap:10}}>
            <span className="hy-label">1 · Historique — export Apple Santé</span>
            <div style={{font:'400 var(--text-sm)/1.55 var(--font-ui)',color:'var(--text-2)'}}>Sur iPhone : Santé → photo de profil → <strong>Exporter toutes les données</strong>, puis déposez le fichier <code style={{fontFamily:'var(--font-data)',fontSize:'var(--text-xs)'}}>export.zip</code> ici. Vos 14 ans d'historique seront importés.</div>
            <div style={{...obStripe,border:'1px dashed var(--border-strong)',borderRadius:'var(--r-md)',minHeight:110,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6,color:'var(--text-3)'}}>
              <Icon name="upload_file" size={22}/>
              <span style={{font:'400 var(--text-sm)/1 var(--font-ui)'}}>Déposer export.zip — jusqu'à plusieurs Go</span>
            </div>
          </div>
          <div style={{...obPanel,display:'flex',flexDirection:'column',gap:10}}>
            <span className="hy-label">2 · Sync automatique — Hygie Sync</span>
            <div style={{font:'400 var(--text-sm)/1.55 var(--font-ui)',color:'var(--text-2)'}}>Installez <strong>Hygie Sync</strong> sur votre iPhone et scannez ce code pour appairer l'appareil. La sync tourne ensuite toute seule, plusieurs fois par jour.</div>
            <div style={{display:'flex',gap:14,alignItems:'center'}}>
              <div style={{...obStripe,width:96,height:96,border:'1px solid var(--border)',borderRadius:'var(--r-md)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-3)',flex:'none'}}><Icon name="qr_code_2" size={30}/></div>
              <div style={{display:'flex',flexDirection:'column',gap:4}}>
                <span className="hy-label">Ou code manuel</span>
                <span className="tnum" style={{font:'600 var(--text-lg)/1 var(--font-data)',letterSpacing:'0.08em'}}>A7F4-92KD</span>
                <span className="tnum" style={{font:'400 var(--text-2xs)/1 var(--font-data)',color:'var(--text-3)'}}>expire dans 9:42</span>
              </div>
            </div>
          </div>
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'space-between'}}>
          <Button variant="ghost" icon="arrow_back" onClick={()=>setStep(0)}>Retour</Button>
          <Button icon="arrow_forward" onClick={()=>setStep(2)}>J'ai connecté une source</Button>
        </div>
      </div>}
      {step===2&&<div style={{display:'flex',flexDirection:'column',gap:12}}>
        <div style={{...obPanel,display:'flex',flexDirection:'column',gap:12}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <SyncBadge status="syncing"/>
            <span style={{font:'400 var(--text-sm)/1.4 var(--font-ui)',color:'var(--text-2)'}}>Import en cours — les premières mesures arrivent. Vous pouvez fermer cette page, l'import continue.</span>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:7}}>
            {[['check_circle','var(--ok)','Fréquence cardiaque — 12 480 mesures importées'],['check_circle','var(--ok)','Séances de sport — 961 détectées'],['progress_activity','var(--accent)','Sommeil — analyse des segments…'],['radio_button_unchecked','var(--text-3)','Distance & GPS — en attente']].map(([ic,c,t],i)=>
            <span key={i} style={{display:'inline-flex',alignItems:'center',gap:8,font:'400 var(--text-sm)/1.3 var(--font-ui)',color:'var(--text-2)'}}><Icon name={ic} size={15} color={c} style={ic==='progress_activity'?{animation:'hy-spin 1s linear infinite'}:null}/>{t}</span>)}
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
          <MetricCard icon="favorite" label="FC repos" value="52" unit="bpm" data={[54,53,54,52,52]} color="var(--data-heart)"/>
          <MetricCard icon="bedtime" label="Sommeil" state="loading" color="var(--data-sleep)"/>
          <MetricCard icon="route" label="Distance" state="loading" color="var(--data-distance)"/>
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'space-between'}}>
          <Button variant="ghost" icon="arrow_back" onClick={()=>setStep(1)}>Retour</Button>
          <Button icon="monitoring" onClick={done}>Ouvrir le dashboard</Button>
        </div>
      </div>}
    </div>
  </div>;
}
window.HygieOnboarding=HygieOnboarding;

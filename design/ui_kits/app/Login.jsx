const {Logo,Input,Button,Icon}=window.Hygie_70a315;
const logPanel={background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--r-lg)',padding:28,width:400,boxSizing:'border-box',display:'flex',flexDirection:'column',gap:16};
function HygieLogin({done}){
  const [step,setStep]=React.useState('email');
  const [email,setEmail]=React.useState('anna@exemple.fr');
  return <div style={{minHeight:'100vh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:20,padding:24,boxSizing:'border-box'}}>
    <Logo size={26}/>
    {step==='email'&&<div style={logPanel}>
      <div>
        <div style={{font:'600 var(--text-lg)/1.3 var(--font-ui)'}}>Connexion</div>
        <div style={{font:'400 var(--text-sm)/1.5 var(--font-ui)',color:'var(--text-3)',marginTop:4}}>Instance privée — l'accès se fait uniquement sur invitation, par lien envoyé à votre adresse.</div>
      </div>
      <Input label="Adresse email" icon="mail" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="vous@exemple.fr"/>
      <Button icon="send" onClick={()=>setStep('sent')} style={{justifyContent:'center'}}>Recevoir le lien de connexion</Button>
    </div>}
    {step==='sent'&&<div style={{...logPanel,alignItems:'center',textAlign:'center'}}>
      <span style={{display:'flex',alignItems:'center',justifyContent:'center',width:44,height:44,borderRadius:'var(--r-full)',background:'var(--accent-soft)',color:'var(--accent-strong)'}}><Icon name="mark_email_unread" size={22}/></span>
      <div>
        <div style={{font:'600 var(--text-lg)/1.3 var(--font-ui)'}}>Lien envoyé</div>
        <div style={{font:'400 var(--text-sm)/1.5 var(--font-ui)',color:'var(--text-3)',marginTop:4}}>Un lien de connexion a été envoyé à <strong style={{color:'var(--text-1)'}}>{email}</strong>. Il est valable 15 minutes.</div>
      </div>
      <Button variant="secondary" icon="open_in_new" onClick={()=>setStep('confirmed')} style={{justifyContent:'center'}}>Ouvrir le lien (simulation)</Button>
      <button className="hy-btn hy-ghost" onClick={()=>setStep('email')} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-3)',font:'400 var(--text-sm)/1 var(--font-ui)',padding:6,borderRadius:'var(--r-sm)'}}>Adresse erronée ? Renvoyer</button>
    </div>}
    {step==='confirmed'&&<div style={{...logPanel,alignItems:'center',textAlign:'center'}}>
      <span style={{display:'flex',alignItems:'center',justifyContent:'center',width:44,height:44,borderRadius:'var(--r-full)',background:'var(--ok-soft)',color:'var(--ok)'}}><Icon name="check_circle" size={22}/></span>
      <div>
        <div style={{font:'600 var(--text-lg)/1.3 var(--font-ui)'}}>Connexion confirmée</div>
        <div style={{font:'400 var(--text-sm)/1.5 var(--font-ui)',color:'var(--text-3)',marginTop:4}}>Bonjour Anna. Votre session est ouverte sur cet appareil.</div>
      </div>
      <Button icon="arrow_forward" onClick={done} style={{justifyContent:'center'}}>Ouvrir le dashboard</Button>
    </div>}
    <span className="tnum" style={{font:'400 var(--text-2xs)/1 var(--font-data)',color:'var(--text-3)'}}>Hygie — self-hosted · AGPL-3.0</span>
  </div>;
}
window.HygieLogin=HygieLogin;

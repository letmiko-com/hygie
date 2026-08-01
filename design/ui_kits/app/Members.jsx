const {Button,Input,Select,Badge,SyncBadge,Icon,StatTile}=window.Hygie_70a315;
const memPanel={background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--r-lg)',padding:14};
const MEMBERS=[
{id:1,name:'Anna Martin',email:'anna@exemple.fr',role:'admin',status:'fresh',last:'il y a 4 min',vol:'7,24 M',since:'oct. 2012'},
{id:2,name:'Marc Martin',email:'marc@exemple.fr',role:'membre',status:'stale',last:'il y a 6 j',vol:'1,02 M',since:'mars 2024'},
{id:3,name:'Léa Martin',email:'lea@exemple.fr',role:'membre',status:'fresh',last:'il y a 2 h',vol:'318 k',since:'janv. 2026'}];
function MemberRow({m,pending,onRevoke}){
  const initials=m.name?m.name.split(' ').map(s=>s[0]).join('').slice(0,2).toUpperCase():'?';
  return <div style={{display:'flex',alignItems:'center',gap:12,padding:'11px 12px',borderTop:'1px solid var(--border)'}}>
    <span style={{display:'flex',alignItems:'center',justifyContent:'center',width:32,height:32,borderRadius:'50%',background:'var(--surface-3)',color:'var(--text-2)',font:'600 var(--text-xs)/1 var(--font-ui)',flex:'none'}}>{pending?<Icon name="hourglass_top" size={15}/>:initials}</span>
    <div style={{flex:'1 1 180px',minWidth:0}}>
      <div style={{display:'flex',alignItems:'center',gap:8}}>
        <span style={{font:'500 var(--text-base)/1.25 var(--font-ui)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.name||m.email}</span>
        {m.role==='admin'&&<Badge tone="accent">Admin</Badge>}
        {pending&&<Badge tone="neutral" dot>Invitation envoyée</Badge>}
      </div>
      <span className="tnum" style={{font:'400 var(--text-xs)/1.3 var(--font-data)',color:'var(--text-3)'}}>{m.email}{m.since?' · membre depuis '+m.since:''}</span>
    </div>
    {pending
      ?<span style={{font:'400 var(--text-xs)/1.3 var(--font-ui)',color:'var(--text-3)'}}>expire dans 6 j</span>
      :<React.Fragment>
        <SyncBadge status={m.status} detail={m.last}/>
        <span className="tnum" style={{font:'500 var(--text-sm)/1 var(--font-data)',color:'var(--text-2)',width:64,textAlign:'right'}}>{m.vol}<span style={{color:'var(--text-3)',font:'400 var(--text-2xs)/1 var(--font-ui)'}}> mesures</span></span>
        <span title="Les données de santé de ce membre sont visibles par lui seul" style={{display:'inline-flex',alignItems:'center',gap:5,color:'var(--text-3)',font:'400 var(--text-xs)/1 var(--font-ui)'}}><Icon name="lock" size={14}/>Données privées</span>
      </React.Fragment>}
    {pending&&<Button variant="ghost" size="sm" icon="forward_to_inbox">Renvoyer</Button>}
    {m.role!=='admin'&&<Button variant="ghost" size="sm" icon="person_remove" onClick={onRevoke} style={{color:'var(--danger)'}}>Révoquer</Button>}
  </div>;
}
function HygieMembers({previewOnboarding}){
  const [invite,setInvite]=React.useState(false);
  const [email,setEmail]=React.useState('');
  const [pending,setPending]=React.useState([]);
  return <div style={{display:'flex',flexDirection:'column',gap:12,maxWidth:980}}>
    <div style={{display:'flex',alignItems:'baseline',gap:12}}>
      <h1 style={{margin:0,font:'600 var(--text-xl)/1.2 var(--font-ui)'}}>Membres</h1>
      <span style={{font:'400 var(--text-sm)/1.3 var(--font-ui)',color:'var(--text-3)',flex:1}}>Administration de l'instance familiale.</span>
      <Button icon="person_add" onClick={()=>setInvite(!invite)}>Inviter un membre</Button>
    </div>
    <div style={{display:'flex',alignItems:'center',gap:8,padding:'9px 12px',background:'var(--accent-soft)',borderRadius:'var(--r-md)',color:'var(--accent-strong)',font:'400 var(--text-sm)/1.45 var(--font-ui)'}}>
      <Icon name="shield_lock" size={16}/>
      <span>En tant qu'admin, vous voyez l'<strong>état de synchronisation</strong> de chaque membre — jamais ses données de santé. Cette frontière est structurelle, pas un réglage.</span>
    </div>
    {invite&&<div style={{...memPanel,display:'flex',gap:10,alignItems:'flex-end',flexWrap:'wrap'}}>
      <Input label="Adresse email" icon="mail" type="email" placeholder="prenom@exemple.fr" value={email} onChange={e=>setEmail(e.target.value)} style={{flex:'1 1 220px'}}/>
      <Select label="Rôle" options={['Membre','Admin']} style={{width:120}}/>
      <Button icon="send" onClick={()=>{if(email){setPending([...pending,{email}]);setEmail('');setInvite(false);}}}>Envoyer l'invitation</Button>
      <span style={{font:'400 var(--text-xs)/1.4 var(--font-ui)',color:'var(--text-3)',flexBasis:'100%'}}>Le membre recevra un magic link, puis passera par l'<a href="#" onClick={e=>{e.preventDefault();previewOnboarding();}}>onboarding</a> pour connecter ses sources.</span>
    </div>}
    <div style={{...memPanel,padding:'2px 4px 4px'}}>
      {MEMBERS.map(m=><MemberRow key={m.id} m={m}/>)}
      {pending.map((m,i)=><MemberRow key={'p'+i} m={m} pending/>)}
    </div>
    <div style={{display:'flex',gap:28,padding:'2px 4px'}}>
      <StatTile label="Membres" value={String(3+pending.length)}/>
      <StatTile label="Invitations en attente" value={String(pending.length)||'0'}/>
      <StatTile label="Stockage instance" value="9,4" unit="Go" sub="sur 512 Go"/>
    </div>
  </div>;
}
window.HygieMembers=HygieMembers;

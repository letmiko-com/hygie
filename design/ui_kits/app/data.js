window.HYGIE_DATA=(()=>{
const R=(i,s)=>{const x=Math.sin(i*127.1+s*311.7)*43758.5453;return x-Math.floor(x);};
const wave=(n,b,a,f,s=1,d=1)=>Array.from({length:n},(_,i)=>+(b+a*Math.sin(i/f+s)+(R(i,s)-0.5)*a*0.6).toFixed(d));
const volumeAllTime=Array.from({length:170},(_,i)=>Math.max(0,(i<12?i/12:1)*(28+18*Math.sin(i/9)+14*Math.sin(i/23)+R(i,7)*12)));
const heatmap=Array.from({length:52*7},(_,i)=>{const r=R(i,3);return r<0.16?null:(r<0.38?0:+R(i,5).toFixed(2));});
const rangeLabels={'24h':['1 août 2026','vs 31 juil.'],'7d':['26 juil. – 1 août 2026','vs semaine préc.'],'1m':['juillet 2026','vs juin 2026'],'6m':['fév. – juil. 2026','vs août 25 – janv. 26'],'1y':['août 2025 – juil. 2026','vs 2024–2025'],'all':['oct. 2012 – août 2026','']};
const SPORTS={run:{icon:'directions_run',color:'var(--data-activity)',label:'Course à pied'},bike:{icon:'directions_bike',color:'var(--data-distance)',label:'Vélo route'},strength:{icon:'fitness_center',color:'var(--data-power)',label:'Musculation'},row:{icon:'rowing',color:'var(--data-water)',label:'Rameur'},yoga:{icon:'self_improvement',color:'var(--data-sleep)',label:'Yoga & mobilité'},tennis:{icon:'sports_tennis',color:'var(--data-energy)',label:'Tennis'},walk:{icon:'hiking',color:'var(--data-neutral)',label:'Marche'},cross:{icon:'exercise',color:'var(--data-heart)',label:'Cross-training'}};
const sessions=[
{id:1,sport:'run',date:'Ven 31 juil.',month:'Juillet 2026',duration:'52:18',distance:'10,24 km',fcAvg:152,extra:{label:'Allure',value:'5:06'},kcal:642,source:'apple-watch',gps:true,record:true},
{id:2,sport:'strength',date:'Jeu 30 juil.',month:'Juillet 2026',duration:'48:05',distance:null,fcAvg:118,extra:{label:'Kcal',value:342},kcal:342,source:'apple-watch',gps:false},
{id:3,sport:'bike',date:'Mar 28 juil.',month:'Juillet 2026',duration:'2:14:32',distance:'68,4 km',fcAvg:139,extra:{label:'Puiss.',value:'214 W'},kcal:1480,source:'garmin',gps:true},
{id:4,sport:'yoga',date:'Lun 27 juil.',month:'Juillet 2026',duration:'35:00',distance:null,fcAvg:82,extra:{label:'Kcal',value:96},kcal:96,source:'apple-watch',gps:false},
{id:5,sport:'run',date:'Sam 25 juil.',month:'Juillet 2026',duration:'1:07:44',distance:'12,8 km',fcAvg:148,extra:{label:'Allure',value:'5:17'},kcal:790,source:'apple-watch',gps:true},
{id:6,sport:'row',date:'Ven 24 juil.',month:'Juillet 2026',duration:'30:00',distance:'6 512 m',fcAvg:141,extra:{label:'/500m',value:'2:18'},kcal:312,source:'sensor',gps:false},
{id:7,sport:'tennis',date:'Mer 22 juil.',month:'Juillet 2026',duration:'1:22:10',distance:null,fcAvg:132,extra:{label:'Kcal',value:684},kcal:684,source:'apple-watch',gps:false},
{id:8,sport:'bike',date:'Dim 19 juil.',month:'Juillet 2026',duration:'3:02:51',distance:'94,1 km',fcAvg:143,extra:{label:'Puiss.',value:'221 W'},kcal:2105,source:'garmin',gps:true},
{id:9,sport:'strength',date:'Jeu 16 juil.',month:'Juillet 2026',duration:'52:30',distance:null,fcAvg:121,extra:{label:'Kcal',value:371},kcal:371,source:'apple-watch',gps:false},
{id:10,sport:'walk',date:'Mar 14 juil.',month:'Juillet 2026',duration:'1:45:00',distance:'8,9 km',fcAvg:98,extra:{label:'Kcal',value:412},kcal:412,source:'iphone',gps:true},
{id:11,sport:'run',date:'Dim 28 juin',month:'Juin 2026',duration:'44:02',distance:'8,61 km',fcAvg:155,extra:{label:'Allure',value:'5:07'},kcal:548,source:'apple-watch',gps:true},
{id:12,sport:'cross',date:'Ven 26 juin',month:'Juin 2026',duration:'40:00',distance:null,fcAvg:146,extra:{label:'Kcal',value:428},kcal:428,source:'apple-watch',gps:false},
{id:13,sport:'bike',date:'Mer 24 juin',month:'Juin 2026',duration:'1:48:19',distance:'52,7 km',fcAvg:137,extra:{label:'Puiss.',value:'208 W'},kcal:1190,source:'garmin',gps:true},
{id:14,sport:'yoga',date:'Lun 22 juin',month:'Juin 2026',duration:'45:00',distance:null,fcAvg:79,extra:{label:'Kcal',value:118},kcal:118,source:'apple-watch',gps:false}
];
const splits=[{km:'1',pace:'5:12',fc:141,alt:'+4 m'},{km:'2',pace:'5:04',fc:149,alt:'+2 m'},{km:'3',pace:'4:58',fc:153,alt:'−6 m'},{km:'4',pace:'5:01',fc:154,alt:'+11 m'},{km:'5',pace:'5:09',fc:156,alt:'+9 m'},{km:'6',pace:'5:03',fc:155,alt:'−8 m'},{km:'7',pace:'4:57',fc:157,alt:'−4 m'},{km:'8',pace:'5:02',fc:158,alt:'+3 m'},{km:'9',pace:'4:51',fc:161,alt:'−2 m'},{km:'10',pace:'4:38',fc:167,alt:'−7 m'}];
const records=[
{id:'r1',label:'10 km — course',value:'43:12',date:'31 juil. 2026',sessionId:1,prog:[50.2,48.5,47.1,46.0,45.2,44.4,43.9,43.2],delta:-1.6,invert:true,sport:'run',recent:true},
{id:'r2',label:'Semi-marathon',value:'1:38:04',date:'12 avr. 2026',prog:[112,108,105,103,101,99.5,98.6,98.1],delta:-0.9,invert:true,sport:'run'},
{id:'r3',label:'Puissance 20 min',value:'275 W',date:'19 juil. 2026',sessionId:8,prog:[228,235,241,248,255,262,268,275],delta:2.6,sport:'bike',recent:true},
{id:'r4',label:'2 000 m — rameur',value:'7:42,3',date:'3 mars 2026',prog:[8.6,8.4,8.3,8.1,8.0,7.9,7.8,7.7],delta:-1.3,invert:true,sport:'row'},
{id:'r5',label:'Plus longue sortie vélo',value:'142 km',date:'14 juin 2025',prog:[80,95,102,110,121,128,135,142],delta:5.2,sport:'bike'},
{id:'r6',label:'VO₂max',value:'48,2',date:'juil. 2026',prog:[44.1,44.8,45.5,46.2,46.8,47.3,47.8,48.2],delta:0.8,sport:'run'}];
const recordRows=[
{sport:'Course',event:'5 km',rec:'20:41',date:'8 mai 2026',delta:-1.1,invert:true},
{sport:'Course',event:'10 km',rec:'43:12',date:'31 juil. 2026',delta:-1.6,invert:true,sessionId:1},
{sport:'Course',event:'Semi-marathon',rec:'1:38:04',date:'12 avr. 2026',delta:-0.9,invert:true},
{sport:'Vélo',event:'40 km',rec:'1:09:22',date:'2 juin 2026',delta:-0.4,invert:true},
{sport:'Vélo',event:'100 km',rec:'3:14:50',date:'19 juil. 2026',delta:-2.1,invert:true,sessionId:8},
{sport:'Vélo',event:'Puissance 5 min',rec:'318 W',date:'19 juil. 2026',delta:3.1,sessionId:8},
{sport:'Rameur',event:'500 m',rec:'1:38,9',date:'11 janv. 2026',delta:-0.6,invert:true},
{sport:'Rameur',event:'2 000 m',rec:'7:42,3',date:'3 mars 2026',delta:-1.3,invert:true},
{sport:'Marche',event:'Plus longue distance',rec:'24,6 km',date:'17 août 2025',delta:null}];
const nights=Array.from({length:31},(_,i)=>{const r=R(i,11);if(r<0.07)return null;const total=6.4+R(i,12)*2.2;const deep=total*(0.15+R(i,13)*0.06),rem=total*(0.19+R(i,14)*0.07),awake=0.2+R(i,15)*0.45;return {deep,rem,core:total-deep-rem,awake,total,bed:22.8+R(i,16)*1.6};});
const syncDaily=Array.from({length:30},(_,i)=>{const r=R(i,21);return r<0.08?null:Math.round(38000+R(i,22)*30000);});
const syncSources=[
{id:'watch',source:'apple-watch',name:'Apple Watch Ultra 2',status:'fresh',last:'il y a 4 min',vol30:'842 k',types:64,via:'Hygie Sync (iPhone)'},
{id:'iphone',source:'iphone',name:'iPhone 16 Pro',status:'fresh',last:'il y a 4 min',vol30:'214 k',types:23,via:'Hygie Sync'},
{id:'withings',source:'withings',name:'Withings Body+',status:'stale',last:'il y a 9 j',vol30:'61',types:4,via:'Apple Santé'},
{id:'garmin',source:'garmin',name:'Garmin Edge 840',status:'fresh',last:'hier',vol30:'96 k',types:12,via:'HealthFit'}];
const dataTypes=[
{type:'Fréquence cardiaque',n:'1 852 340',share:25.6,src:'Apple Watch',color:'var(--data-heart)'},
{type:'Énergie active',n:'1 803 112',share:24.9,src:'Apple Watch',color:'var(--data-energy)'},
{type:'Distance marche/course',n:'944 208',share:13.0,src:'Apple Watch',color:'var(--data-activity)'},
{type:'Pas',n:'612 447',share:8.5,src:'iPhone + Watch',color:'var(--data-activity)'},
{type:'Distance vélo',n:'406 913',share:5.6,src:'Garmin',color:'var(--data-distance)'},
{type:'Puissance course',n:'388 020',share:5.4,src:'Apple Watch',color:'var(--data-power)'},
{type:'Segments de sommeil',n:'18 304',share:0.3,src:'Apple Watch',color:'var(--data-sleep)'},
{type:'ECG',n:'145',share:0,src:'Apple Watch',color:'var(--data-heart)'}];
const gaps=[
{period:'12 – 14 mai 2025',types:'FC, énergie, pas',cause:'Watch en réparation',n:'3 j'},
{period:'2 – 3 janv. 2024',types:'Sommeil',cause:'Watch non portée la nuit',n:'2 nuits'},
{period:'août 2016 → mars 2017',types:'Toutes séances',cause:'Avant première Apple Watch',n:'7 mois'}];
return {R,wave,volumeAllTime,heatmap,rangeLabels,SPORTS,sessions,splits,records,recordRows,nights,syncDaily,syncSources,dataTypes,gaps};
})();

const $=id=>document.getElementById(id);
const LIMIT=150,STORE='nexo-historicos-v7-prefs';
const defaults={order:'desc',flow:'ltr',clock:'hm',columns:'auto',fireworks:false};
let prefs={...defaults},catalog=[],page=0,mode='grid',current=[],count=0,working=false,lastFingerprint='',filters={},firstLoad=true,n=0,nextTick=0,lastVersionKey=null;
try{prefs={...defaults,...JSON.parse(localStorage.getItem(STORE)||'{}')}}catch{}
const fmt=n=>new Intl.NumberFormat('pt-BR').format(Number(n)||0);
const pct=(n,t)=>t?`${(100*n/t).toFixed(1).replace('.',',')}% dos resultados`:'0%';
const colorName=c=>({red:'Vermelha',black:'Preta',white:'Branca',low:'Abaixo de 2x',mid:'2–9,99x',high:'10x ou mais'})[c]||'—';
const isMultiplier=()=>getGame()?.kind==='multiplier';
const getGame=()=>catalog.find(p=>p.id===$('platform').value)?.games.find(g=>g.id===$('game').value);
const getPlatform=()=>catalog.find(p=>p.id===$('platform').value);
const supported=()=>!!getGame()?.connected;
const pad=n=>String(n).padStart(2,'0');
const timeDate=(sec,opts)=>sec?new Date(sec*1000).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',...opts}):'—';
const dateLong=sec=>timeDate(sec,{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});
function clockOf(r){
 const epoch=r.exact_epoch||r.minute_epoch,hm=timeDate(epoch,{hour:'2-digit',minute:'2-digit'});
 if(!epoch)return '—';
 if(prefs.clock==='hm')return hm;
 // Fonte pública só entrega HH:mm. Não completar com 00 ou .000 inventados.
 const seconds=r.exact_epoch?timeDate(r.exact_epoch,{second:'2-digit'}):null;
 if(prefs.clock==='hms')return `${hm}:${seconds||'--'}`;
 return `${hm}:${seconds||'--'}.---`;
}
function longTime(r){
 const day=timeDate(r.minute_epoch,{day:'2-digit',month:'2-digit',year:'numeric'});
 return `${day} ${clockOf(r)}`;
}
function dayToEpoch(day,end=false){if(!day)return null;return Math.floor(Date.parse(day+'T'+(end?'23:59:59':'00:00:00')+'-03:00')/1000);}
function getParams(){
 const qs=new URLSearchParams({platform:$('platform').value,game:$('game').value,
  precision:$('precision').value,limit:String(LIMIT),offset:String(page*LIMIT),order:prefs.order});
 if(!isMultiplier()){
  if(filters.color)qs.set('color',filters.color);
  if(filters.number!==undefined&&filters.number!=='')qs.set('number',filters.number);
 }
 if(filters.from)qs.set('from',dayToEpoch(filters.from));
 if(filters.to)qs.set('to',dayToEpoch(filters.to,true));
 return qs;
}
function fillCounts(c){const t=Number(c?.total)||0;count=t;$('total').textContent=fmt(t);
 for(const key of ['red','black','white']){$(key).textContent=fmt(c?.[key]);$(key+'-pct').textContent=pct(Number(c?.[key])||0,t);}}
function renderStats(){
 const kinds=isMultiplier()?['low','mid','high']:['red','black','white'];
 const totals=Object.fromEntries(kinds.map(x=>[x,0]));
 current.forEach(r=>{const key=isMultiplier()?r.numeric_value>=10?'high':r.numeric_value>=2?'mid':'low':r.color;if(key in totals)totals[key]++;});
 const t=current.length,bars=$('bars');bars.textContent='';
 for(const c of kinds){
  const wrap=document.createElement('div'),label=document.createElement('div');label.className='bar-label';
  const title=document.createElement('span');title.textContent=colorName(c);
  const val=document.createElement('strong');val.textContent=`${totals[c]} · ${t?(100*totals[c]/t).toFixed(1).replace('.',','):0}%`;
  label.append(title,val);
  const track=document.createElement('div');track.className='bar-track';const bar=document.createElement('div');bar.className='bar-fill '+c;
  bar.style.width=(t?(100*totals[c]/t):0)+'%';track.append(bar);wrap.append(label,track);bars.append(wrap);
 }
 if(isMultiplier()){$('streak').textContent='Multiplicadores históricos não indicam o próximo resultado.';return;}
 const first=current[0];let k=0;if(first)for(const r of current){if(r.color===first.color)k++;else break;}
 $('streak').textContent=first?`${k} ${k===1?'resultado':'resultados'} ${colorName(first.color).toLowerCase()}${k===1?'':'s'} consecutivo${k===1?'':'s'} nesta amostra.`:'Sem registros suficientes.';
}
function render(){
 const nodes=$('cards'),tbody=$('tbody');nodes.textContent='';tbody.textContent='';
 const fragment=document.createDocumentFragment(),rows=document.createDocumentFragment(),metric=isMultiplier();
 nodes.style.direction=prefs.flow==='rtl'?'rtl':'ltr';nodes.classList.toggle('custom-cols',prefs.columns!=='auto');
 if(prefs.columns!=='auto')nodes.style.setProperty('--user-cols',prefs.columns);else nodes.style.removeProperty('--user-cols');
 for(const [i,r] of current.entries()){
  const item=document.createElement('div');item.className='ball-item'+(!page&&!i?' newest':'');
  const ball=document.createElement('div');ball.className='ball '+(metric?(r.color||'low'):r.color);
  ball.textContent=metric?r.value:r.number;
  ball.title=`${metric?'Multiplicador '+r.value:'Pedra '+r.number+' · '+colorName(r.color)} · ${longTime(r)} · ${r.source}`;
  const label=document.createElement('div');label.className='ball-time';label.textContent=clockOf(r);
  item.append(ball,label);fragment.append(item);
  const tr=document.createElement('tr');
  const cols=[longTime(r),metric?r.value:r.number,metric?'Multiplicador':colorName(r.color),metric?'Não fornecido':r.official_period||'Não fornecido',r.source];
  for(let c=0;c<cols.length;c++){
   const td=document.createElement('td');
   if(c===1){const chip=document.createElement('span');chip.className='numchip '+(r.color||'');chip.textContent=cols[c];td.append(chip);}
   else td.textContent=cols[c];tr.append(td);
  }
  rows.append(tr);
 }
 nodes.append(fragment);tbody.append(rows);
 $('empty').classList.toggle('hidden',current.length>0);
 nodes.classList.toggle('hidden',!current.length||mode!=='grid');
 $('list').classList.toggle('hidden',!current.length||mode!=='list');
 $('grid-caption').textContent=current.length?`${fmt(current.length)} resultados nesta página · ${prefs.order==='desc'?'recentes primeiro':'antigos primeiro'} · ${prefs.clock==='hm'?'horas e minutos':'precisão conforme a fonte'}`:'Aguardando resultados públicos';
 $('pager-info').textContent=`${count?fmt(page*LIMIT+1):0}–${fmt(Math.min((page+1)*LIMIT,count))} de ${fmt(count)}`;
 $('prev').disabled=page===0;$('next').disabled=(page+1)*LIMIT>=count;
 renderStats();
}
function celebrate(){
 if(!prefs.fireworks||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const canvas=$('fireworksCanvas');canvas.hidden=false;
 const ctx=canvas.getContext('2d');if(!ctx)return;
 canvas.width=innerWidth*Math.min(devicePixelRatio||1,2);canvas.height=innerHeight*Math.min(devicePixelRatio||1,2);
 const w=canvas.width,h=canvas.height,palette=['#fff7c2','#ffd65c','#ff4f85','#79e9ea','#ffffff'];
 const bursts=Array.from({length:3},(_,i)=>({x:w*(.24+i*.26),y:h*(.18+Math.random()*.23)}));
 const dots=bursts.flatMap(b=>Array.from({length:52},()=>{
  const a=Math.random()*Math.PI*2,s=(2+Math.random()*6)*w/450;
  return {x:b.x,y:b.y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:1,color:palette[Math.floor(Math.random()*palette.length)]};
 }));let frame=0;
 function paint(){ctx.clearRect(0,0,w,h);frame++;
  dots.forEach(d=>{d.x+=d.vx;d.y+=d.vy;d.vy+=.045*w/450;d.vx*=.987;d.life-=.016;
   if(d.life>0){ctx.globalAlpha=d.life;ctx.fillStyle=d.color;ctx.beginPath();ctx.arc(d.x,d.y,2.2*w/450,0,Math.PI*2);ctx.fill();}});
  ctx.globalAlpha=1;if(frame<82)requestAnimationFrame(paint);else{canvas.hidden=true;ctx.clearRect(0,0,w,h);}
 }
 requestAnimationFrame(paint);
}
function updateMode(){
 const metric=isMultiplier();
 document.querySelectorAll('.double-only').forEach(el=>el.classList.toggle('hidden',metric));
 $('color').closest('label').classList.toggle('hidden',metric);
 $('number').closest('label').classList.toggle('hidden',metric);
 $('stats-red-label').textContent=metric?'Abaixo de 2x':'Vermelhas';
 $('stats-black-label').textContent=metric?'De 2x a 9,99x':'Pretas';
 $('stats-white-label').textContent=metric?'10x ou mais':'Brancas';
 $('bars-title').textContent=metric?'Faixas de multiplicadores':'Frequência das cores';
 $('result-heading').textContent=`Resultados do ${getGame()?.label||'jogo'}`;
 $('precision').disabled=metric;
 $('precision').value='minute';
 $('game-kind-note').textContent=metric?'Resultados públicos em multiplicadores (x). Não são previsões.':'Pedras recentes e cores do Double.';
}
async function readResults(force=false){
 if(working||!supported())return;working=true;
 try{
  // Detecta até resultados que entraram atrasados, abaixo da pedra do topo.
  if(!force&&current.length){
   const p=new URLSearchParams({platform:$('platform').value,game:$('game').value});
   const probe=await fetch('/api/version?'+p,{cache:'no-store'});
   if(probe.ok){const version=await probe.json();
    const key=String(version.version||0);
    if(key===lastVersionKey){$('server-online').textContent='Online';return;}
    lastVersionKey=key;
   }
  }
  const response=await fetch('/api/results?'+getParams(),{cache:'no-store'});
  if(!response.ok)throw Error(`HTTP ${response.status}`);
  const body=await response.json(),oldIDs=new Set(current.map(x=>x.id));
  const fingerprint=JSON.stringify([body.items?.map(x=>x.id),body.counts,prefs.order]);
  if(force||fingerprint!==lastFingerprint){
   const list=body.items||[];
   const isNewWhite=!firstLoad&&!isMultiplier()&&page===0&&prefs.order==='desc'&&oldIDs.size>0&&
    list.slice(0,8).some(r=>r.color==='white'&&!oldIDs.has(r.id));
   current=list;fillCounts(body.counts);render();lastFingerprint=fingerprint;
   if(isNewWhite)celebrate();
  }
  firstLoad=false;$('server-online').textContent='Online';
 }catch(e){$('server-online').textContent='Indisponível';$('head-label').textContent='Erro de conexão';$('live-dot').className='dot bad';}
 finally{working=false;}
}
async function readStatus(){
 try{
  const params=new URLSearchParams({platform:$('platform').value,game:$('game').value});
  const response=await fetch('/api/status?'+params,{cache:'no-store'});if(!response.ok)throw Error('HTTP '+response.status);
  const body=await response.json(),st=body.status;
  $('last-attempt').textContent=dateLong(st?.last_attempt);$('last-success').textContent=dateLong(st?.last_success);
  $('last-new').textContent=st?.last_new??'—';$('source-count').textContent=st?.last_count??'—';
  const age=st?.latest_minute?Math.max(0,Math.floor((body.now-st.latest_minute)/60)):null;
  $('source-age').textContent=age===null?'—':`${age} min`;
  const alive=!!st?.last_success,consulting=st?.message==='Consultando fonte';
  const successfulMessage=/^(Fonte pública consultada|Fonte publica consultada|Fonte atrasada)/.test(st?.message||'');
  const error=alive&&!consulting&&!successfulMessage&&(st?.last_attempt||0)>(st?.last_success||0)&&!!st?.message;
  const stale=age!==null&&age>5,box=document.querySelector('.source-status');box.classList.remove('bad','wait');
  let title='Coleta em funcionamento',description=st?.message||'Última leitura realizada',css='ok';
  if(!body.connected){title='Integração em preparação';description='O jogo está no catálogo, mas o parser público ainda não foi validado.';css='wait';}
  else if(!body.enabled){title='Coleta pausada pelo administrador';description='Os registros armazenados continuam disponíveis.';css='wait';}
  else if(!alive){title='Aguardando dados públicos';description=st?.message||'Ainda não houve leitura bem-sucedida. Clique em Verificar agora.';css='wait';}
  else if(consulting){title='Consultando fonte pública';description='O histórico salvo permanece disponível.';css='wait';}
  else if(error){title='Falha na última coleta';description=st.message+' · Histórico preservado.';css='bad';}
  else if(stale){title='Fonte pública atrasada';description=`Último registro publicado há aproximadamente ${age} min. ${st.message||''}`;css='wait';}
  $('status-title').textContent=title;$('status-explanation').textContent=description;
  if(css!=='ok')box.classList.add(css);$('head-label').textContent=title;$('live-dot').className='dot '+css;
  $('last-source').textContent='Fonte: Históricos Blaze (independente)';
 }catch(e){$('head-label').textContent='Servidor indisponível';$('live-dot').className='dot bad';$('server-online').textContent='Indisponível';}
}
async function requestSource(){
 if(document.hidden||Date.now()<nextTick||!supported())return;
 nextTick=Date.now()+20000;
 try{const params=new URLSearchParams({platform:$('platform').value,game:$('game').value});
  await fetch('/api/tick?'+params,{method:'POST',cache:'no-store',credentials:'same-origin'});
 }catch{ /* A ausência da fonte não elimina o histórico. */ }
}
async function tick(){
 if(document.hidden)return;
 if(n%4===0)void requestSource();
 await readResults();if(n++%3===0)await readStatus();
}
function resetData(){page=0;current=[];firstLoad=true;lastFingerprint='';nextTick=0;lastVersionKey=null;
 fillCounts({total:0,red:0,black:0,white:0});render();}
async function changeGame(p,g){
 if(!catalog.some(x=>x.id===p))return;
 $('platform').value=p;fillGames(p);$('game').value=g&&getPlatform()?.games.some(x=>x.id===g)?g:getPlatform().games[0].id;
 filters={};for(const id of ['color','number','fromDate','toDate'])$(id).value='';
 updateMode();resetData();localStorage.setItem('nexo-selected-platform',p);localStorage.setItem('nexo-selected-game',$('game').value);
 history.replaceState(null,'',`/resultados/${encodeURIComponent(p)}/${encodeURIComponent($('game').value)}`);
 paintSidebar();await Promise.all([readResults(true),readStatus()]);void requestSource();
}
function fillGames(p){const games=catalog.find(x=>x.id===p)?.games||[];
 $('game').textContent='';for(const g of games){const el=document.createElement('option');el.value=g.id;el.textContent=g.label+(g.connected?'':' · integração pendente');$('game').append(el);}}
function paintSidebar(){
 const container=$('navGames');container.textContent='';
 for(const p of catalog){
  const group=document.createElement('div');group.className='menu-group';
  const h=document.createElement('div');h.className='menu-platform';h.textContent=p.label;group.append(h);
  for(const g of p.games){
   const btn=document.createElement('button');btn.type='button';btn.className='menu-game'+($('platform').value===p.id&&$('game').value===g.id?' active':'');
   const name=document.createElement('span');name.textContent=g.label;
   const state=document.createElement('small');state.textContent=g.connected?'●':'○';state.title=g.connected?'Leitura pública preparada':'Integração não validada';
   btn.append(name,state);btn.addEventListener('click',()=>{closeMenu();changeGame(p.id,g.id);});group.append(btn);
  }container.append(group);
 }
}
function openMenu(){$('sidebar').classList.add('visible');$('menuBackdrop').classList.add('visible');$('menuToggle').setAttribute('aria-expanded','true');}
function closeMenu(){$('sidebar').classList.remove('visible');$('menuBackdrop').classList.remove('visible');$('menuToggle').setAttribute('aria-expanded','false');}
function updatePrefs(){
 for(const key of ['order','flow','clock','columns'])prefs[key]=$('pref-'+key).value;
 prefs.fireworks=$('pref-fireworks').checked;
 localStorage.setItem(STORE,JSON.stringify(prefs));lastFingerprint='';page=0;
 readResults(true);render();
}
function installEvents(){
 $('menuToggle').addEventListener('click',()=>($('sidebar').classList.contains('visible')?closeMenu():openMenu()));
 $('menuBackdrop').addEventListener('click',closeMenu);$('menuClose').addEventListener('click',closeMenu);
 $('number').insertAdjacentHTML('beforeend',Array.from({length:15},(_,i)=>`<option value="${i}">${i}</option>`).join(''));
 $('platform').addEventListener('change',()=>changeGame($('platform').value));
 $('game').addEventListener('change',()=>changeGame($('platform').value,$('game').value));
 $('apply').addEventListener('click',()=>{filters={color:$('color').value,number:$('number').value,from:$('fromDate').value,to:$('toDate').value};page=0;lastFingerprint='';readResults(true);});
 $('reset').addEventListener('click',()=>{for(const id of ['color','number','fromDate','toDate'])$(id).value='';filters={};page=0;lastFingerprint='';readResults(true);});
 $('precision').addEventListener('change',()=>{page=0;lastFingerprint='';readResults(true);});
 $('refresh').addEventListener('click',async()=>{void requestSource();await Promise.all([readResults(true),readStatus()]);});
 $('prev').addEventListener('click',()=>{if(page>0){page--;lastFingerprint='';readResults(true);}});
 $('next').addEventListener('click',()=>{if((page+1)*LIMIT<count){page++;lastFingerprint='';readResults(true);}});
 for(const m of ['grid','list'])$(m+'Mode').addEventListener('click',()=>{mode=m;$('gridMode').classList.toggle('selected',m==='grid');$('listMode').classList.toggle('selected',m==='list');render();});
 $('csv').addEventListener('click',()=>{const p=new URLSearchParams({platform:$('platform').value,game:$('game').value,precision:$('precision').value});window.location.href='/api/export.csv?'+p;});
 for(const key of ['order','flow','clock','columns']){$('pref-'+key).value=prefs[key];$('pref-'+key).addEventListener('change',updatePrefs);}
 $('pref-fireworks').checked=!!prefs.fireworks;$('pref-fireworks').addEventListener('change',updatePrefs);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){void requestSource();readResults(true);readStatus();}});
}
async function init(){
 installEvents();
 try{
  const response=await fetch('/api/catalog',{cache:'no-store'});if(!response.ok)throw new Error(`HTTP ${response.status}`);
  catalog=await response.json();
  $('platform').textContent='';for(const p of catalog){const op=document.createElement('option');op.value=p.id;op.textContent=p.label;$('platform').append(op);}
  const query=new URLSearchParams(location.search),parts=location.pathname.split('/').filter(Boolean);
  const validRoute=parts[0]==='resultados'&&parts.length===3;
  const p=(validRoute?parts[1]:query.get('platform'))||localStorage.getItem('nexo-selected-platform')||'smash';
  const g=(validRoute?parts[2]:query.get('game'))||localStorage.getItem('nexo-selected-game')||'double';
  await changeGame(catalog.some(x=>x.id===p)?p:'smash',g);
 }catch(e){$('status-title').textContent='Erro ao carregar catálogo';$('status-explanation').textContent=String(e.message||e);}
 setInterval(tick,5000);
}
await init();

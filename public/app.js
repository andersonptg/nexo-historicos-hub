const $=(id)=>document.getElementById(id);
let page=0,mode='grid',current=[],count=0,working=false,lastFingerprint='',filters={};
const LIMIT=150;
const fmt=n=>new Intl.NumberFormat('pt-BR').format(Number(n)||0);
const pct=(n,t)=>t?`${(100*n/t).toFixed(1).replace('.',',')}% dos resultados`:'0%';
const when=(sec,seconds=false)=>sec?new Date(sec*1000).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',...(seconds?{second:'2-digit'}:{})}):'—';
const dateLong=sec=>sec?new Date(sec*1000).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
const colorName=c=>({red:'Vermelha',black:'Preta',white:'Branca'})[c]||'—';
const htmlSafe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
function dayToEpoch(day,end=false){if(!day)return null;return Math.floor(Date.parse(day+'T'+(end?'23:59:59':'00:00:00')+'-03:00')/1000);}
function getParams(){const qs=new URLSearchParams({platform:$('platform').value,game:$('game').value,precision:$('precision').value,limit:LIMIT,offset:page*LIMIT});
 if(filters.color)qs.set('color',filters.color);if(filters.number!==undefined&&filters.number!=='')qs.set('number',filters.number);
 if(filters.from)qs.set('from',dayToEpoch(filters.from));if(filters.to)qs.set('to',dayToEpoch(filters.to,true));return qs;}
function fillCounts(c){const t=Number(c?.total)||0;count=t;$('total').textContent=fmt(t);
 for(const key of ['red','black','white']){$(key).textContent=fmt(c?.[key]);$(key+'-pct').textContent=pct(Number(c?.[key])||0,t);}}
function render(){const nodes=$('cards'),tbody=$('tbody');nodes.textContent='';tbody.textContent='';const isSecond=$('precision').value==='second';
 const fragment=document.createDocumentFragment(),rows=document.createDocumentFragment();
 for(const [i,r] of current.entries()){
   const item=document.createElement('div');item.className='ball-item'+(!page&&!i?' newest':'');
   const ball=document.createElement('div');ball.className='ball '+r.color;ball.textContent=r.number;
   ball.title=`Pedra ${r.number} · ${colorName(r.color)} · ${when(r.exact_epoch||r.minute_epoch,isSecond)} · ${r.source}`;
   const label=document.createElement('div');label.className='ball-time';label.textContent=when(r.exact_epoch||r.minute_epoch,isSecond).split(', ').at(-1);
   item.append(ball,label);fragment.append(item);
   const tr=document.createElement('tr');
   const columns=[dateLong(r.exact_epoch||r.minute_epoch),r.number,colorName(r.color),r.official_period||'Não fornecido',r.source];
   for(let c=0;c<5;c++){const td=document.createElement('td');if(c===1){const span=document.createElement('span');span.className='numchip '+r.color;span.textContent=r.number;td.append(span);}else td.textContent=columns[c];tr.append(td);}rows.append(tr);
 }
 nodes.append(fragment);tbody.append(rows);
 $('empty').classList.toggle('hidden',current.length>0);nodes.classList.toggle('hidden',!current.length||mode!=='grid');$('list').classList.toggle('hidden',!current.length||mode!=='list');
 $('grid-caption').textContent=current.length?`${fmt(current.length)} pedras nesta página • ${isSecond?'dados com segundos':'horários aproximados (minutos)'}`:'Aguardando resultados disponíveis';
 $('pager-info').textContent=`${count?fmt(page*LIMIT+1):0}–${fmt(Math.min((page+1)*LIMIT,count))} de ${fmt(count)} registros`;
 $('prev').disabled=page===0;$('next').disabled=(page+1)*LIMIT>=count;
 renderStats();
}
function renderStats(){const totals={red:0,black:0,white:0};current.forEach(r=>totals[r.color]++);
 const t=current.length;const bars=$('bars');bars.textContent='';
 for(const c of ['red','black','white']){
  const wrap=document.createElement('div');const label=document.createElement('div');label.className='bar-label';
  const n=document.createElement('span');n.textContent=colorName(c);const val=document.createElement('strong');val.textContent=`${totals[c]} · ${t?(100*totals[c]/t).toFixed(1).replace('.',','):0}%`;label.append(n,val);
  const track=document.createElement('div');track.className='bar-track';const bar=document.createElement('div');bar.className='bar-fill '+c;bar.style.width=(t?(100*totals[c]/t):0)+'%';track.append(bar);wrap.append(label,track);bars.append(wrap);
 }
 const first=current[0];let k=0;if(first){for(const r of current){if(r.color===first.color)k++;else break;}}
 $('streak').textContent=first?`${k} ${k===1?'resultado':'resultados'} ${colorName(first.color).toLowerCase()}${k===1?'':'s'} consecutivo${k===1?'':'s'} no topo desta amostra.`:'Sem registros suficientes.';
}
async function readResults(force=false){if(working)return;working=true;
 try{
  // Evita varrer todo o historico a cada 5 s quando nenhuma pedra mudou.
  if(!force&&page===0&&current.length){
    const p=getParams();p.set('limit','1');p.set('no_count','1');
    const probe=await fetch('/api/results?'+p,{cache:'no-store'});
    if(probe.ok){
      const latest=await probe.json();
      if(latest.items?.[0]?.id===current[0].id){$('server-online').textContent='Online';return;}
    }
  }
  const response=await fetch('/api/results?'+getParams(),{cache:'no-store'});if(!response.ok)throw Error('HTTP '+response.status);
  const body=await response.json();const fingerprint=JSON.stringify([body.items?.map(x=>x.id),body.counts,mode]);
  if(force||fingerprint!==lastFingerprint){current=body.items||[];fillCounts(body.counts);render();lastFingerprint=fingerprint;}
  $('server-online').textContent='Online';
 }catch(e){$('server-online').textContent='Indisponível';$('head-label').textContent='Erro de conexão';$('live-dot').className='dot bad';}
 finally{working=false;}
}
async function readStatus(){try{const response=await fetch('/api/status',{cache:'no-store'});if(!response.ok)throw Error('HTTP '+response.status);const json=await response.json();const st=json.status;
  $('last-attempt').textContent=dateLong(st?.last_attempt);$('last-success').textContent=dateLong(st?.last_success);
  $('last-new').textContent=st?.last_new??'—';$('source-count').textContent=st?.last_count??'—';
  const age=st?.latest_minute?Math.max(0,Math.floor((json.now-st.latest_minute)/60)):null;
  $('source-age').textContent=age===null?'—':`${age} min`;
  const alive=!!st?.last_success;
  const latestTry=st?.last_attempt||0;
  const consulting=st?.message==='Consultando fonte';
  const successfulMessage=/^(Fonte publica consultada|Fonte pública consultada|Fonte atrasada)/.test(st?.message||'');
  const error=alive&&!consulting&&!successfulMessage&&latestTry>(st?.last_success||0)&&!!st?.message;
  const stale=age!==null&&age>5;
  const statusBox=document.querySelector('.source-status');statusBox.classList.remove('bad','wait');
  if(!alive){statusBox.classList.add('wait');$('status-title').textContent='Aguardando dados públicos';$('status-explanation').textContent=st?.message||'O coletor ainda não realizou uma consulta bem-sucedida.';}
  else if(consulting){statusBox.classList.add('wait');$('status-title').textContent='Consultando fonte pública';$('status-explanation').textContent='O histórico já salvo continua disponível durante a consulta.';}
  else if(error){statusBox.classList.add('bad');$('status-title').textContent='Falha na última coleta';$('status-explanation').textContent=st.message+' · Os dados salvos permanecem disponíveis.';}
  else if(stale){statusBox.classList.add('wait');$('status-title').textContent='Fonte atrasada';$('status-explanation').textContent=`O último resultado público tem aproximadamente ${age} minutos. ${st.message||''}`;}
  else{$('status-title').textContent='Coleta em funcionamento';$('status-explanation').textContent=st?.message||'Última leitura realizada';}
  $('head-label').textContent=consulting?'Consultando fonte':alive&&!error&&!stale?'Fonte pública ativa':(!alive?'Aguardando coleta':stale?'Fonte atrasada':'Falha na coleta');
  $('live-dot').className='dot '+(consulting?'wait':alive&&!error&&!stale?'ok':error?'bad':'wait');
 }catch(e){$('head-label').textContent='Servidor indisponível';$('live-dot').className='dot bad';$('server-online').textContent='Indisponível';}
}
// O Worker limita globalmente a fonte a uma tentativa/20 s; a tela continua a cada 5 s.
let nextTick=0;
async function requestSource(){
 if(document.hidden||Date.now()<nextTick)return;
 nextTick=Date.now()+20000;
 try {await fetch('/api/tick',{method:'POST',cache:'no-store',credentials:'same-origin'});}
 catch(e){ /* Nao bloqueia o historico salvo quando a fonte esta fora. */ }
}
let n=0;async function tick(){
 if(document.hidden)return;
 if(n%4===0)void requestSource();
 await readResults();
 if(n++%3===0)await readStatus();
}
$('number').insertAdjacentHTML('beforeend',Array.from({length:15},(_,i)=>`<option value="${i}">${i}</option>`).join(''));
$('apply').addEventListener('click',()=>{filters={color:$('color').value,number:$('number').value,from:$('fromDate').value,to:$('toDate').value};page=0;lastFingerprint='';readResults(true);});
$('reset').addEventListener('click',()=>{['color','number','fromDate','toDate'].forEach(id=>$(id).value='');filters={};page=0;lastFingerprint='';readResults(true);});
$('precision').addEventListener('change',()=>{page=0;lastFingerprint='';readResults(true);});
$('refresh').addEventListener('click',async()=>{void requestSource();await Promise.all([readResults(true),readStatus()]);});
$('prev').addEventListener('click',()=>{if(page>0){page--;lastFingerprint='';readResults(true);}});
$('next').addEventListener('click',()=>{if((page+1)*LIMIT<count){page++;lastFingerprint='';readResults(true);}});
for(const m of ['grid','list'])$(m+'Mode').addEventListener('click',()=>{mode=m;$('gridMode').classList.toggle('selected',m==='grid');$('listMode').classList.toggle('selected',m==='list');render();});
$('csv').addEventListener('click',()=>{const p=new URLSearchParams({platform:$('platform').value,game:$('game').value,precision:$('precision').value});window.location.href='/api/export.csv?'+p;});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){void requestSource();readResults(true);readStatus();}});
await Promise.all([readResults(true),readStatus()]);void requestSource();setInterval(tick,5000);

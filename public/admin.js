const $=id=>document.getElementById(id);
const base={credentials:'same-origin',cache:'no-store'};
async function call(path,options={}){
 const response=await fetch(path,{...base,...options});
 const data=await response.json();if(!response.ok)throw Error(data.error||`HTTP ${response.status}`);return data;
}
const date=sec=>sec?new Date(sec*1000).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'Sem leitura';
function showAdmin(yes){$('auth').classList.toggle('hidden',yes);$('privatePanel').classList.toggle('hidden',!yes);}
function preview(){
 const nums=$('pattern').value.split(',').map(x=>x.trim()).filter(x=>/^\d{1,2}$/.test(x));
 const icons=nums.map(x=>Number(x)===0?'⚪':Number(x)<=7?'🔴':'⚫');
 const prefix=nums.slice(0,-1).map((x,i)=>`${icons[i]}${x}`).join(' ');
 const complete=nums.map((x,i)=>`${icons[i]}${x}`).join(' ');
 $('preAlert').textContent=`⚠️ ATENÇÃO, SINAL IDENTIFICADO\n\nPadrão parcial: ${prefix||'—'}\nAguardando confirmação da sequência.`;
 $('entryAlert').textContent=`${complete||'—'}\n\nENTRAR NO ${$('target').value.trim()||'ALVO CONFIGURADO'}\n\n- - - SINAL ATÉ GALE 2 - - -\n\n🤖 BLAZE PRO NEXO PTG 🤖\n\nDEMONSTRAÇÃO — NÃO ENVIADO`;
}
$('pattern').addEventListener('input',preview);$('target').addEventListener('input',preview);preview();
$('loginForm').addEventListener('submit',async event=>{
 event.preventDefault();$('loginMsg').textContent='Validando...';
 try{await call('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('password').value})});
 $('password').value='';$('loginMsg').textContent='';showAdmin(true);await loadSources();}
 catch(e){$('loginMsg').textContent=e.message;}
});
$('logout').addEventListener('click',async()=>{try{await call('/api/admin/logout',{method:'POST'});}finally{showAdmin(false);}});
$('reload').addEventListener('click',loadSources);
async function loadSources(){
 try{
  const data=await call('/api/admin/sources');$('sources').textContent='';
  for(const s of data.items){
   const tr=document.createElement('tr');
   const tdName=document.createElement('td');tdName.textContent=`${s.platform} / ${s.game}`;
   const tdStatus=document.createElement('td');tdStatus.className=s.enabled?'on':'off';tdStatus.textContent=s.enabled?'Ativa':'Pausada';
   const tdDate=document.createElement('td');tdDate.textContent=date(s.status?.last_success);
   tdDate.title=s.status?.message||'Aguardando';
   const tdAction=document.createElement('td'),button=document.createElement('button');button.textContent=s.enabled?'Pausar':'Ativar';
   button.addEventListener('click',async()=>{
    button.disabled=true;
    try{const changed=await call('/api/admin/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:s.id,enabled:!s.enabled})});if(!changed.confirmed||changed.enabled===s.enabled)throw Error('Alteracao nao confirmada pelo servidor');await loadSources();$('sourceMsg').textContent='Fonte '+s.platform+' / '+s.game+(changed.enabled?' reativada. Aguarde a proxima coleta.':' pausada.') ;}
    catch(e){$('sourceMsg').textContent=e.message;button.disabled=false;}
   });tdAction.append(button);tr.append(tdName,tdStatus,tdDate,tdAction);$('sources').append(tr);
  }
  $('sourceMsg').textContent=`${data.items.length} fontes com parser; atualização automática sujeita à disponibilidade pública.`;
 }catch(e){$('sourceMsg').textContent=e.message;}
}
try{
 const me=await call('/api/admin/whoami');
 if(me.authenticated){showAdmin(true);await loadSources();}
 else if(!me.configured)$('loginMsg').textContent='Admin desativado: defina o segredo ADMIN_TOKEN (senha forte de 16 caracteres ou mais) no Worker da Cloudflare.';
}catch(e){$('loginMsg').textContent=e.message;}

// V29: controles ADM existentes; nunca expõe token nem senha.
let v29={strategy:null,telegram:null,diag:null};
const setV29Message=msg=>{$('v29Message').textContent=String(msg||'');};
async function loadV29(){
 try{
  const [st,tg,diag]=await Promise.all([call('/api/strategies/state'),call('/api/telegram/status'),call('/api/strategies/diagnostics')]);
  v29={strategy:st,telegram:tg,diag};
  const config=tg.settings||{},s=st.settings||{},dest=$('v29Destination');
  dest.replaceChildren();
  const entries=[{id:'',name:'Destino principal configurado no Worker'},...(config.destinations||[])];
  for(const d of entries){const opt=document.createElement('option');opt.value=d.id;opt.textContent=d.name;dest.append(opt);}
  dest.value=config.signalDestination||'';
  $('v29WinText').checked=config.resultTextWithSticker===true;
  $('v29ResetMode').value=s.scoreResetMode==='manual'?'manual':'daily';
  $('v29Running').textContent=s.automatic?'Pausar novos sinais':'Iniciar novos sinais';
  $('v29Telegram').textContent=config.enabled?'Pausar envio Telegram':'Ativar envio Telegram';
  const wins=(st.score||[]).reduce((n,x)=>n+Number(x.wins||0),0),reds=(st.score||[]).reduce((n,x)=>n+Number(x.reds||0),0);
  const send=(tg.recent||[]).filter(x=>['win','winWhite','red'].includes(x.event_type)).slice(0,5).map(x=>`${x.event_type}: ${x.status}${x.last_error?' / '+x.last_error:''}`).join('\n')||'Sem resultados recentes';
  const warns=(diag.warnings||[]).join(', ')||'Nenhum aviso';
  $('v29Status').textContent=`Monitor: ${s.automatic?'ATIVO':'PAUSADO'} | Telegram: ${config.enabled?'ATIVO':'PAUSADO'}\nColeta: ${diag.collection?.last_new??'-'} novas | Cursor: ${diag.cursor?.age_seconds??'-'}s\nAvisos: ${warns}\nPlacar atual: ${wins} WIN / ${reds} RED\nFila recente:\n${send}`;
  setV29Message('Diagnóstico atualizado. Sinais automáticos disponíveis apenas para Smash Double.');
 }catch(e){setV29Message('Falha ao carregar: '+e.message);}
}
async function v29Action(fn){
 try{setV29Message('Aplicando...');await fn();await loadV29();}
 catch(e){setV29Message('Erro: '+e.message);}
}
$('v29Refresh').addEventListener('click',()=>loadV29());
$('v29Running').addEventListener('click',()=>v29Action(async()=>{
 const active=v29.strategy?.settings?.automatic===true;
 await call('/api/strategies/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({automatic:!active})});
}));
$('v29Telegram').addEventListener('click',()=>v29Action(async()=>{
 const active=v29.telegram?.settings?.enabled===true;
 await call('/api/telegram/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:!active})});
}));
$('v29SaveDest').addEventListener('click',()=>v29Action(async()=>{
 await call('/api/telegram/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({signalDestination:$('v29Destination').value})});
}));
$('v29SaveText').addEventListener('click',()=>v29Action(async()=>{
 await call('/api/telegram/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({resultTextWithSticker:$('v29WinText').checked})});
}));
$('v29TestDest').addEventListener('click',()=>v29Action(async()=>{
 const r=await call('/api/telegram/test-signal-destination',{method:'POST'});
 if(!r.ok)throw Error('Telegram não confirmou o teste');
}));
$('v29SaveResetMode').addEventListener('click',()=>v29Action(async()=>{
 await call('/api/strategies/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({scoreResetMode:$('v29ResetMode').value})});
}));
$('v29ResetNow').addEventListener('click',()=>{
 if(!confirm('Zerar os contadores WIN/RED agora? O histórico será mantido.'))return;
 v29Action(async()=>{await call('/api/strategies/score/reset',{method:'POST'});});
});
// O painel chama a consulta apenas quando houver sessão ADM autenticada.
const oldShowAdmin=showAdmin;
showAdmin=function(yes){oldShowAdmin(yes);if(yes)loadV29();};
if(!$('auth').classList.contains('hidden')){ /* aguarda login */ }
else loadV29();

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

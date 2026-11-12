const $=id=>document.getElementById(id);
const PREFS_KEY='nexo-historicos-v7-prefs';
const types=['activation','prealert','entry','gale1','gale2','win','winWhite','red','brand'];
const mediaTypes=['activation','entry','gale1','gale2','win','winWhite','red'];
const labels={activation:'🚨 ATENÇÃO — ao ativar o robô (uma vez)',prealert:'Pré-aviso de padrão (texto)',entry:'Entrada',gale1:'Gale 1',gale2:'Gale 2',win:'WIN ✅',winWhite:'WIN NO BRANCO ⚪',red:'RED ❌',brand:'Assinatura'};
const colors={red:'Vermelho',black:'Preto',white:'Branco'};
const defaultTemplates={activation:'🚨 ATENÇÃO — ROBÔ ATIVADO!\n🤖 BLAZE PRO NEXO PTG 🤖',prealert:'🔎 Pré-aviso de sequência\nSequência parcial: {PATTERN}\nAguardando confirmação.',entry:'🎯 ENTRAR NO {TARGET}\n- - - - SINAL ATÉ GALE {GALE} - - - -',gale1:'- - - - GALE 1 - - - -',gale2:'- - - - GALE 2 - - - -',win:'✅ WIN — alvo confirmado na rodada registrada.',winWhite:'✅ WIN NO BRANCO ⚪ — acerto na pedra branca.',red:'❌ RED — alvo não confirmado até o limite configurado.',brand:'🤖 BLAZE PRO NEXO PTG 🤖'};
const api=async(url,opts={})=>{const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...opts});const body=await r.json();if(!r.ok)throw Error(body.error||`HTTP ${r.status}`);return body;};
const send=(path,method,data)=>api(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
let serverState=null,rules=[],editing=null,pattern=[],winColor='black',useNumbers=false,busy=false,prefs={},knownIds=new Set(),lastStone=null,firstBalls=true,lastEventSeq=0;
try{prefs=JSON.parse(localStorage.getItem(PREFS_KEY)||'{}')}catch{}
const emoji={red:'🔴',black:'⚫',white:'⚪'};
const tokenText=t=>t.kind==='color'?emoji[t.value]:String(t.value);
const colorOf=n=>n===0?'white':n<=7?'red':'black';
const desc=rule=>[...rule.pattern.map(tokenText),'=',...rule.targets.map(tokenText)].join('  ');
const opt=n=>String(n).padStart(2,'0');
function brasil(sec,kind='date'){
 if(!sec)return '—';const date=new Date(sec*1000);
 return date.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:kind==='date'?'2-digit':undefined,month:kind==='date'?'2-digit':undefined,year:kind==='date'?'numeric':undefined,hour:'2-digit',minute:'2-digit'});
}
function flash(message,id='editorMsg',ok=false){const x=$(id);x.textContent=message;x.classList.toggle('good',ok);}
function prefSave(){localStorage.setItem(PREFS_KEY,JSON.stringify(prefs));}
// NEXO V10 - EDITOR DE PEDRAS: seleção de cores/números no mesmo campo.
function makeStone(token,onclick=null,title=''){
 const c=token.kind==='number'?colorOf(token.value):token.value;
 const el=document.createElement(onclick?'button':'span');
 el.className='stone-tile stone-'+c+(onclick?' clickable':'');
 const circle=document.createElement('span');circle.className='stone-circle';
 circle.textContent=token.kind==='number'?String(token.value):'';
 el.append(circle);
 if(onclick){el.type='button';el.onclick=onclick;el.title=title;el.setAttribute('aria-label',title);}
 return el;
}
function renderBuilder(){
 const chips=$('patternChips');chips.textContent='';
 pattern.forEach((token,index)=>chips.append(makeStone(token,()=>{pattern.splice(index,1);renderBuilder();},'Remover pedra '+(index+1))));
 if(!pattern.length){const note=document.createElement('span');note.className='muted';note.textContent='Toque nas pedras abaixo para formar a sequência.';chips.append(note);}
 $('patternCount').textContent=pattern.length+' pedra'+(pattern.length===1?'':'s');
 $('useNumbers').checked=useNumbers;
 const picker=$('stonePicker');picker.textContent='';
 const palette=useNumbers?Array.from({length:15},(_,n)=>({kind:'number',value:n})):[{kind:'color',value:'red'},{kind:'color',value:'black'},{kind:'color',value:'white'}];
 for(const token of palette)picker.append(makeStone(token,()=>addToken({...token}),'Adicionar '+(token.kind==='number'?'pedra '+token.value:colors[token.value])));
 for(const b of document.querySelectorAll('#winPicker [data-win]')){
  const chosen=b.dataset.win===winColor;b.classList.toggle('chosen',chosen);b.setAttribute('aria-pressed',String(chosen));
 }
 const target=$('targetChips');target.textContent='';
 const arrow=document.createElement('span');arrow.className='equal-sign';arrow.textContent='=';target.append(arrow);
 target.append(makeStone({kind:'color',value:winColor}));
 if(winColor!=='white'){
  const or=document.createElement('span');or.className='or-sign';or.textContent='OU';target.append(or);
  target.append(makeStone({kind:'color',value:'white'}));
 }
 $('saveRule').textContent=editing?'Salvar alterações':'＋ Salvar estratégia';
 $('editorHeading').textContent=editing?'Editar sequência':'Nova sequência';
}
function addToken(token){
 // 500 pedras de memória por regra; o motor acumula resultados entre coletas.
 if(pattern.length>=500){flash('Limite técnico de 500 pedras por sequência.');return;}
 pattern.push(token);renderBuilder();flash('');
}
function resetEditor(){editing=null;pattern=[];winColor='black';useNumbers=false;$('ruleName').value='Minha estratégia';$('galeMax').value='0';$('ruleEnabled').checked=true;renderBuilder();flash('');}
function editorRule(){return {name:$('ruleName').value.trim(),pattern:[...pattern],targets:[{kind:'color',value:winColor}],galeMax:Number($('galeMax').value),enabled:$('ruleEnabled').checked};}
function validClient(r){if(!r.name||r.name.length>70)throw Error('Informe um nome de até 70 caracteres');if(r.pattern.length<1||r.pattern.length>500)throw Error('Use entre 1 e 500 pedras');if(r.targets.length!==1||r.targets[0].kind!=='color')throw Error('Escolha uma cor para WIN');return r;}
function loadEditor(r){
 editing=r.id;pattern=r.pattern.map(x=>({...x}));
 const first=r.targets.find(x=>x.kind==='color')||r.targets[0];winColor=first?.kind==='color'?first.value:colorOf(first?.value??8);
 useNumbers=pattern.some(x=>x.kind==='number');
 $('ruleName').value=r.name;$('galeMax').value=String(r.galeMax);$('ruleEnabled').checked=r.enabled;
 renderBuilder();flash(r.targets.length>1?'Esta regra antiga tem vários alvos. Ao salvar, será utilizada a cor selecionada mais o branco.':'');
 $('editorHeading').scrollIntoView({behavior:'smooth',block:'center'});
}
function appendTokenList(parent,items){for(const token of items)parent.append(makeStone(token));}
function button(label,fn,clazz=''){const btn=document.createElement('button');btn.textContent=label;btn.type='button';btn.className=clazz;btn.onclick=fn;return btn;}
async function safe(action,errorId='editorMsg'){try{await action();}catch(e){flash(e.message,errorId);}}
function drawRules(){const host=$('strategies');host.textContent='';$('strategyCount').textContent=String(rules.length);
 if(!rules.length){const msg=document.createElement('p');msg.className='muted';msg.textContent='Nenhuma estratégia cadastrada. Monte uma sequência no editor.';host.append(msg);return;}
 for(const rule of rules){const card=document.createElement('div');card.className='rule-card';
 const top=document.createElement('div');top.className='rule-top';const name=document.createElement('strong');name.textContent=rule.name;
 const status=document.createElement('span');status.textContent=rule.enabled?'● Ativa':'○ Pausada';status.className='rule-status'+(rule.enabled?' on':'');top.append(name,status);
 const seq=document.createElement('div');seq.className='rule-seq';appendTokenList(seq,rule.pattern);seq.append(document.createTextNode(' = '));appendTokenList(seq,rule.targets);if(rule.targets.some(x=>x.kind==='color')&&!rule.targets.some(x=>x.kind==='color'&&x.value==='white')){seq.append(document.createTextNode(' OU '));appendTokenList(seq,[{kind:'color',value:'white'}]);}
 const sub=document.createElement('p');sub.className='rule-extra';sub.textContent=`Gale máximo: ${rule.galeMax} · Estratégia local sem apostas · Fonte Smash Double`;
 const actions=document.createElement('div');actions.className='rule-actions';
 actions.append(button('✎ Editar',()=>loadEditor(rule)),button(rule.enabled?'⏸ Pausar':'▶ Ativar',()=>safe(async()=>{await send(`/api/strategies/${rule.id}`,'PUT',{...rule,enabled:!rule.enabled});await loadState(false);})),button('▣ Duplicar',()=>safe(async()=>{await send('/api/strategies','POST',{...rule,name:(rule.name+' (cópia)').slice(0,70),enabled:false});await loadState(false);})),button('✕ Excluir',()=>safe(async()=>{if(!confirm('Excluir esta estratégia e seus eventos históricos?'))return;await api(`/api/strategies/${rule.id}`,{method:'DELETE'});await loadState(false);},'editorMsg'),'danger'));
 card.append(top,seq,sub,actions);host.append(card);
 }
}
function drawEvents(){const host=$('events');host.textContent='';const logs=serverState?.events||[];
 if(!logs.length){const p=document.createElement('p');p.className='muted';p.textContent='Nenhum sinal registrado. A detecção começa somente com resultados novos após ativar o automático.';host.append(p);return;}
 for(const e of logs){const card=document.createElement('div');card.className='event-card '+e.event_type;const top=document.createElement('div');top.className='event-top';const title=document.createElement('strong');const names={prealert:'⚠ Pré-aviso',clear_prealert:'🧹 Remover pré-aviso',cancel_prealert:'↩ Pré-aviso cancelado',entry:'🎯 Entrada',gale1:'⤴ Gale 1',gale2:'⤴ Gale 2',win:'✅ WIN',red:'❌ RED'};title.textContent=names[e.event_type]||e.event_type;
 const meta=document.createElement('small');meta.textContent=(e.event_type==='win'?`Pedra ${e.round_number} · `:'')+brasil(e.minute_epoch);top.append(title,meta);card.append(top);if(e.message){const content=document.createElement('pre');content.textContent=e.message;card.append(content);}host.append(card);}
}
function drawTemplates(){
 const host=$('templates');host.textContent='';
 const models=serverState?.settings?.templates||defaultTemplates;
 const savedMedia=telegramSettingsCache?.media||{};
 for(const type of types){
  const card=document.createElement('div');card.className='telegram-event-card';
  const label=document.createElement('label');label.textContent=labels[type];
  const text=document.createElement('textarea');text.id='template-'+type;
  text.value=models[type]??defaultTemplates[type]??'';text.maxLength=type==='brand'?150:1000;text.rows=type==='entry'||type==='prealert'?3:2;
  label.append(text);card.append(label);
  if(mediaTypes.includes(type)){
   const row=document.createElement('div');row.className='telegram-media-fields';
   const typeLabel=document.createElement('label');typeLabel.textContent='Formato de envio';
   const select=document.createElement('select');select.id='tg-media-type-'+type;
   for(const [value,title] of [['none','Só texto'],['animation','GIF / Animação com legenda'],['sticker','Sticker + mensagem de texto']]){
    const option=document.createElement('option');option.value=value;option.textContent=title;select.append(option);
   }
   select.value=savedMedia[type]?.type||'none';typeLabel.append(select);
   const idLabel=document.createElement('label');idLabel.textContent='FILE_ID do Telegram';
   const idInput=document.createElement('input');idInput.id='tg-file-id-'+type;idInput.autocomplete='off';idInput.placeholder='Cole ou escolha com Puxar do Telegram';idInput.value=savedMedia[type]?.fileId||'';idLabel.append(idInput);
   const pull=document.createElement('button');pull.type='button';pull.className='outline';pull.textContent='↧ Puxar do Telegram';
   pull.onclick=()=>safe(()=>pullTelegramMedia(type),'templateMsg');
   const found=document.createElement('select');found.id='tg-found-'+type;found.className='hidden';
   found.onchange=()=>{const choice=telegramMediaCache[Number(found.value)];if(!choice)return;select.value=choice.type;idInput.value=choice.fileId;};
   row.append(typeLabel,idLabel,pull,found);card.append(row);
  }
  if(type==='activation'){
   const p=document.createElement('p');p.className='muted';p.textContent='Envia uma vez somente quando o botão Envio automático muda de desligado para ligado. Não se repete a cada pedra.';card.append(p);
  }
  if(type==='win'){
   const p=document.createElement('p');p.className='muted';p.textContent='A linha Pedra sorteada (⚫12) é acrescentada automaticamente apenas abaixo do WIN. Não escreva a pedra nos outros modelos.';card.append(p);
  }
  host.append(card);
 }
}
let telegramSettingsCache=null,telegramMediaCache=[];
async function pullTelegramMedia(type){
 const response=await api('/api/telegram/media');telegramMediaCache=response.items||[];
 const chosen=$('tg-found-'+type);chosen.textContent='';
 const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Selecione um GIF ou Sticker recebido';chosen.append(placeholder);
 telegramMediaCache.forEach((m,i)=>{const opt=document.createElement('option');opt.value=String(i);opt.textContent=m.label;chosen.append(opt);});
 chosen.classList.toggle('hidden',!telegramMediaCache.length);
 flash(telegramMediaCache.length?'Escolha a mídia na lista do evento.':response.notice,'templateMsg',!!telegramMediaCache.length);
}
function collectTelegramMedia(){
 return Object.fromEntries(mediaTypes.map(k=>[k,{type:$('tg-media-type-'+k).value,fileId:$('tg-file-id-'+k).value.trim()}]));
}

function reflectSettings(){const config=serverState?.settings;if(!config)return;
 for(const k of ['automatic','prealert','entry','fireworks'])$(k).checked=!!config[k];
 for(const k of ['order','flow','clock'])$(k).value=prefs[k]||({order:'desc',flow:'ltr',clock:'hm'})[k];
}
async function loadState(refreshEditor=false){const result=await api('/api/strategies/state?platform=smash&game=double');const initial=!serverState;serverState=result;rules=result.strategies;lastEventSeq=Math.max(0,...result.events.map(e=>e.seq||0));drawRules();drawEvents();if(initial||refreshEditor){drawTemplates();reflectSettings();} $('head-label').textContent='Banco D1 ativo';$('live-dot').className='dot ok';}
async function changeSetting(key){const data={[key]:$(key).checked};await send('/api/strategies/settings','PUT',data);if(key==='fireworks'){prefs.fireworks=data.fireworks;prefSave();}flash(key==='automatic'?($(key).checked?'Monitoramento automático ativado.':'Monitoramento pausado.'): 'Preferência salva no D1.','saveMsg',true);await loadState(false);}
async function login(){const password=$('password').value;await send('/api/admin/login','POST',{password});$('password').value='';$('loginPanel').classList.add('hidden');$('secureApp').classList.remove('hidden');await loadState(true);await loadTelegram();await loadCatalog();await readBalls();void requestTick();}
function showLogin(error=''){ $('loginPanel').classList.remove('hidden');$('secureApp').classList.add('hidden');$('loginMsg').textContent=error;}
async function loadCatalog(){try{const platforms=await api('/api/catalog');const host=$('navGames');host.textContent='';for(const p of platforms){const group=document.createElement('div');group.className='menu-group';const title=document.createElement('div');title.className='menu-platform';title.textContent=p.label;group.append(title);for(const game of p.games){const a=document.createElement('a');a.href=`/resultados/${encodeURIComponent(p.id)}/${encodeURIComponent(game.id)}`;a.textContent=game.label;const mark=document.createElement('small');mark.textContent=game.connected?'●':'○';a.append(mark);group.append(a);}host.append(group);}}catch{}}
async function readEvents(){if(document.hidden||!serverState)return;
 const result=await api('/api/strategies/events?after='+lastEventSeq);
 if(result.events.length){lastEventSeq=Math.max(lastEventSeq,...result.events.map(e=>e.seq));serverState.events=[...result.events.reverse(),...serverState.events].slice(0,100);drawEvents();}
}
async function requestTick(){if(!document.hidden&&serverState)try{await fetch('/api/tick?platform=smash&game=double',{method:'POST',credentials:'same-origin'});}catch{}}
async function readBalls(){if(document.hidden||!serverState)return;
 try{const result=await api('/api/results?platform=smash&game=double&precision=minute&limit=20&no_count=1');const rows=result.items||[];const host=$('latestBalls');host.textContent='';const sequence=(prefs.order==='asc'?[...rows].reverse():rows);
 for(const r of sequence){const item=document.createElement('div');item.className='mini-stone'+(r.id===lastStone?' arriving':'');const chip=document.createElement('span');chip.className='token-visual '+r.color;chip.textContent=String(r.number);const label=document.createElement('small');const hh=brasil(r.minute_epoch,'clock');label.textContent=prefs.clock==='hm'?hh:prefs.clock==='hms'?hh+':--':hh+':--.---';item.append(chip,label);host.append(item);}
 host.style.flexDirection='row';host.style.direction=prefs.flow==='rtl'?'rtl':'ltr';host.querySelectorAll('.mini-stone').forEach(x=>x.style.direction='ltr');
 const added=rows.filter(x=>!knownIds.has(x.id));if(!firstBalls&&added.some(x=>x.color==='white')&&$('fireworks').checked)celebrate();knownIds=new Set(rows.map(x=>x.id));firstBalls=false;lastStone=rows[0]?.id||null;
 $('sourceLabel').textContent=`Fonte pública · última pedra publicada ${rows[0]?brasil(rows[0].minute_epoch):'indisponível'} · precisão de minuto`;
 }catch(e){$('sourceLabel').textContent='Falha ao consultar histórico: '+e.message;}
}
function celebrate(){if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;const canvas=$('fireworksCanvas');const ctx=canvas.getContext('2d');if(!ctx)return;canvas.hidden=false;const ratio=Math.min(window.devicePixelRatio||1,2);canvas.width=innerWidth*ratio;canvas.height=innerHeight*ratio;const stars=Array.from({length:120},(_,i)=>{const angle=Math.PI*2*(i%40)/40,speed=(2+Math.random()*4)*ratio;return {x:canvas.width*(0.3+(Math.floor(i/40)*0.2)),y:canvas.height*0.36,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,life:1};});let frame=0;const draw=()=>{ctx.clearRect(0,0,canvas.width,canvas.height);for(const s of stars){s.x+=s.vx;s.y+=s.vy;s.vy+=.08*ratio;s.life-=.023;ctx.globalAlpha=Math.max(0,s.life);ctx.fillStyle=['#ff3a84','#f7d753','#66e8ff'][Math.floor(frame/6)%3];ctx.fillRect(s.x,s.y,3*ratio,3*ratio);}ctx.globalAlpha=1;if(++frame<45)requestAnimationFrame(draw);else canvas.hidden=true;};requestAnimationFrame(draw);}
const tgFields=['enabled','prealert','entry','gale1','gale2','win','red','deletePrealert'];
let telegramReady=false;
async function loadTelegram(){
 const status=await api('/api/telegram/status');telegramReady=!!status.configured;telegramSettingsCache=status.settings;drawTemplates();
 for(const field of tgFields)$('tg-'+field).checked=!!status.settings[field];
 $('telegramConnection').textContent=status.configured
  ? '⚙️ Segredos presentes (formato válido). Faça o teste de envio. '+(status.settings.enabled?'Envio habilitado.':'Envio de sinais desativado.')
  : '⚠️ Aguardando configuração: defina TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID como Secrets no Worker.';
 const list=status.recent||[];
 const summary=(status.counts||[]).map(x=>`${x.status}: ${x.n}`).join(' · ');
 $('telegramDelivery').textContent=(summary||'Nenhuma mensagem na fila')+(list.length?'\nÚltimas tentativas:\n'+list.slice(0,8).map(x=>`${x.event_type} — ${x.status}${x.last_error?' ('+x.last_error+')':''}`).join('\n'):'');
}
async function saveTelegram(){
 const data=Object.fromEntries(tgFields.map(k=>[k,$('tg-'+k).checked]));
 await send('/api/telegram/settings','PUT',data);
 await loadTelegram();flash('Preferências do Telegram salvas.','telegramMessage',true);
}
async function testTelegram(){
 if(!confirm('Enviar uma mensagem de TESTE para o chat configurado no Worker?'))return;
 const r=await send('/api/telegram/test','POST',{});
 flash(r.ok?'Teste enviado! Confira o Telegram.':'Falha no envio do teste.','telegramMessage',!!r.ok);
 await loadTelegram();
}
function initHandlers(){
 $('menuToggle').onclick=()=>{$('sidebar').classList.add('visible');$('menuBackdrop').classList.add('visible');$('menuToggle').setAttribute('aria-expanded','true');};
 const close=()=>{$('sidebar').classList.remove('visible');$('menuBackdrop').classList.remove('visible');$('menuToggle').setAttribute('aria-expanded','false');};$('menuClose').onclick=close;$('menuBackdrop').onclick=close;
 $('loginForm').onsubmit=e=>{e.preventDefault();safe(login,'loginMsg');};
 $('telegramSave').onclick=()=>safe(saveTelegram,'telegramMessage');
 $('telegramTest').onclick=()=>safe(testTelegram,'telegramMessage');
 $('telegramReload').onclick=()=>safe(loadTelegram,'telegramMessage');
 $('logout').onclick=()=>safe(async()=>{await api('/api/admin/logout',{method:'POST'});showLogin('Sessão encerrada.');});
 for(const key of ['automatic','prealert','entry','fireworks'])$(key).onchange=()=>safe(()=>changeSetting(key),'saveMsg');
 for(const key of ['order','flow','clock'])$(key).onchange=()=>{prefs[key]=$(key).value;prefSave();readBalls();};
 $('removeLast').onclick=()=>{pattern.pop();renderBuilder();};
 $('clearPattern').onclick=()=>{pattern=[];renderBuilder();};
 $('useNumbers').onchange=()=>{useNumbers=$('useNumbers').checked;renderBuilder();};
 document.querySelectorAll('#winPicker [data-win]').forEach(b=>b.onclick=()=>{winColor=b.dataset.win;renderBuilder();});
 $('newRule').onclick=resetEditor;
 $('saveRule').onclick=()=>safe(async()=>{const rule=validClient(editorRule());await send(editing?'/api/strategies/'+editing:'/api/strategies',editing?'PUT':'POST',rule);resetEditor();await loadState(false);flash('Estratégia salva no banco D1.','editorMsg',true);});
 $('loadExamples').onclick=()=>safe(async()=>{
   if(!confirm('Adicionar as duas sequências de exemplo ao seu banco (pausadas)?'))return;
   for(const [name,nums,target] of [['Branco, vermelha, vermelha, preta, preta',[0,1,1,8,8],'red'],['Branco e quatro vermelhas',[0,1,1,1,1],'black']])
    await send('/api/strategies','POST',{name,pattern:nums.map(n=>({kind:'color',value:colorOf(n)})),targets:[{kind:'color',value:target}],galeMax:2,enabled:false});
   await loadState(false);flash('Exemplos cadastrados, inicialmente pausados.','editorMsg',true);
 });
 $('reload').onclick=()=>safe(()=>loadState(false),'editorMsg');
 $('saveTemplates').onclick=()=>safe(async()=>{const t=Object.fromEntries(types.map(k=>[k,$('template-'+k).value]));await send('/api/strategies/settings','PUT',{templates:t});await send('/api/telegram/settings','PUT',{media:collectTelegramMedia()});await loadState(false);await loadTelegram();flash('Textos e mídias salvos no D1.','templateMsg',true);},'templateMsg');
 $('simulate').onclick=()=>safe(async()=>{const values=$('demoRounds').value.split(',').map(x=>x.trim()).filter(Boolean).map(Number);if(!values.length)throw Error('Insira números separados por vírgulas');const result=await send('/api/strategies/demo','POST',{rule:validClient(editorRule()),rounds:values,templates:serverState?.settings?.templates});$('demoOutput').textContent=result.events.length?result.events.map(e=>`${e.type.toUpperCase()}: ${e.message||'Limpeza do aviso'}`).join('\n\n'):'Nenhum padrão identificado nesta sequência.';},'editorMsg');
 renderBuilder();
}
async function init(){initHandlers();await loadCatalog();try{const a=await api('/api/admin/whoami');if(a.authenticated){$('loginPanel').classList.add('hidden');$('secureApp').classList.remove('hidden');await loadState(true);await loadTelegram();await readBalls();void requestTick();}else showLogin(a.configured?'':'Painel desativado: configure ADMIN_TOKEN no Worker (mínimo 16 caracteres).');}catch(e){showLogin(e.message);}
 // A tela verifica o D1 a cada 5s; a fonte pública permanece limitada à sua frequência real.
 setInterval(()=>{if(!document.hidden&&serverState&&!busy){busy=true;Promise.allSettled([readEvents(),readBalls()]).finally(()=>busy=false);}},5000);
 setInterval(()=>{if(!document.hidden&&serverState)void requestTick();},20000);
}
await init();

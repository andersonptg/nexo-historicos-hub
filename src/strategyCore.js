// NEXO V10 - EDITOR DE PEDRAS
// NEXO V8 — Motor determinístico de monitoramento de sequências concluídas.
// Ordem: mais antigo → mais novo. Os eventos descrevem observações, não previsões.
export const COLOR={0:'white',1:'red',2:'red',3:'red',4:'red',5:'red',6:'red',7:'red',8:'black',9:'black',10:'black',11:'black',12:'black',13:'black',14:'black'};
const COLORS=new Set(['red','black','white']);
export function normalizeToken(value){
 if(!value||typeof value!=='object')throw Error('Elemento inválido');
 const kind=value.kind;
 if(kind==='color'&&COLORS.has(value.value))return {kind,value:value.value};
 if(kind==='number'&&Number.isInteger(value.value)&&value.value>=0&&value.value<=14)return {kind,value:value.value};
 throw Error('Use uma cor ou número de 0 a 14');
}
export function validateRule(value){
 if(!value||typeof value!=='object')throw Error('Estratégia inválida');
 const name=String(value.name||'Minha estratégia').trim();
 if(name.length<1||name.length>70)throw Error('O nome deve conter 1 a 70 caracteres');
 if(!Array.isArray(value.pattern)||value.pattern.length<1||value.pattern.length>500)throw Error('Sequência precisa ter entre 1 e 500 pedras');
 if(!Array.isArray(value.targets)||value.targets.length<1||value.targets.length>4)throw Error('Escolha entre 1 e 4 alvos');
 const pattern=value.pattern.map(normalizeToken),targets=value.targets.map(normalizeToken);
 if(new Set(targets.map(x=>`${x.kind}:${x.value}`)).size!==targets.length)throw Error('Alvos repetidos');
 const galeMax=Number(value.galeMax??0);
 if(!Number.isInteger(galeMax)||galeMax<0||galeMax>2)throw Error('Gale máximo é 2');
 if(typeof value.enabled!=='boolean'&&value.enabled!==undefined)throw Error('Estado inválido');
 return {name,pattern,targets,galeMax,enabled:value.enabled===true};
}
export function matches(token,round){if(!round)return false;return token.kind==='number'?Number(round.number)===token.value:(round.color||COLOR[round.number])===token.value;}
export function suffixMatches(history,tokens){if(history.length<tokens.length)return false;return tokens.every((t,i)=>matches(t,history[history.length-tokens.length+i]));}
export function evolve(input,rule,history){
 const current=history.at(-1);if(!current)return {state:input,events:[]};
 // V10: histórico incremental permite sequências maiores que a janela pública de resultados.
 const previous=Array.isArray(input?.recent)?input.recent:[];
 const recent=(previous.length?[...previous,current]:history.slice(-rule.pattern.length)).slice(-rule.pattern.length);
 const state={active:input?.active?{...input.active}:null,prealertRoundId:input?.prealertRoundId||null,recent};
 const events=[];const add=(type,step=0)=>events.push({type,step,roundId:current.id,number:current.number,color:current.color||COLOR[current.number],minute_epoch:current.minute_epoch});
 // A saída sempre é avaliada APÓS a entrada — nunca sobre a mesma pedra.
 if(state.active&&state.active.entryRoundId!==current.id){
  // WIN: a cor alvo OU a pedra branca (0) para estratégias de cor.
  const whiteWins=(current.color||COLOR[current.number])==='white'&&rule.targets.some(target=>target.kind==='color');
  if(rule.targets.some(target=>matches(target,current))||whiteWins){add('win',state.active.step);state.active=null;}
  else if(state.active.step<rule.galeMax){state.active.step++;add(`gale${state.active.step}`,state.active.step);}
  else{add('red',state.active.step);state.active=null;}
 }
 if(state.active){if(state.prealertRoundId){add('cancel_prealert');state.prealertRoundId=null;}return {state,events};}
 const full=suffixMatches(state.recent,rule.pattern);
 if(full){
  if(state.prealertRoundId){add('clear_prealert');state.prealertRoundId=null;}
  add('entry');state.active={entryRoundId:current.id,step:0};
 }else{
  const partial=rule.pattern.length>1&&suffixMatches(state.recent,rule.pattern.slice(0,-1));
  if(partial){if(!state.prealertRoundId){add('prealert');state.prealertRoundId=current.id;}}
  else if(state.prealertRoundId){add('cancel_prealert');state.prealertRoundId=null;}
 }
 return {state,events};
}
export const PRESET_MESSAGES=Object.freeze({
 prealert:'🔎 Pré-aviso de sequência\nSequência parcial: {PATTERN}\nAguardando confirmação.',
 entry:'🎯 ENTRAR NO {TARGET}\n- - - - SINAL ATÉ GALE {GALE} - - - -',
 entryRed:'🎯 ENTRAR: VERMELHO 🔴 E BRANCO ⚪\n\n- - - ATÉ {GALE} MARTINGALE - - -',
 entryBlack:'🎯 ENTRAR: PRETO ⚫ E BRANCO ⚪\n\n- - - ATÉ {GALE} MARTINGALE - - -',
 gale1:'- - - - GALE 1 - - - -',
 gale2:'- - - - GALE 2 - - - -',
 win:'✅ WIN — alvo confirmado na rodada registrada.',
 activation:'🚨 ATENÇÃO — ROBÔ ATIVADO!\n🤖 BLAZE PRO NEXO PTG 🤖',
 winWhite:'✅ WIN NO BRANCO ⚪ — acerto na pedra branca.',
 red:'❌ RED — alvo não confirmado até o limite configurado.',
 brand:'🤖 BLAZE PRO NEXO PTG 🤖'
});
const colorText={white:'BRANCO ⚪',red:'VERMELHO 🔴',black:'PRETO ⚫'};
export function tokenText(t){return t.kind==='color'?colorText[t.value]:String(t.value);}
// V11: somente o resultado WIN mostra a pedra sorteada, uma vez, abaixo do WIN.
const roundEmoji={red:'🔴',black:'⚫',white:'⚪'};
export function eventMessage(event,rule,templates=PRESET_MESSAGES){
 if(event.type==='clear_prealert'||event.type==='cancel_prealert')return '';
 const kind=event.type==='win'&&event.color==='white'?'winWhite':event.type;
 const entryColor=rule.targets.find(t=>t.kind==='color'&&(t.value==='red'||t.value==='black'))?.value;
 const colorKind=event.type==='entry'&&entryColor?(entryColor==='red'?'entryRed':'entryBlack'):null;
 const chosen=colorKind&&templates[colorKind]!==undefined?templates[colorKind]:templates[kind];
 const template=String(chosen??PRESET_MESSAGES[colorKind]??PRESET_MESSAGES[kind]??'').slice(0,1200);
 const validNumber=Number.isInteger(event.number)&&event.number>=0&&event.number<=14;
 const stone=validNumber?(roundEmoji[event.color||COLOR[event.number]]||'')+String(event.number):'';
 const targets=rule.targets.map(tokenText);
 if(rule.targets.some(t=>t.kind==='color'&&t.value!=='white')&&!rule.targets.some(t=>t.kind==='color'&&t.value==='white'))targets.push('BRANCO ⚪');
 const main=template.replaceAll('{NAME}',rule.name)
  .replaceAll('{PATTERN}',rule.pattern.map(tokenText).join(' · '))
  .replaceAll('{TARGET}',targets.join(' OU '))
  .replaceAll('{GALE}',String(rule.galeMax)).replaceAll('{STONE}','');
 const brand=event.type==='entry'&&templates.brand?`\n\n${String(templates.brand).slice(0,150)}`:'';
 return main+brand+(event.type==='win'&&stone?`\n\nPedra sorteada (${stone})`:'');
}

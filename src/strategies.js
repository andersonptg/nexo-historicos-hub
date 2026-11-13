import {authorized,sameOrigin} from './admin.js';
import {validateRule,evolve,eventMessage,PRESET_MESSAGES,COLOR} from './strategyCore.js';
import {getTelegramSettings,telegramQueueStatement,flushTelegram,telegramActivationStatement} from './telegram.js';

const JSON_HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:JSON_HEADERS});
const SMASH='historicosblaze:smash:double';
const stamp=()=>Math.floor(Date.now()/1000);
const parseJSON=x=>{try{return JSON.parse(x)}catch{return null}};
const DEFAULT_SETTINGS={automatic:false,prealert:true,entry:true,fireworks:true,templates:PRESET_MESSAGES};
const allowedTemplateKeys=new Set(Object.keys(PRESET_MESSAGES));
export async function getSettings(db){
 const row=await db.prepare('SELECT config_json FROM strategy_settings WHERE source_id=?').bind(SMASH).first();
 const stored=parseJSON(row?.config_json)||{};
 const templates={...PRESET_MESSAGES,...(stored.templates||{})};
 // Migração discreta: "ATENÇÃO" passa a ser exclusiva da ativação do robô.
 if(templates.prealert==='⚠️ Atenção, sinal identificado\nSequência parcial: {PATTERN}\nAguardando confirmação.')templates.prealert=PRESET_MESSAGES.prealert;
 // Ajusta apenas os dois textos padrão antigos. Mensagens personalizadas são preservadas.
 if(templates.gale1==='- - - - GALE 1 - - - -\nTentamos novamente na segunda rodada.')templates.gale1=PRESET_MESSAGES.gale1;
 if(templates.gale2==='- - - - GALE 2 - - - -\nÚltima tentativa configurada.')templates.gale2=PRESET_MESSAGES.gale2;
 return {...DEFAULT_SETTINGS,...stored,templates};
}
function parseRule(row){return {...validateRule({...parseJSON(row.definition),enabled:!!row.enabled}),id:row.id,createdAt:row.created_at,updatedAt:row.updated_at};}
function validSource(url){return (url.searchParams.get('platform')||'smash')==='smash'&&(url.searchParams.get('game')||'double')==='double';}
async function loadRules(db){const r=await db.prepare('SELECT * FROM strategies WHERE platform=? AND game=? ORDER BY created_at DESC,id DESC').bind('smash','double').all();return r.results.map(parseRule);}
async function loadState(db){
 const [strategies,settings,events,score]=await Promise.all([
  loadRules(db),getSettings(db),db.prepare('SELECT rowid AS seq,* FROM strategy_events WHERE source_id=? ORDER BY rowid DESC LIMIT 100').bind(SMASH).all(),
  db.prepare(`SELECT strategy_id,
    SUM(CASE WHEN event_type='entry' THEN 1 ELSE 0 END) AS entries,
    SUM(CASE WHEN event_type='win' THEN 1 ELSE 0 END) AS wins,
    SUM(CASE WHEN event_type='win' AND round_number=0 THEN 1 ELSE 0 END) AS white_wins,
    SUM(CASE WHEN event_type='red' THEN 1 ELSE 0 END) AS reds,
    SUM(CASE WHEN event_type='gale1' THEN 1 ELSE 0 END) AS gale1,
    SUM(CASE WHEN event_type='gale2' THEN 1 ELSE 0 END) AS gale2
    FROM strategy_events WHERE source_id=? GROUP BY strategy_id`).bind(SMASH).all()
 ]);
 return {platform:'smash',game:'double',precision:'minute',telegramConnected:false,settings,strategies,events:events.results,score:score.results};
}
export async function handleStrategies(request,env,url){
 // Todas as estratégias e alertas permanecem privados, inclusive as leituras.
 if(!validSource(url))return json({error:'Estratégias automatizadas disponíveis inicialmente somente para Smash Double.'},409);
 if(!await authorized(request,env))return json({error:'Entre como administrador para acessar estratégias.'},401);
 if(request.method!=='GET'&&!sameOrigin(request))return json({error:'Origem recusada'},403);
 const path=url.pathname,db=env.DB;

  // V27: diagnostico somente leitura, protegido pela sessao ADM.
  if(path==='/api/strategies/diagnostics'&&request.method==='GET'){
   const [cursor,cache,sync,runtimes,events,counts,recent]=await Promise.all([
    db.prepare('SELECT last_round_id,last_updated FROM strategy_cursors WHERE source_id=?').bind(SMASH).first(),
    db.prepare('SELECT payload,last_updated FROM snapshot_cache WHERE source_id=?').bind(SMASH).first(),
    db.prepare('SELECT last_success,last_new,last_count FROM sync_status WHERE source_id=?').bind(SMASH).first(),
    db.prepare("SELECT r.strategy_id,r.state_json,r.updated_at,s.enabled FROM strategy_runtime r JOIN strategies s ON s.id=r.strategy_id WHERE s.platform='smash' AND s.game='double'").all(),
    db.prepare('SELECT strategy_id,event_type,round_id,round_number,minute_epoch,created_at FROM strategy_events WHERE source_id=? ORDER BY rowid DESC LIMIT 100').bind(SMASH).all(),
    db.prepare("SELECT event_type,status,COUNT(*) AS total FROM telegram_outbox WHERE source_id=? AND event_type IN ('win','winWhite','red') GROUP BY event_type,status").bind(SMASH).all(),
    db.prepare("SELECT event_type,status,attempts,last_error,created_at,sent_at,telegram_message_id FROM telegram_outbox WHERE source_id=? AND event_type IN ('win','winWhite','red') ORDER BY queue_id DESC LIMIT 12").bind(SMASH).all()
   ]);
   const parsed=parseJSON(cache?.payload),rows=Array.isArray(parsed)?parsed:[];
   const cursorIndex=cursor?rows.findIndex(r=>r.round_id===cursor.last_round_id):-1;
   const log=events.results||[];
   const active=(runtimes.results||[]).flatMap(r=>{
    const a=parseJSON(r.state_json)?.active;
    if(!a)return [];
    const progress=log.filter(e=>e.strategy_id===r.strategy_id&&['entry','gale1','gale2'].includes(e.event_type));
    return [{rule_enabled:!!r.enabled,step:Number(a.step||0),updated_at:r.updated_at,
     entry_in_snapshot:rows.some(x=>x.round_id===a.entryRoundId),
     anchor_in_snapshot:progress.some(e=>rows.some(x=>x.round_id===e.round_id)),
     last_progress_at:progress[0]?.created_at??null}];
   });
   const now=stamp(),warnings=[];
   if(cursor&&cursorIndex<0)warnings.push('cursor_fora_do_snapshot');
   if(cursor&&cursorIndex>25)warnings.push('cursor_mais_de_25_rodadas_atrasado');
   if(active.some(a=>!a.anchor_in_snapshot))warnings.push('operacao_ativa_sem_ancora');
   if(cursor&&now-Number(cursor.last_updated)>180&&sync?.last_success&&now-Number(sync.last_success)<180)
    warnings.push('motor_parado_com_coleta_recente');
   return json({read_only:true,checked_at:now,warnings,
    collection:{last_success:sync?.last_success??null,last_new:sync?.last_new??null,last_count:sync?.last_count??null},
    snapshot:{size:rows.length,last_updated:cache?.last_updated??null},
    cursor:{exists:!!cursor,index:cursorIndex,last_updated:cursor?.last_updated??null,
     age_seconds:cursor?Math.max(0,now-Number(cursor.last_updated)):null},
    active_operations:active,active_count:active.length,
    recent_results:log.filter(e=>['win','red'].includes(e.event_type)).slice(0,12).map(e=>({
     type:e.event_type,stone:e.round_number,minute:e.minute_epoch,recorded:e.created_at,
     round_in_snapshot:rows.some(x=>x.round_id===e.round_id)})),
    telegram:{counts:counts.results||[],recent:(recent.results||[]).map(r=>({
     type:r.event_type,status:r.status,attempts:r.attempts,error:r.last_error,
     created:r.created_at,sent:r.sent_at,message_confirmed:!!r.telegram_message_id}))}
   });
  }

 if(path==='/api/strategies/state'&&request.method==='GET')return json(await loadState(db));
 if(path==='/api/strategies/events'&&request.method==='GET'){
  const after=Number(url.searchParams.get('after')||0);
  if(!Number.isSafeInteger(after)||after<0)return json({error:'Cursor inválido'},400);
  const result=await db.prepare('SELECT rowid AS seq,* FROM strategy_events WHERE source_id=? AND rowid>? ORDER BY rowid ASC LIMIT 60').bind(SMASH,after).all();
  return json({events:result.results});
 }
 if(path==='/api/strategies/settings'&&request.method==='PUT'){
  const data=await read(request);const old=await getSettings(db);
  for(const key of ['automatic','prealert','entry','fireworks'])if(data[key]!==undefined&&typeof data[key]!=='boolean')return json({error:`Opção ${key} inválida`},400);
  const templates={...old.templates};
  if(data.templates!==undefined){if(!data.templates||typeof data.templates!=='object'||Array.isArray(data.templates))return json({error:'Modelos inválidos'},400);
   for(const [k,v] of Object.entries(data.templates)){if(!allowedTemplateKeys.has(k)||typeof v!=='string'||v.length>1200)return json({error:'Mensagem inválida: '+k},400);templates[k]=v;}}
  const next={...old,...Object.fromEntries(['automatic','prealert','entry','fireworks'].filter(k=>k in data).map(k=>[k,data[k]])),templates};
  const writes=[db.prepare(`INSERT INTO strategy_settings(source_id,config_json,updated_at) VALUES(?,?,?)
   ON CONFLICT(source_id) DO UPDATE SET config_json=excluded.config_json,updated_at=excluded.updated_at`).bind(SMASH,JSON.stringify(next),stamp())];
  // Preserve operações em andamento quando o monitoramento for pausado.
  // Com o envio Telegram já ligado, iniciar o monitoramento gera ATENÇÃO uma única vez.
  let activated=false;
  if(!old.automatic&&next.automatic){const tg=await getTelegramSettings(db);
   if(tg.enabled){writes.push(telegramActivationStatement(db,next.templates.activation,stamp()));activated=true;}
  }
  await db.batch(writes);
  if(activated)try{await flushTelegram(env,1)}catch(error){console.warn('Ativação do Telegram não enviada nesta tentativa');}
  return json({ok:true,settings:next});
 }
 if(path==='/api/strategies'&&request.method==='POST'){
  let rule;try{rule=validateRule(await read(request));}catch(e){return json({error:e.message},400)}
  const id=crypto.randomUUID(),now=stamp();
  await db.prepare('INSERT INTO strategies(id,platform,game,definition,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(id,'smash','double',JSON.stringify(rule),rule.enabled?1:0,now,now).run();
  return json({ok:true,id},201);
 }
 const m=path.match(/^\/api\/strategies\/([0-9a-f-]{36})$/);
 if(m&&(request.method==='PUT'||request.method==='DELETE')){
  const existing=await db.prepare('SELECT * FROM strategies WHERE id=? AND platform=? AND game=?').bind(m[1],'smash','double').first();
  if(!existing)return json({error:'Estratégia não encontrada'},404);
  if(request.method==='DELETE'){
   await db.batch([db.prepare('DELETE FROM strategy_events WHERE strategy_id=?').bind(m[1]),db.prepare('DELETE FROM strategy_runtime WHERE strategy_id=?').bind(m[1]),db.prepare('DELETE FROM strategies WHERE id=?').bind(m[1])]);return json({ok:true});
  }
  let value;try{value=validateRule(await read(request));}catch(e){return json({error:e.message},400)}
  const previous=parseRule(existing),different=JSON.stringify(previous.pattern)!==JSON.stringify(value.pattern)||JSON.stringify(previous.targets)!==JSON.stringify(value.targets)||previous.galeMax!==value.galeMax;
  await db.batch([
   db.prepare('UPDATE strategies SET definition=?,enabled=?,updated_at=? WHERE id=?').bind(JSON.stringify(value),value.enabled?1:0,stamp(),m[1]),
   ...(different?[db.prepare('DELETE FROM strategy_runtime WHERE strategy_id=?').bind(m[1])]:[])
  ]);
  return json({ok:true,id:m[1]});
 }
 if(path==='/api/strategies/demo'&&request.method==='POST'){
  const body=await read(request);let rule;
  try{rule=validateRule(body.rule);}catch(e){return json({error:e.message},400)}
  if(!Array.isArray(body.rounds)||body.rounds.length>600||body.rounds.some(x=>!Number.isInteger(x)||x<0||x>14))return json({error:'Informe até 600 pedras de 0 a 14'},400);
  let state={active:null,prealertRoundId:null},history=[],events=[];
  body.rounds.forEach((number,i)=>{history.push({id:`demo-${i}`,number,color:COLOR[number],minute_epoch:0});const change=evolve(state,rule,history);state=change.state;events.push(...change.events.map(e=>({...e,message:eventMessage(e,rule,(body.templates||PRESET_MESSAGES))})));});
  return json({ok:true,events,finalState:state,notice:'Demonstração: nenhum sinal enviado e nenhuma aposta realizada.'});
 }
 return json({error:'Rota não encontrada'},404);
}
async function read(request){const n=Number(request.headers.get('content-length')||0);if(n>30000)throw Error('Requisição muito grande');return request.json();}

// Evita gerar alertas antigos após ligar o robô ou após interrupções longas.
// O cursor é persistente no D1 e todos os alertas têm ID determinístico.
export async function processSmashSnapshot(env,source,records,roundIds,now=stamp()){
 if(source.platform!=='smash'||source.game!=='double')return {skipped:true};
 const db=env.DB,cursor=await db.prepare('SELECT last_round_id FROM strategy_cursors WHERE source_id=?').bind(source.id).first();
 const newest=roundIds[0];if(!newest)return {skipped:true};
 if(!cursor){await db.prepare('INSERT OR IGNORE INTO strategy_cursors(source_id,last_round_id,last_updated) VALUES(?,?,?)').bind(source.id,newest,now).run();return {initialized:true};}
 if(cursor.last_round_id===newest)return {new:0};
 let index=roundIds.indexOf(cursor.last_round_id);
 if(index<0||index>25){
  // V17: quando o cursor some, nao descartar a operacao ativa.
  // Reconstroi somente a partir do ultimo evento da operacao persistido no D1.
  // V28: recuperacao conservadora de operacoes irrecuperaveis, sem criar WIN/RED ficticio.
  // Respeita 15 minutos para uma fonte temporariamente inconsistente se recuperar.
  const runtime=(await db.prepare("SELECT r.strategy_id,r.state_json,r.updated_at FROM strategy_runtime r JOIN strategies s ON s.id=r.strategy_id WHERE s.platform='smash' AND s.game='double'").all()).results;
  const actives=runtime.filter(row=>!!parseJSON(row.state_json)?.active);
  if(actives.length){
   const anchors=[];
   for(const active of actives){
    const progress=(await db.prepare("SELECT round_id FROM strategy_events WHERE strategy_id=? AND event_type IN ('entry','gale1','gale2') ORDER BY rowid DESC LIMIT 12").bind(active.strategy_id).all()).results;
    const candidate=progress.map(row=>roundIds.indexOf(row.round_id)).find(position=>position>=0&&position<=25);
    if(candidate!==undefined)anchors.push(candidate);
   }
   if(!anchors.length){
    if(actives.some(row=>now-Number(row.updated_at||0)<900)){
     console.warn('NEXO V28: ancora nao encontrada; aguardando janela de recuperacao');
     return {stalled:true,warning:'Operacao recente sem ancora; aguardando ate 15 minutos'};
    }
    const writes=actives.map(row=>{
     const previous=parseJSON(row.state_json)||{};
     const recovered={...previous,active:null,prealertRoundId:null,recent:[],
      interruptedAt:now,interruptedReason:'ancora_ausente_mais_15_min'};
     return db.prepare('UPDATE strategy_runtime SET state_json=?,updated_at=? WHERE strategy_id=?')
      .bind(JSON.stringify(recovered),now,row.strategy_id);
    });
    // Atualiza cursores e estados na mesma transacao. Nao apaga historicos ou eventos.
    writes.push(db.prepare('UPDATE strategy_cursors SET last_round_id=?,last_updated=? WHERE source_id=?')
     .bind(newest,now,source.id));
    await db.batch(writes);
    console.warn('NEXO V28: operacao antiga interrompida por ausencia de ancora; nenhum sinal retroativo enviado');
    return {reset:true,interrupted:true,warning:'Operacao antiga sem ancora arquivada; retomada a partir da proxima rodada'};
   }
   // Recuperar somente a janela proxima e comprovada pelo snapshot.
   index=Math.min(...anchors);
  }else{
   await db.prepare('UPDATE strategy_cursors SET last_round_id=?,last_updated=? WHERE source_id=?').bind(newest,now,source.id).run();
   return {reset:true,warning:'historico interrompido sem operacao ativa'};
  }
 }
 const settings=await getSettings(db);
 // Uma pausa impede novas entradas, mas não abandona operações já iniciadas.

 // V22: nao abandonar operacao ja iniciada se a regra for pausada durante um GALE.
 const allRules=await loadRules(db);
 const activeRows=(await db.prepare('SELECT strategy_id,state_json FROM strategy_runtime').bind().all()).results;
 const activeIds=new Set(activeRows.filter(x=>parseJSON(x.state_json)?.active).map(x=>x.strategy_id));
 const rules=allRules.filter(x=>x.enabled||activeIds.has(x.id)).filter(x=>(settings.automatic&&x.enabled)||activeIds.has(x.id));
 const stateRows=rules.length?(await db.prepare('SELECT * FROM strategy_runtime WHERE strategy_id IN ('+rules.map(()=>'?').join(',')+')').bind(...rules.map(x=>x.id)).all()).results:[];
 const states=new Map(stateRows.map(x=>[x.strategy_id,parseJSON(x.state_json)||{active:null,prealertRoundId:null}]));
 const telegram=await getTelegramSettings(db);
 const writes=[];let messages=0;
 // O dono da operacao e inferido do estado persistido em D1.
 // Nunca cria duas entradas enquanto uma estiver ativa.
 let owner=rules.find(rule=>states.get(rule.id)?.active)?.id||null;
 // A ordem e deterministica; uma estrategia escolhida bloqueia as demais.
 for(let i=index-1;i>=0;i--){
  const history=records.slice(i).reverse().map((r,j)=>({id:roundIds[roundIds.length-1-j],number:r.number,color:r.color,minute_epoch:r.minute_epoch}));
  const current=history.at(-1);
  if(!current)continue;
  const hadOwner=!!owner;
  let finished=false;
  let chosen=null;
  const perRound=[];
  for(const rule of rules){
   const previous=states.get(rule.id)||{active:null,prealertRoundId:null};
   if(owner&&rule.id!==owner){
    // Mantem a janela historica atualizada, sem gerar sinais concorrentes.
    states.set(rule.id,{active:null,prealertRoundId:null,recent:[...(previous.recent||[]),current].slice(-rule.pattern.length)});
    continue;
   }
   if(finished||chosen){
    states.set(rule.id,{active:null,prealertRoundId:null,recent:[...(previous.recent||[]),current].slice(-rule.pattern.length)});
    continue;
   }
   if((!rule.enabled||!settings.automatic)&&!previous.active){
    states.set(rule.id,{active:null,prealertRoundId:null,recent:[...(previous.recent||[]),current].slice(-rule.pattern.length)});
    continue;
   }
   const change=evolve(previous,rule,history);
   states.set(rule.id,change.state);
   if(change.events.some(e=>e.type==='win'||e.type==='red')){
    finished=true;owner=null;
   }
   if(change.events.some(e=>e.type==='entry')){
    chosen=rule.id;owner=rule.id;
   }
   for(const event of change.events)perRound.push({rule,event});
  }
  // Nao emite prealertas de concorrentes nem entradas na rodada de fechamento.
  for(const {rule,event} of perRound){
   if(hadOwner&&event.type==='entry')continue;
   if(event.type==='entry'&&rule.id!==chosen)continue;
   if(event.type==='prealert'&&(hadOwner||chosen||finished))continue;
   if(event.type==='prealert'&&!settings.prealert)continue;
   if(event.type==='entry'&&!settings.entry)continue;
   const msg=eventMessage(event,rule,settings.templates);
   const eventId=`${rule.id}:${event.roundId}:${event.type}`;
   writes.push(db.prepare(`INSERT OR IGNORE INTO strategy_events(id,source_id,strategy_id,event_type,round_id,step,message,round_number,minute_epoch,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(eventId,source.id,rule.id,event.type,event.roundId,event.step,msg,event.number,event.minute_epoch,now));
   const outgoing=telegramQueueStatement(db,{eventId,sourceId:source.id,strategyId:rule.id,event,body:msg,now,config:telegram});
   if(outgoing)writes.push(outgoing);
   messages++;
  }
  // Uma operacao que terminou so permite uma nova entrada na proxima rodada.
  if(finished)owner=null;
 }
 for(const rule of rules)writes.push(db.prepare(`INSERT INTO strategy_runtime(strategy_id,state_json,updated_at) VALUES(?,?,?)
  ON CONFLICT(strategy_id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at`).bind(rule.id,JSON.stringify(states.get(rule.id)),now));
 writes.push(db.prepare('UPDATE strategy_cursors SET last_round_id=?,last_updated=? WHERE source_id=?').bind(newest,now,source.id));
 // D1 batches are transactional: no partial strategy outcome is committed.
 await db.batch(writes);
 // Entrega apos persistencia para impedir envio antes de salvar o evento.
 // Falhas do Telegram nao devem quebrar a coleta da fonte publica.
 try{await flushTelegram(env,6);}catch(error){console.warn('Falha no despachante Telegram',String(error?.message||error).slice(0,80));}
 return {new:index,events:messages};
}

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
 const [strategies,settings,events]=await Promise.all([
  loadRules(db),getSettings(db),db.prepare('SELECT rowid AS seq,* FROM strategy_events WHERE source_id=? ORDER BY rowid DESC LIMIT 100').bind(SMASH).all()
 ]);
 return {platform:'smash',game:'double',precision:'minute',telegramConnected:false,settings,strategies,events:events.results};
}
export async function handleStrategies(request,env,url){
 // Todas as estratégias e alertas permanecem privados, inclusive as leituras.
 if(!validSource(url))return json({error:'Estratégias automatizadas disponíveis inicialmente somente para Smash Double.'},409);
 if(!await authorized(request,env))return json({error:'Entre como administrador para acessar estratégias.'},401);
 if(request.method!=='GET'&&!sameOrigin(request))return json({error:'Origem recusada'},403);
 const path=url.pathname,db=env.DB;
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
  if(old.automatic&&!next.automatic)writes.push(db.prepare("DELETE FROM strategy_runtime WHERE strategy_id IN (SELECT id FROM strategies WHERE platform='smash' AND game='double')"));
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
  const previous=parseRule(existing),different=JSON.stringify(previous.pattern)!==JSON.stringify(value.pattern)||JSON.stringify(previous.targets)!==JSON.stringify(value.targets)||previous.galeMax!==value.galeMax||previous.enabled!==value.enabled;
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
 const index=roundIds.indexOf(cursor.last_round_id);
 if(index<0||index>25){await db.batch([db.prepare("DELETE FROM strategy_runtime WHERE strategy_id IN (SELECT id FROM strategies WHERE platform='smash' AND game='double')"),db.prepare('UPDATE strategy_cursors SET last_round_id=?,last_updated=? WHERE source_id=?').bind(newest,now,source.id)]);return {reset:true};}
 const settings=await getSettings(db);
 if(!settings.automatic){await db.prepare('UPDATE strategy_cursors SET last_round_id=?,last_updated=? WHERE source_id=?').bind(newest,now,source.id).run();return {paused:true,new:index};}
 const rules=(await loadRules(db)).filter(x=>x.enabled);
 const stateRows=rules.length?(await db.prepare('SELECT * FROM strategy_runtime WHERE strategy_id IN ('+rules.map(()=>'?').join(',')+')').bind(...rules.map(x=>x.id)).all()).results:[];
 const states=new Map(stateRows.map(x=>[x.strategy_id,parseJSON(x.state_json)||{active:null,prealertRoundId:null}]));
 const telegram=await getTelegramSettings(db);
 const writes=[];let messages=0;
 for(let i=index-1;i>=0;i--){
  const history=records.slice(i).reverse().map((r,j)=>({id:roundIds[roundIds.length-1-j],number:r.number,color:r.color,minute_epoch:r.minute_epoch}));
  for(const rule of rules){
   const change=evolve(states.get(rule.id)||{active:null,prealertRoundId:null},rule,history);states.set(rule.id,change.state);
   for(const event of change.events){
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
  }
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

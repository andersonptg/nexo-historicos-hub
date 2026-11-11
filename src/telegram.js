// NEXO V9 — Telegram Bot API: envio SOMENTE pelo Worker (token nunca vai ao navegador).
// Sinais descrevem resultados observados. Não existe previsão confiável ou aposta automática.
import {authorized,sameOrigin} from './admin.js';
const SOURCE='historicosblaze:smash:double';
const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:HEADERS});
const stamp=()=>Math.floor(Date.now()/1000);
const FIELDS=['enabled','prealert','entry','gale1','gale2','win','red','deletePrealert'];
export const TELEGRAM_DEFAULT=Object.freeze({enabled:false,prealert:true,entry:true,gale1:true,gale2:true,win:true,red:true,deletePrealert:true});
const allowedChat=id=>/^-?\d{5,20}$/.test(id)||/^@[a-zA-Z0-9_]{5,32}$/.test(id);
export function telegramConfigured(env){return typeof env.TELEGRAM_BOT_TOKEN==='string' && /^\d{5,15}:[a-zA-Z0-9_-]{25,}$/.test(env.TELEGRAM_BOT_TOKEN) && typeof env.TELEGRAM_CHAT_ID==='string'&&allowedChat(env.TELEGRAM_CHAT_ID.trim());}
export async function getTelegramSettings(db){
 const row=await db.prepare('SELECT settings_json FROM telegram_settings WHERE source_id=?').bind(SOURCE).first();
 let value={};try{value=JSON.parse(row?.settings_json||'{}')}catch{}
 return Object.fromEntries(FIELDS.map(k=>[k,typeof value[k]==='boolean'?value[k]:TELEGRAM_DEFAULT[k]]));
}
// Somente entradas novas, capturadas durante a coleta e com horário recente, entram na fila.
// O ID do evento e unico: um mesmo resultado nao cria dois envios.
export function telegramQueueStatement(db,{eventId,sourceId,strategyId,event,body,now,config}){
 if(!config?.enabled||!config[event.type] && !(['clear_prealert','cancel_prealert'].includes(event.type)&&config.deletePrealert))return null;
 if(!['prealert','entry','gale1','gale2','win','red','clear_prealert','cancel_prealert'].includes(event.type))return null;
 // A fonte publica possui apenas PRECISAO DE MINUTO. Nunca publicar um alerta antigo como se fosse ao vivo.
 if(!Number.isFinite(event.minute_epoch)||Math.abs(now-event.minute_epoch)>180)return null;
 const action=(event.type==='clear_prealert'||event.type==='cancel_prealert')?'delete':'send';
 if(action==='send'&&(!body||!body.trim()))return null;
 return db.prepare(`INSERT OR IGNORE INTO telegram_outbox(event_id,source_id,strategy_id,event_type,action,message,status,created_at,next_attempt)
   VALUES(?,?,?,?,?,?, 'pending',?,?)`).bind(eventId,sourceId,strategyId,event.type,action,body||'',now,now);
}
async function botCall(env,method,payload){
 const response=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(11000)
 });
 if(!response.ok)throw new Error(`Telegram HTTP ${response.status}`);
 const data=await response.json();
 if(!data.ok)throw new Error('Telegram recusou a operação');
 return data.result;
}
const capped=(message)=>String(message||'').slice(0,3900);
export async function sendTelegramTest(env){
 if(!telegramConfigured(env))throw Error('Configure TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID como secrets');
 const result=await botCall(env,'sendMessage',{chat_id:env.TELEGRAM_CHAT_ID,text:'🤖 NEXO HISTÓRICOS PTG\n✅ Teste de conexão com o Telegram concluído.\nEste teste não altera o estado de envio automático do painel.',disable_notification:false,link_preview_options:{is_disabled:true}});
 return {ok:true,messageId:result?.message_id??null};
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function dispatchOne(env,row,now){
 const db=env.DB,claim=await db.prepare(`UPDATE telegram_outbox SET status='sending',attempts=attempts+1,next_attempt=?
  WHERE queue_id=? AND ((status IN ('pending','retry') AND next_attempt<=?) OR (status='sending' AND next_attempt<=?))`).bind(now+100, row.queue_id,now,now).run();
 if(Number(claim.meta?.changes||0)!==1)return false;
 try{
  if(row.action==='delete'){
   const old=await db.prepare('SELECT message_id FROM telegram_prealerts WHERE strategy_id=?').bind(row.strategy_id).first();
   if(old?.message_id){
    try{await botCall(env,'deleteMessage',{chat_id:env.TELEGRAM_CHAT_ID,message_id:old.message_id});}
    catch(error){
      // Um aviso ja removido nao deve bloquear a entrada seguinte.
      if(String(error?.message||'')!=='Telegram HTTP 400')throw error;
    }
    await db.prepare('DELETE FROM telegram_prealerts WHERE strategy_id=?').bind(row.strategy_id).run();
   }
   await db.prepare("UPDATE telegram_outbox SET status='sent',last_error=NULL,sent_at=? WHERE queue_id=?").bind(stamp(),row.queue_id).run();
  }else{
   const result=await botCall(env,'sendMessage',{chat_id:env.TELEGRAM_CHAT_ID,text:capped(row.message),link_preview_options:{is_disabled:true}});
   const messageId=Number(result?.message_id||0);
   if(!messageId)throw Error('Telegram não retornou identificador da mensagem');
   const writes=[db.prepare("UPDATE telegram_outbox SET status='sent',last_error=NULL,sent_at=?,telegram_message_id=? WHERE queue_id=?").bind(stamp(),messageId,row.queue_id)];
   if(row.event_type==='prealert')writes.push(db.prepare(`INSERT INTO telegram_prealerts(strategy_id,message_id,event_id,updated_at) VALUES(?,?,?,?)
     ON CONFLICT(strategy_id) DO UPDATE SET message_id=excluded.message_id,event_id=excluded.event_id,updated_at=excluded.updated_at`).bind(row.strategy_id,messageId,row.event_id,stamp()));
   await db.batch(writes);
  }
 }catch(error){
  // Nao gravar URL/headers/token nos logs.
  const reason=(String(error?.message||'').match(/Telegram HTTP \d{3}/)||[])[0]||'Falha na comunicação com Telegram';
  const n=Number(row.attempts||0)+1;
  const status=n>=5?'failed':'retry';
  const delay=Math.min(300,15*2**Math.min(n,4));
  await db.prepare('UPDATE telegram_outbox SET status=?,next_attempt=?,last_error=? WHERE queue_id=?').bind(status,stamp()+delay,reason,row.queue_id).run();
 }
 return true;
}
// Idempotente na fila e com lease por linha. Se o Telegram confirmar mas o banco
// falhar depois, uma repeticao rara e possivel — a API nao oferece chave de idempotencia.
export async function flushTelegram(env,max=4){
 if(!telegramConfigured(env))return {skipped:'credentials'};
 const settings=await getTelegramSettings(env.DB);
 const status=await env.DB.prepare('SELECT config_json FROM strategy_settings WHERE source_id=?').bind(SOURCE).first();
 let automatic=false;try{automatic=JSON.parse(status?.config_json||'{}').automatic===true}catch{}
 if(!settings.enabled||!automatic)return {skipped:'disabled'};
 let processed=0;
 for(let i=0;i<max;i++){
  const now=stamp();
  // Pedras antigas nao podem gerar mensagem nova fora de contexto.
  await env.DB.prepare(`UPDATE telegram_outbox SET status='expired',last_error='Evento antigo' WHERE status IN ('pending','retry','sending') AND created_at<?`).bind(now-180).run();
  // Ordem rigorosa: nunca enviar entrada antes do pre-aviso pendente em nova tentativa.
  const row=await env.DB.prepare(`SELECT * FROM telegram_outbox WHERE status IN ('pending','retry','sending') ORDER BY queue_id LIMIT 1`).bind().first();
  if(!row||Number(row.next_attempt)>now)break;
  if(await dispatchOne(env,row,now))processed++;else break;
  if(i+1<max)await wait(1050); // Evita excesso de mensagens por segundo no mesmo chat.
 }
 return {processed};
}
export async function handleTelegram(request,env,url){
 if(!await authorized(request,env))return json({error:'Sessão administrativa necessária'},401);
 if(request.method!=='GET'&&!sameOrigin(request))return json({error:'Origem recusada'},403);
 const path=url.pathname,db=env.DB;
 if(path==='/api/telegram/status'&&request.method==='GET'){
  const settings=await getTelegramSettings(db);
  const counts=await db.prepare(`SELECT status,COUNT(*) AS n FROM telegram_outbox GROUP BY status`).all();
  const recent=await db.prepare(`SELECT event_type,status,last_error,created_at,sent_at FROM telegram_outbox ORDER BY queue_id DESC LIMIT 12`).all();
  return json({configured:telegramConfigured(env),chatConfigured:!!(env.TELEGRAM_CHAT_ID&&allowedChat(env.TELEGRAM_CHAT_ID.trim())),settings,counts:counts.results,recent:recent.results});
 }
 if(path==='/api/telegram/settings'&&request.method==='PUT'){
  let body;try{body=await request.json()}catch{return json({error:'JSON inválido'},400)}
  const previous=await getTelegramSettings(db),next={...previous};
  for(const [k,v] of Object.entries(body||{})){
   if(!FIELDS.includes(k)||typeof v!=='boolean')return json({error:'Configuração inválida: '+k},400);
   next[k]=v;
  }
  if(next.enabled&&!telegramConfigured(env))return json({error:'Configure os dois segredos do Telegram no Worker antes de ativar.'},409);
  await db.prepare(`INSERT INTO telegram_settings(source_id,settings_json,updated_at) VALUES(?,?,?) ON CONFLICT(source_id)
  DO UPDATE SET settings_json=excluded.settings_json,updated_at=excluded.updated_at`).bind(SOURCE,JSON.stringify(next),stamp()).run();
  return json({ok:true,settings:next});
 }
 if(path==='/api/telegram/test'&&request.method==='POST'){
  try{return json(await sendTelegramTest(env));}
  catch(error){const msg=String(error?.message||'');return json({error:msg.startsWith('Configure')?msg:((msg.match(/Telegram HTTP \d{3}/)||[])[0]||'Não foi possível enviar o teste. Confira permissões do bot e chat ID.')},502);}
 }
 if(path==='/api/telegram/flush'&&request.method==='POST')return json(await flushTelegram(env,3));
 return json({error:'Rota Telegram não encontrada'},404);
}

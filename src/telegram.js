// NEXO_V18_MARKER: cancelar ATENCAO e preview da galeria
// NEXO V9 — Telegram Bot API: envio SOMENTE pelo Worker (token nunca vai ao navegador).
// Sinais descrevem resultados observados. Não existe previsão confiável ou aposta automática.
import {authorized,sameOrigin} from './admin.js';
const SOURCE='historicosblaze:smash:double';
const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:HEADERS});
const stamp=()=>Math.floor(Date.now()/1000);
const FIELDS=['enabled','prealert','entry','gale1','gale2','win','red','deletePrealert','deleteGale','textWithSticker'];
const MEDIA_EVENTS=['activation','prealert','entry','gale1','gale2','win','winWhite','red'];
const SOURCE_ACTIVATION='__telegram_activation__';
const MEDIA_NONE={type:'none',fileId:''};
// Identificadores públicos de stickers — NUNCA são o token secreto do bot.
// São valores iniciais: o administrador pode editá-los e salvá-los no D1.
const STICKER_IDS=Object.freeze({
 activation:'CAACAgEAAxkBAAICVmr1K8RaEGSxAq0TfrnPaGAtO8hzAAIpAgACjCtARpue2z8FxcA3PQQ',
 prealert:'CAACAgEAAxkBAAICVmr1K8RaEGSxAq0TfrnPaGAtO8hzAAIpAgACjCtARpue2z8FxcA3PQQ',
 win:'CAACAgEAAxkBAAIBqWr1AAFNPJ3udWd9HnL1rEAhtMIXlQACPAIAAjH3mUfEHBvqNt4HmT0E',
 winWhite:'CAACAgEAAxkBAAICTGr1KoR_USQZ8Mo2K-SToAUtRmMfAAKgAgACob6YR74uGfmwcRryPQQ',
 red:'CAACAgEAAxkBAAICS2r1Kihglk4x4KMF_1QMqshIh8RbAAIXAgACeDWRR0B2J3UhK58rPQQ'
});
const defaultMedia=event=>STICKER_IDS[event]?{type:'sticker',fileId:STICKER_IDS[event]}:{...MEDIA_NONE};
const validFileId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{10,512}$/.test(id);
function normalizeMedia(value){
 if(!value||typeof value!=='object'||!['none','animation','sticker'].includes(value.type))throw Error('Tipo de mídia inválido');
 if(value.type==='none')return {...MEDIA_NONE};
 if(!validFileId(value.fileId))throw Error('FILE_ID inválido. Encaminhe uma mídia ao bot e escolha Puxar do Telegram.');
 return {type:value.type,fileId:value.fileId};
}
const configuredMedia=value=>Object.fromEntries(MEDIA_EVENTS.map(k=>[k,(()=>{try{return normalizeMedia(value?.[k]||defaultMedia(k))}catch{return defaultMedia(k)}})()]));
export const TELEGRAM_DEFAULT=Object.freeze({enabled:false,prealert:true,entry:true,gale1:true,gale2:true,win:true,red:true,deletePrealert:true,deleteGale:false,textWithSticker:false});
const allowedChat=id=>/^-?\d{5,20}$/.test(id)||/^@[a-zA-Z0-9_]{5,32}$/.test(id);
export function telegramConfigured(env){return typeof env.TELEGRAM_BOT_TOKEN==='string' && /^\d{5,15}:[a-zA-Z0-9_-]{25,}$/.test(env.TELEGRAM_BOT_TOKEN) && typeof env.TELEGRAM_CHAT_ID==='string'&&allowedChat(env.TELEGRAM_CHAT_ID.trim());}
export async function getTelegramSettings(db){
 const row=await db.prepare('SELECT settings_json FROM telegram_settings WHERE source_id=?').bind(SOURCE).first();
 let value={};try{value=JSON.parse(row?.settings_json||'{}')}catch{}
 const media=configuredMedia(value.media);
 // Migração V14: configuração antiga de ativação herdava o sticker WIN.
 // Apenas a associação antiga conhecida é corrigida; mídia personalizada é preservada.
 if(media.activation.type==='sticker'&&media.activation.fileId===STICKER_IDS.win)
  media.activation={...media.prealert};
 return {...Object.fromEntries(FIELDS.map(k=>[k,typeof value[k]==='boolean'?value[k]:TELEGRAM_DEFAULT[k]])),media};
}
// Somente entradas novas, capturadas durante a coleta e com horário recente, entram na fila.
// O ID do evento e unico: um mesmo resultado nao cria dois envios.
export function telegramQueueStatement(db,{eventId,sourceId,strategyId,event,body,now,config}){
 if(!config?.enabled)return null;
 // O pré-aviso deve desaparecer DEPOIS que a entrada foi realmente enviada.
 // O evento legado clear_prealert permanece no diário, mas não gera exclusão antecipada.
 if(event.type==='clear_prealert')return null;
 if(event.type==='cancel_prealert'){
  if(!config.deletePrealert)return null;
 }else if(!['prealert','entry','gale1','gale2','win','red'].includes(event.type)||!config[event.type])return null;
 // A fonte pública possui apenas precisão de minuto; eventos antigos não viram alertas novos.
 if(!Number.isFinite(event.minute_epoch)||Math.abs(now-event.minute_epoch)>180)return null;
 const action=event.type==='cancel_prealert'?'delete':'send';
 const outType=event.type==='win'&&(event.color==='white'||event.number===0)?'winWhite':event.type;
 if(action==='send'&&(!body||!body.trim()))return null;
 if(event.type==='win'){
  // Deduplicar apenas a notificacao: o diario individual continua completo.
  // roundId e compartilhado por todas as estrategias na mesma rodada.
  const roundId=event.roundId;
  return db.prepare(`INSERT OR IGNORE INTO telegram_outbox(event_id,source_id,strategy_id,event_type,action,message,status,created_at,next_attempt)
    SELECT ?,?,?,?,?,?,'pending',?,?
    WHERE NOT EXISTS (
      SELECT 1 FROM telegram_outbox
      WHERE source_id=? AND action='send' AND event_type IN ('win','winWhite')
      AND event_id LIKE ?
    )`).bind(eventId,sourceId,strategyId,outType,action,body||'',now,now,sourceId,'%:'+roundId+':win');
 }
 return db.prepare(`INSERT OR IGNORE INTO telegram_outbox(event_id,source_id,strategy_id,event_type,action,message,status,created_at,next_attempt)
   VALUES(?,?,?,?,?,?, 'pending',?,?)`).bind(eventId,sourceId,strategyId,outType,action,body||'',now,now);
}
async function botCall(env,method,payload){
 const response=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(11000)
 });
 let data;try{data=await response.json()}catch{throw new Error(`Telegram HTTP ${response.status}`)}
 if(!response.ok||!data?.ok){
  // Distingue mensagem já apagada de falta de permissão para excluir.
  if(method==='deleteMessage'&&/message to delete not found/i.test(String(data?.description||'')))throw Error('Telegram DELETE_NOT_FOUND');
  throw Error(`Telegram HTTP ${Number(data?.error_code||response.status)}`);
 }
 return data.result;
}
// Ativação única no momento em que monitoramento E envio ficam ligados.
export function telegramActivationStatement(db,template,now){
 const text=String(template||'🚨 ATENÇÃO — ROBÔ ATIVADO!\n🤖 BLAZE PRO NEXO PTG 🤖').slice(0,1500);
 return db.prepare(`INSERT OR IGNORE INTO telegram_outbox(event_id,source_id,strategy_id,event_type,action,message,status,created_at,next_attempt)
  VALUES(?,?,?,'activation','send',?,'pending',?,?)`).bind('activation:'+crypto.randomUUID(),SOURCE,SOURCE_ACTIVATION,text,now,now);
}
const capped=(message)=>String(message||'').slice(0,3900);
export async function sendTelegramTest(env){
 if(!telegramConfigured(env))throw Error('Configure TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID como secrets');
 const result=await botCall(env,'sendMessage',{chat_id:env.TELEGRAM_CHAT_ID,text:'🤖 NEXO HISTÓRICOS PTG\n✅ Teste de conexão com o Telegram concluído.\nEste teste não altera o estado de envio automático do painel.',disable_notification:false,link_preview_options:{is_disabled:true}});
 return {ok:true,messageId:result?.message_id??null};
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// A pedra aparece em UMA mensagem própria após o sticker WIN (inclusive WIN BRANCO).
// Não reaproveitar todo o texto do template para não enviar "WIN" duas vezes.
export function splitResultText(eventType,message){
 const original=capped(message);
 if(eventType!=='win'&&eventType!=='winWhite')return {main:original,stone:''};
 const match=original.match(/(?:^|\n)Pedra sorteada \(([⚪🔴⚫]\d{1,2})\)\s*$/u);
 if(!match)return {main:original,stone:''};
 return {main:original.slice(0,match.index).trimEnd(),stone:'Pedra sorteada ('+match[1]+')'};
}
async function deleteOldPrealert(env,strategyId){
 const old=await env.DB.prepare('SELECT message_id FROM telegram_prealerts WHERE strategy_id=?').bind(strategyId).first();
 if(!old?.message_id)return;
 try{await botCall(env,'deleteMessage',{chat_id:env.TELEGRAM_CHAT_ID,message_id:Number(old.message_id)});}
 catch(error){
  // 400 pode significar aviso já removido ou fora do prazo; não excluir outros sinais.
  if(String(error?.message||'')!=='Telegram DELETE_NOT_FOUND')throw error;
 }
 await env.DB.prepare('DELETE FROM telegram_prealerts WHERE strategy_id=? AND message_id=?').bind(strategyId,old.message_id).run();
}
function deletionStatement(db,row,kind,messageId,now){
 return db.prepare(`INSERT OR IGNORE INTO telegram_outbox(event_id,source_id,strategy_id,event_type,action,message,status,created_at,next_attempt)
   VALUES(?,?,?,?,? ,?,'pending',?,?)`).bind(`${kind}:${row.event_id}:${messageId}`,row.source_id,row.strategy_id,kind,'delete',String(messageId),now,now);
}
async function dispatchOne(env,row,now){
 const db=env.DB,claim=await db.prepare(`UPDATE telegram_outbox SET status='sending',attempts=attempts+1,next_attempt=?
  WHERE queue_id=? AND ((status IN ('pending','retry') AND next_attempt<=?) OR (status='sending' AND next_attempt<=?))`).bind(now+100,row.queue_id,now,now).run();
 if(Number(claim.meta?.changes||0)!==1)return false;
 try{
  if(row.action==='delete'){
   if(row.event_type==='clear_prealert'){
    // Limpeza antiga, criada antes da V12: não apagar antes da entrada.
   }else if(row.event_type==='delete_gale'||row.event_type==='delete_prealert'){
    const messageId=Number(row.message);
    if(Number.isSafeInteger(messageId)&&messageId>0){
     try{await botCall(env,'deleteMessage',{chat_id:env.TELEGRAM_CHAT_ID,message_id:messageId});}
     catch(error){if(String(error?.message||'')!=='Telegram DELETE_NOT_FOUND')throw error;}
     if(row.event_type==='delete_prealert')await db.prepare('DELETE FROM telegram_prealerts WHERE strategy_id=? AND message_id=?').bind(row.strategy_id,messageId).run();
    }
   }else{
    // Se o padrao falhou, invalide todos os avisos antigos nao enviados.
    if(row.event_type==='cancel_prealert'){
     await db.prepare(`UPDATE telegram_outbox SET status='expired',last_error='Padrao nao confirmou'
      WHERE strategy_id=? AND event_type='prealert' AND action='send'
      AND queue_id<? AND status IN ('pending','retry')`)
      .bind(row.strategy_id,row.queue_id).run();
    }
    await deleteOldPrealert(env,row.strategy_id);
   }
   await db.prepare("UPDATE telegram_outbox SET status='sent',last_error=NULL,sent_at=? WHERE queue_id=?").bind(stamp(),row.queue_id).run();
  }else{
   const settings=await getTelegramSettings(db);
   const media=settings.media[row.event_type]||MEDIA_NONE;
   const {main,stone}=splitResultText(row.event_type,row.message);
   const text=capped(row.message);
   let messageId=Number(row.telegram_message_id||0);
   if(media.type==='animation'){
    if(!messageId){
     const captionText=stone?main:text;
     const caption=captionText.length>1024?(captionText.slice(0,880)+'\n…\n'+captionText.slice(-130)):captionText;
     const result=await botCall(env,'sendAnimation',{chat_id:env.TELEGRAM_CHAT_ID,animation:media.fileId,...(caption?{caption}:{})});
     messageId=Number(result?.message_id||0);
     if(!messageId)throw Error('Telegram não confirmou o GIF');
     await db.prepare('UPDATE telegram_outbox SET telegram_message_id=? WHERE queue_id=?').bind(messageId,row.queue_id).run();
    }
    if(stone)await botCall(env,'sendMessage',{chat_id:env.TELEGRAM_CHAT_ID,text:stone,link_preview_options:{is_disabled:true}});
   }else if(media.type==='sticker'){
    if(!messageId){
     const result=await botCall(env,'sendSticker',{chat_id:env.TELEGRAM_CHAT_ID,sticker:media.fileId});
     messageId=Number(result?.message_id||0);
     if(!messageId)throw Error('Telegram não confirmou a figurinha');
     // Salvar o ID antes de qualquer mensagem adicional protege a figurinha de reenvio.
     await db.prepare('UPDATE telegram_outbox SET telegram_message_id=? WHERE queue_id=?').bind(messageId,row.queue_id).run();
    }
    if(settings.textWithSticker&&main)await botCall(env,'sendMessage',{chat_id:env.TELEGRAM_CHAT_ID,text:main,link_preview_options:{is_disabled:true}});
    if(stone)await botCall(env,'sendMessage',{chat_id:env.TELEGRAM_CHAT_ID,text:stone,link_preview_options:{is_disabled:true}});
   }else{
    if(!messageId){
     const result=await botCall(env,'sendMessage',{chat_id:env.TELEGRAM_CHAT_ID,text:stone?main:text,link_preview_options:{is_disabled:true}});
     messageId=Number(result?.message_id||0);
     if(!messageId)throw Error('Telegram não confirmou a mensagem');
     await db.prepare('UPDATE telegram_outbox SET telegram_message_id=? WHERE queue_id=?').bind(messageId,row.queue_id).run();
    }
    if(stone)await botCall(env,'sendMessage',{chat_id:env.TELEGRAM_CHAT_ID,text:stone,link_preview_options:{is_disabled:true}});
   }
   if(!messageId)throw Error('Telegram não retornou identificador da mensagem');
   const writes=[db.prepare("UPDATE telegram_outbox SET status='sent',last_error=NULL,sent_at=?,telegram_message_id=? WHERE queue_id=?").bind(stamp(),messageId,row.queue_id)];
   if(row.event_type==='prealert')writes.push(db.prepare(`INSERT INTO telegram_prealerts(strategy_id,message_id,event_id,updated_at) VALUES(?,?,?,?)
     ON CONFLICT(strategy_id) DO UPDATE SET message_id=excluded.message_id,event_id=excluded.event_id,updated_at=excluded.updated_at`).bind(row.strategy_id,messageId,row.event_id,stamp()));
   // Opcionais: excluir somente GALE 1/2 da MESMA entrada, nunca o sinal ou resultado.
   if(settings.deleteGale&&['win','winWhite','red'].includes(row.event_type)){
    const gales=(await db.prepare(`SELECT queue_id,telegram_message_id FROM telegram_outbox
     WHERE strategy_id=? AND action='send' AND event_type IN ('gale1','gale2') AND status='sent'
     AND queue_id>COALESCE((SELECT MAX(queue_id) FROM telegram_outbox WHERE strategy_id=? AND event_type='entry' AND queue_id<?),0)
     AND queue_id<? ORDER BY queue_id`).bind(row.strategy_id,row.strategy_id,row.queue_id,row.queue_id).all()).results;
    for(const gale of gales)if(Number(gale.telegram_message_id)>0)writes.push(deletionStatement(db,row,'delete_gale',gale.telegram_message_id,stamp()));
   }
   await db.batch(writes);
   // A entrada está confirmada e preservada. Somente agora remover a atenção.
   if(row.event_type==='entry'&&settings.deletePrealert){
    try{await deleteOldPrealert(env,row.strategy_id);}
    catch{
     // A exclusão tem retry independente, sem reenviar a entrada.
     const old=await db.prepare('SELECT message_id FROM telegram_prealerts WHERE strategy_id=?').bind(row.strategy_id).first();
     if(old?.message_id)try{await deletionStatement(db,row,'delete_prealert',old.message_id,stamp()).run();}catch{console.warn('Limpeza de atenção pendente para próxima coleta');}
    }
   }
  }
 }catch(error){
  // Nunca gravar segredo, URL ou corpo do Telegram no banco/logs.
  const reason=(String(error?.message||'').match(/Telegram HTTP \d{3}/)||[])[0]||'Falha na comunicação com Telegram';
  const n=Number(row.attempts||0)+1,status=n>=5?'failed':'retry';
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
 if(!settings.enabled)return {skipped:'disabled'};
 let processed=0;
 for(let i=0;i<max;i++){
  const now=stamp();
  // Pedras antigas nao podem gerar mensagem nova fora de contexto.
  await env.DB.prepare(`UPDATE telegram_outbox SET status='expired',last_error='Evento antigo' WHERE status IN ('pending','retry','sending') AND action='send' AND created_at<?`).bind(now-180).run();
  // Ordem rigorosa: nunca enviar entrada antes do pre-aviso pendente em nova tentativa.
  const row=await env.DB.prepare(`SELECT * FROM telegram_outbox WHERE status IN ('pending','retry','sending') AND next_attempt<=? ${automatic?'':"AND event_type='activation'"} ORDER BY CASE WHEN event_type IN ('delete_prealert','delete_gale') THEN 0 WHEN event_type='activation' THEN 1 ELSE 2 END,queue_id LIMIT 1`).bind(now).first();
  if(!row)break;
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
  // Proxy autenticado de miniaturas. Jamais envia o token ao navegador.
 if(path==='/api/telegram/media/preview'&&request.method==='GET'){
   if(!telegramConfigured(env))return json({error:'Bot nao configurado'},409);
   const id=url.searchParams.get('file_id')||'';
   if(!validFileId(id))return json({error:'FILE_ID invalido'},400);
   try{
    const file=await botCall(env,'getFile',{file_id:id});
    const name=String(file?.file_path||'');
    if(!/^[a-zA-Z0-9_./-]{1,256}$/.test(name)||name.includes('..')||!/\.(?:png|jpe?g|webp)$/i.test(name))
     return json({error:'Miniatura nao disponivel'},415);
    if(Number(file.file_size||0)>1024*1024)return json({error:'Arquivo muito grande'},413);
    const r=await fetch('https://api.telegram.org/file/bot'+env.TELEGRAM_BOT_TOKEN+'/'+name,{signal:AbortSignal.timeout(10000)});
    if(!r.ok)return json({error:'Falha na miniatura'},502);
    const buf=await r.arrayBuffer();
    if(buf.byteLength>1024*1024)return json({error:'Arquivo muito grande'},413);
    const ext=name.split('.').pop().toLowerCase();
    return new Response(buf,{headers:{'Content-Type':ext==='webp'?'image/webp':ext==='png'?'image/png':'image/jpeg',
      'Cache-Control':'private, max-age=300','X-Content-Type-Options':'nosniff'}});
   }catch{return json({error:'Imagem indisponivel'},502)}
  }
 if(path==='/api/telegram/media'&&request.method==='GET'){
  if(!telegramConfigured(env))return json({error:'Configure o bot e chat ID primeiro.'},409);
  try{
   // getUpdates sem offset não confirma nem remove as mensagens de entrada.
   // Mostramos SOMENTE mídias encaminhadas ao chat configurado, nunca outras conversas.
   const updates=await botCall(env,'getUpdates',{limit:100,timeout:0,allowed_updates:['message','channel_post']});
   const list=[];const known=new Set();
   for(const item of [...updates].reverse()){
    const msg=item.message||item.channel_post;if(!msg||!(msg.chat?.type==='private'||String(msg.chat?.id)===String(env.TELEGRAM_CHAT_ID)))continue;
    const media=msg.animation||msg.sticker;if(!media||!validFileId(media.file_id)||known.has(media.file_id))continue;
    const type=msg.animation?'animation':'sticker';
    known.add(media.file_id);list.push({type,fileId:media.file_id,previewFileId:(media.thumbnail?.file_id||media.thumb?.file_id||media.file_id),label:(type==='animation'?'GIF':'Sticker')+' · '+new Date((msg.date||stamp())*1000).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}),id:msg.message_id});
    if(list.length>=30)break;
   }
   return json({items:list,notice:list.length?'Escolha a mídia recebida no privado do bot ou no chat configurado.':'Encaminhe as mídias para o bot e atualize. O Telegram mantém updates até 24 horas.'});
  }catch(error){const msg=String(error?.message||'');return json({error:msg.includes('409')?'Webhook ou outra leitura ativa no bot: getUpdates indisponível. Cole o FILE_ID manualmente.':'Não foi possível consultar as mídias recebidas pelo bot.'},502);}
 }
 if(path==='/api/telegram/settings'&&request.method==='PUT'){
  let body;try{body=await request.json()}catch{return json({error:'JSON inválido'},400)}
  const previous=await getTelegramSettings(db),next={...previous};
  for(const [k,v] of Object.entries(body||{})){
   if(k==='media'){
    if(!v||typeof v!=='object'||Array.isArray(v))return json({error:'Mídias inválidas'},400);
    const media={...previous.media};
    for(const [event,val] of Object.entries(v)){
     if(!MEDIA_EVENTS.includes(event))return json({error:'Evento desconhecido: '+event},400);
     try{media[event]=normalizeMedia(val)}catch(e){return json({error:event+': '+e.message},400)}
    }
    next.media=media;
   }else if(FIELDS.includes(k)&&typeof v==='boolean')next[k]=v;
   else return json({error:'Configuração inválida: '+k},400);
  }
  if(next.enabled&&!telegramConfigured(env))return json({error:'Configure os dois segredos do Telegram no Worker antes de ativar.'},409);
  const now=stamp();
  const writes=[db.prepare(`INSERT INTO telegram_settings(source_id,settings_json,updated_at) VALUES(?,?,?) ON CONFLICT(source_id)
   DO UPDATE SET settings_json=excluded.settings_json,updated_at=excluded.updated_at`).bind(SOURCE,JSON.stringify(next),now)];
  const justEnabledTelegram=!previous.enabled&&next.enabled;
  let activeStrategy=false;
  if(justEnabledTelegram){
   const strategy=await db.prepare('SELECT config_json FROM strategy_settings WHERE source_id=?').bind(SOURCE).first();
   let cfg={};try{cfg=JSON.parse(strategy?.config_json||'{}')}catch{}
   activeStrategy=cfg.automatic===true;
   if(activeStrategy)writes.push(telegramActivationStatement(db,cfg.templates?.activation,now));
  }
  await db.batch(writes);
  // O aviso de ativação é entregue só quando o robô fica realmente ativo (ambos controles ligados).
  // Nunca é repetido pela atualização do painel nem pelas coletas.
  if(justEnabledTelegram&&activeStrategy)try{await flushTelegram(env,1)}catch(error){console.warn('Falha na entrega do aviso de ativação');}
  return json({ok:true,settings:next});
 }
 if(path==='/api/telegram/test'&&request.method==='POST'){
  try{return json(await sendTelegramTest(env));}
  catch(error){const msg=String(error?.message||'');return json({error:msg.startsWith('Configure')?msg:((msg.match(/Telegram HTTP \d{3}/)||[])[0]||'Não foi possível enviar o teste. Confira permissões do bot e chat ID.')},502);}
 }
 if(path==='/api/telegram/flush'&&request.method==='POST')return json(await flushTelegram(env,3));
 return json({error:'Rota Telegram não encontrada'},404);
}

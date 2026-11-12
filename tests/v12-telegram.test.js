import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {getTelegramSettings,telegramQueueStatement,flushTelegram,splitResultText} from '../src/telegram.js';
import {validateRule,eventMessage,PRESET_MESSAGES,COLOR} from '../src/strategyCore.js';

const SOURCE='historicosblaze:smash:double';
const epoch=()=>Math.floor(Date.now()/1000);
const schema=`
CREATE TABLE telegram_settings(source_id TEXT PRIMARY KEY,settings_json TEXT,updated_at INTEGER);
CREATE TABLE strategy_settings(source_id TEXT PRIMARY KEY,config_json TEXT,updated_at INTEGER);
CREATE TABLE telegram_outbox(queue_id INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE,source_id TEXT,strategy_id TEXT,event_type TEXT,action TEXT,message TEXT,status TEXT,created_at INTEGER,next_attempt INTEGER,attempts INTEGER NOT NULL DEFAULT 0,telegram_message_id INTEGER,last_error TEXT,sent_at INTEGER);
CREATE TABLE telegram_prealerts(strategy_id TEXT PRIMARY KEY,message_id INTEGER,event_id TEXT,updated_at INTEGER);
`;
function dbMake(settings={}){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(schema);
 sqlite.prepare('INSERT INTO telegram_settings VALUES(?,?,?)').run(SOURCE,JSON.stringify({enabled:true,...settings}),epoch());
 sqlite.prepare('INSERT INTO strategy_settings VALUES(?,?,?)').run(SOURCE,JSON.stringify({automatic:true}),epoch());
 return {sqlite,prepare(sql){const stmt=sqlite.prepare(sql);return {bind(...a){return {run:async()=>({meta:stmt.run(...a)}),all:async()=>({results:stmt.all(...a)}),first:async()=>stmt.get(...a),_run:()=>stmt.run(...a)};}}},async batch(items){sqlite.exec('BEGIN');try{for(const i of items)i._run();sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
}
function queue(db,type,eventId,body='',number=12,strategyId='regra-x'){
 const now=epoch(),event={type,roundId:eventId,color:COLOR[number],number,minute_epoch:now};
 const statement=telegramQueueStatement(db,{eventId,sourceId:SOURCE,strategyId,event,body:body||('Mensagem '+type),now,config:{enabled:true,prealert:true,entry:true,gale1:true,gale2:true,win:true,red:true,deletePrealert:true}});
 if(statement)statement._run();return statement;
}
const env=db=>({DB:db,TELEGRAM_BOT_TOKEN:'1234567890:'+'A'.repeat(35),TELEGRAM_CHAT_ID:'-1001234567890'});
function capture(){const calls=[];let id=100;const old=globalThis.fetch;globalThis.fetch=async(url,opts)=>{const method=new URL(url).pathname.split('/').at(-1),data=JSON.parse(opts.body);calls.push({method,data});return new Response(JSON.stringify({ok:true,result:{message_id:++id}}),{status:200});};return {calls,restore(){globalThis.fetch=old;}};}
const rule=validateRule({name:'Teste',pattern:[{kind:'color',value:'red'},{kind:'color',value:'black'}],targets:[{kind:'color',value:'black'}],galeMax:2,enabled:true});

test('V12: cinco stickers padrão, todos os FILE_ID são editáveis e texto com sticker desligado',async()=>{
 const db=dbMake();try{const cfg=await getTelegramSettings(db);assert.equal(cfg.deletePrealert,true);assert.equal(cfg.deleteGale,false);assert.equal(cfg.textWithSticker,false);
 for(const key of ['activation','prealert','win','winWhite','red']){assert.equal(cfg.media[key].type,'sticker');assert.ok(cfg.media[key].fileId.length>20);}
 for(const key of ['entry','gale1','gale2'])assert.equal(cfg.media[key].type,'none');
 assert.equal(cfg.media.activation.fileId,cfg.media.prealert.fileId);assert.notEqual(cfg.media.activation.fileId,cfg.media.win.fileId);
 }finally{db.sqlite.close();}
});

test('V12: atenção só apaga após ENTRADA confirmada; entrada preservada',async()=>{
 const db=dbMake(),cap=capture();try{
 queue(db,'prealert','pre-A');queue(db,'clear_prealert','clear-A');queue(db,'entry','entry-A','🎯 ENTRAR NA PRETA');
 assert.equal(db.sqlite.prepare('SELECT count(*) n FROM telegram_outbox').get().n,2,'sem exclusão antecipada');
 await flushTelegram(env(db),5);
 assert.deepEqual(cap.calls.map(c=>c.method),['sendSticker','sendMessage','deleteMessage']);
 assert.equal(cap.calls[2].data.message_id,101);
 assert.equal(db.sqlite.prepare("SELECT status FROM telegram_outbox WHERE event_type='entry'").get().status,'sent');
 assert.equal(db.sqlite.prepare('SELECT count(*) n FROM telegram_prealerts').get().n,0);
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM telegram_outbox WHERE event_type='entry' AND action='delete'").get().n,0);
 }finally{cap.restore();db.sqlite.close();}
});

test('V12: se entrada falha, ATENÇÃO fica no ar e pode ser removida após retry',async()=>{
 const db=dbMake();let id=100,calls=[],fail=true;const old=globalThis.fetch;
 globalThis.fetch=async(url,opts)=>{const method=new URL(url).pathname.split('/').at(-1);calls.push(method);if(method==='sendMessage'&&fail)return new Response('falha',{status:502});return new Response(JSON.stringify({ok:true,result:{message_id:++id}}),{status:200});};
 try{
 queue(db,'prealert','pre-B');queue(db,'entry','entry-B','🎯 ENTRAR');
 await flushTelegram(env(db),3);
 assert.deepEqual(calls,['sendSticker','sendMessage']);
 assert.equal(db.sqlite.prepare('SELECT count(*) n FROM telegram_prealerts').get().n,1);
 assert.equal(db.sqlite.prepare("SELECT status FROM telegram_outbox WHERE event_type='entry'").get().status,'retry');
 fail=false;db.sqlite.prepare("UPDATE telegram_outbox SET next_attempt=0 WHERE event_type='entry'").run();
 await flushTelegram(env(db),3);
 assert.deepEqual(calls,['sendSticker','sendMessage','sendMessage','deleteMessage']);
 }finally{globalThis.fetch=old;db.sqlite.close();}
});

test('V12: WIN e BRANCO só stickers + pedra separada; RED somente sticker',async()=>{
 const db=dbMake(),cap=capture();try{
 for(const [type,number] of [['win',12],['win',0],['red',6]]){
  const id='round-'+type+'-'+number;
  queue(db,type,id,eventMessage({type,number,color:COLOR[number]},rule,PRESET_MESSAGES),number);
 }
 await flushTelegram(env(db),8);
 assert.deepEqual(cap.calls.map(c=>c.method),['sendSticker','sendMessage','sendSticker','sendMessage','sendSticker']);
 assert.equal(cap.calls[1].data.text,'Pedra sorteada (⚫12)');
 assert.equal(cap.calls[3].data.text,'Pedra sorteada (⚪0)');
 assert.equal(cap.calls[4].data.sticker,(await getTelegramSettings(db)).media.red.fileId);
 const sent=db.sqlite.prepare("SELECT count(*) n FROM telegram_outbox WHERE status='sent'").get().n;assert.equal(sent,3);
 assert.equal((await flushTelegram(env(db),3)).processed,0);
 }finally{cap.restore();db.sqlite.close();}
});

test('V12: GALE 1/2 tem texto exato e não apaga nenhuma mensagem por padrão',async()=>{
 const db=dbMake(),cap=capture();try{
 for(const type of ['entry','gale1','gale2','red'])queue(db,type,'evt-'+type,eventMessage({type,number:6,color:'red'},rule,PRESET_MESSAGES),6);
 await flushTelegram(env(db),8);
 assert.equal(cap.calls[1].data.text,'- - - - GALE 1 - - - -');
 assert.equal(cap.calls[2].data.text,'- - - - GALE 2 - - - -');
 assert.equal(cap.calls.filter(c=>c.method==='deleteMessage').length,0);
 }finally{cap.restore();db.sqlite.close();}
});

test('V12: exclusão opcional remove SOMENTE os dois GALEs após resultado',async()=>{
 const db=dbMake({deleteGale:true}),cap=capture();try{
 for(const type of ['entry','gale1','gale2','red'])queue(db,type,'evt-'+type,eventMessage({type,number:6,color:'red'},rule,PRESET_MESSAGES),6);
 await flushTelegram(env(db),10);
 assert.deepEqual(cap.calls.map(c=>c.method),['sendMessage','sendMessage','sendMessage','sendSticker','deleteMessage','deleteMessage']);
 const ids=cap.calls.filter(c=>c.method==='deleteMessage').map(c=>c.data.message_id).sort();assert.deepEqual(ids,[102,103]);
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM telegram_outbox WHERE event_type='entry' AND action='delete'").get().n,0);
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM telegram_outbox WHERE event_type='red' AND action='delete'").get().n,0);
 }finally{cap.restore();db.sqlite.close();}
});

test('V12: texto do resultado é dividido somente na linha final',()=>{
 assert.deepEqual(splitResultText('win','WIN!\n\nPedra sorteada (🔴2)'),{main:'WIN!',stone:'Pedra sorteada (🔴2)'});
 assert.equal(splitResultText('red','RED').stone,'');
});

test('V12: sem mídia WIN vira duas mensagens de texto independentes',async()=>{
 const db=dbMake({media:{win:{type:'none',fileId:''}}}),cap=capture();try{
 queue(db,'win','plain-win',eventMessage({type:'win',number:12,color:'black'},rule,PRESET_MESSAGES),12);
 await flushTelegram(env(db),2);
 assert.deepEqual(cap.calls.map(c=>c.method),['sendMessage','sendMessage']);
 assert.doesNotMatch(cap.calls[0].data.text,/Pedra sorteada/);
 assert.equal(cap.calls[1].data.text,'Pedra sorteada (⚫12)');
 }finally{cap.restore();db.sqlite.close();}
});

test('V12: se falhar envio da pedra, retry não reenvia sticker WIN',async()=>{
 const db=dbMake();const previous=globalThis.fetch;let fail=true,id=200;const calls=[];
 globalThis.fetch=async(url,opts)=>{
  const method=new URL(url).pathname.split('/').at(-1);
  calls.push(method);
  if(method==='sendMessage'&&fail)return new Response('error',{status:503});
  return new Response(JSON.stringify({ok:true,result:{message_id:++id}}));
 };
 try{
  queue(db,'win','retry-stone',eventMessage({type:'win',number:12,color:'black'},rule,PRESET_MESSAGES),12);
  await flushTelegram(env(db),1);
  const first=db.sqlite.prepare('SELECT status,telegram_message_id FROM telegram_outbox').get();
  assert.equal(first.status,'retry');assert.equal(first.telegram_message_id,201);
  fail=false;db.sqlite.prepare('UPDATE telegram_outbox SET next_attempt=0').run();
  await flushTelegram(env(db),2);
  assert.deepEqual(calls,['sendSticker','sendMessage','sendMessage']);
  assert.equal(db.sqlite.prepare('SELECT status FROM telegram_outbox').get().status,'sent');
 }finally{globalThis.fetch=previous;db.sqlite.close();}
});

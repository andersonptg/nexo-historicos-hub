import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {telegramConfigured,telegramQueueStatement,flushTelegram,sendTelegramTest,handleTelegram} from '../src/telegram.js';

function mockD1(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
 return {sqlite,prepare(sql){const statement=sqlite.prepare(sql);return {bind(...params){return {run:async()=>({meta:statement.run(...params)}),all:async()=>({results:statement.all(...params)}),first:async()=>statement.get(...params),_run:()=>statement.run(...params)};}}},async batch(items){sqlite.exec('BEGIN');try{for(const item of items)item._run();sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
}
const secret='1234567890:'+'a'.repeat(35);
const credentials={TELEGRAM_BOT_TOKEN:secret,TELEGRAM_CHAT_ID:'-1001234567890'};
const sourceId='historicosblaze:smash:double';
const epoch=()=>Math.floor(Date.now()/1000);
function insertQueue(db,{id,type,number=1,now=epoch(),enabled=true}){
 const cfg={enabled,prealert:true,entry:true,gale1:true,gale2:true,win:true,red:true,deletePrealert:true};
 const event={type,minute_epoch:now,roundId:'r-'+id,number};
 const st=telegramQueueStatement(db,{eventId:id,sourceId,strategyId:'strategy-one',event,body:'Mensagem '+type,now,config:cfg});
 if(st)st._run();return st;
}
test('V9: credenciais so existem no Worker, chat ID de canal/grupo válido',()=>{
 assert.equal(telegramConfigured(credentials),true);
 assert.equal(telegramConfigured({TELEGRAM_BOT_TOKEN:'',TELEGRAM_CHAT_ID:'123'}),false);
 assert.equal(telegramConfigured({...credentials,TELEGRAM_CHAT_ID:'<script>alert(1)</script>'}),false);
});
test('V9: fila D1 não duplica o mesmo evento; ignora eventos antigos e modo desligado',()=>{
 const db=mockD1(),now=epoch();
 insertQueue(db,{id:'a',type:'entry',now});insertQueue(db,{id:'a',type:'entry',now});
 insertQueue(db,{id:'b',type:'win',now,enabled:false});
 const q=telegramQueueStatement(db,{eventId:'c',sourceId,strategyId:'strategy-one',event:{type:'entry',minute_epoch:now-240},body:'m',now,config:{enabled:true,entry:true}});
 assert.equal(q,null);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM telegram_outbox').get().n,1);
 db.sqlite.close();
});
test('V9: API Telegram exige sessão; nenhum token no HTML ou JS publico',async()=>{
 const request=new Request('https://site.example/api/telegram/status');
 const response=await handleTelegram(request,{DB:null,...credentials},new URL(request.url));
 assert.equal(response.status,401);
 for(const file of ['public/estrategias.html','public/estrategias.js']){
  const text=readFileSync(new URL('../'+file,import.meta.url),'utf8');
  assert.equal(text.includes(secret),false);
  assert.equal(text.includes('TELEGRAM_BOT_TOKEN'),true);
 }
});
test('V9: teste manual chama sendMessage apenas depois de clique explícito',async()=>{
 const oldFetch=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({ok:true,result:{message_id:91}}),{status:200});};
 try{
  const result=await sendTelegramTest(credentials);
  assert.equal(result.messageId,91);assert.equal(calls.length,1);
  assert.ok(calls[0].url.endsWith('/sendMessage'));
  assert.equal(JSON.parse(calls[0].options.body).chat_id,credentials.TELEGRAM_CHAT_ID);
 }finally{globalThis.fetch=oldFetch;}
});
test('V12: cancelamento do pré-aviso registra ID e apaga somente o aviso',async()=>{
 const db=mockD1();const now=epoch();
 db.sqlite.prepare('INSERT INTO strategy_settings(source_id,config_json,updated_at) VALUES(?,?,?)').run(sourceId,JSON.stringify({automatic:true}),now);
 db.sqlite.prepare('INSERT INTO telegram_settings(source_id,settings_json,updated_at) VALUES(?,?,?)').run(sourceId,JSON.stringify({enabled:true}),now);
 insertQueue(db,{id:'pre-a',type:'prealert',now});insertQueue(db,{id:'cancel-b',type:'cancel_prealert',now});
 const previous=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,opts)=>{
  const method=String(url).split('/').at(-1);calls.push({method,payload:JSON.parse(opts.body)});
  return new Response(JSON.stringify({ok:true,result:method==='sendSticker'?{message_id:437}:true}),{status:200});
 };
 try{
  const result=await flushTelegram({...credentials,DB:db},2);
  assert.equal(result.processed,2);
  assert.deepEqual(calls.map(x=>x.method),['sendSticker','deleteMessage']);
  assert.equal(calls[1].payload.message_id,437);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM telegram_outbox WHERE status='sent'").get().n,2);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM telegram_prealerts').get().n,0);
  assert.equal((await flushTelegram({...credentials,DB:db},2)).processed,0);
 }finally{globalThis.fetch=previous;db.sqlite.close();}
});
test('V9: falha Telegram não revela token e pode ser retentada depois',async()=>{
 const db=mockD1(),now=epoch();
 db.sqlite.prepare('INSERT INTO strategy_settings(source_id,config_json,updated_at) VALUES(?,?,?)').run(sourceId,JSON.stringify({automatic:true}),now);
 db.sqlite.prepare('INSERT INTO telegram_settings(source_id,settings_json,updated_at) VALUES(?,?,?)').run(sourceId,JSON.stringify({enabled:true}),now);
 insertQueue(db,{id:'win-1',type:'win',now});
 const old=globalThis.fetch;globalThis.fetch=async()=>new Response('Unauthorized',{status:401});
 try{
  assert.equal((await flushTelegram({...credentials,DB:db},1)).processed,1);
  const row=db.sqlite.prepare('SELECT status,last_error FROM telegram_outbox').get();
  assert.equal(row.status,'retry');assert.equal(row.last_error,'Telegram HTTP 401');
  assert.ok(!JSON.stringify(row).includes(secret));
 }finally{globalThis.fetch=old;db.sqlite.close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {validateRule,evolve,eventMessage,PRESET_MESSAGES,COLOR} from '../src/strategyCore.js';
import {handleTelegram,telegramQueueStatement,flushTelegram} from '../src/telegram.js';
import {adminHandler} from '../src/admin.js';

const ROOT='https://nexo.example';
const SOURCE='historicosblaze:smash:double';
const TOKEN='1234567890:'+'A'.repeat(36);
const PASS='V11_test_admin_password_abc_123';
const CHAT='1617880932';
const epoch=()=>Math.floor(Date.now()/1000);
const id='CAACAgIAAxkBAAICZ2FCABCxyz_123';
function mockD1(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
 return {sqlite,prepare(sql){const stmt=sqlite.prepare(sql);return {bind(...params){return {run:async()=>({meta:stmt.run(...params)}),all:async()=>({results:stmt.all(...params)}),first:async()=>stmt.get(...params),_run:()=>stmt.run(...params)};}}},async batch(items){sqlite.exec('BEGIN');try{for(const item of items)item._run();sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
}
const envFor=db=>({DB:db,TELEGRAM_BOT_TOKEN:TOKEN,TELEGRAM_CHAT_ID:CHAT,ADMIN_TOKEN:PASS});
async function cookie(env){
 const request=new Request(ROOT+'/api/admin/login',{method:'POST',headers:{Origin:ROOT,'Content-Type':'application/json'},body:JSON.stringify({password:PASS})});
 const resp=await adminHandler(request,env,new URL(request.url));assert.equal(resp.status,200);
 return resp.headers.get('set-cookie').split(';')[0];
}
async function tgRoute(env,session,path,method='GET',body){
 const req=new Request(ROOT+path,{method,headers:{Cookie:session,Origin:ROOT,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const res=await handleTelegram(req,env,new URL(req.url));return {status:res.status,body:await res.json()};
}
function queue(db,type,number=12,eventId='test'+Math.random()){
 const now=epoch(),event={type,color:COLOR[number],number,minute_epoch:now,roundId:eventId};
 const s=telegramQueueStatement(db,{eventId,sourceId:SOURCE,strategyId:'rule_one',event,body:'✅ WIN\n\nPedra sorteada (⚫12)',now,config:{enabled:true,win:true,entry:true,red:true}});
 assert.ok(s);s._run();
}
function setTelegram(db,media){
 db.sqlite.prepare('INSERT INTO strategy_settings(source_id,config_json,updated_at) VALUES(?,?,?)').run(SOURCE,JSON.stringify({automatic:true}),epoch());
 db.sqlite.prepare('INSERT INTO telegram_settings(source_id,settings_json,updated_at) VALUES(?,?,?)').run(SOURCE,JSON.stringify({enabled:true,media}),epoch());
}

test('V11: pedra sorteada só no WIN e WIN branco; nunca nos alertas, GALE ou RED',()=>{
 const rule=validateRule({name:'Sequência',pattern:[{kind:'color',value:'red'}],targets:[{kind:'color',value:'black'}],galeMax:0,enabled:true});
 for(const type of ['prealert','entry','gale1','gale2','red']){
  const txt=eventMessage({type,number:12,color:'black'},rule,PRESET_MESSAGES);
  assert.doesNotMatch(txt,/Pedra sorteada/,'pedra indevida no '+type);
 }
 for(const [number,tag] of [[12,/Pedra sorteada \(⚫12\)$/],[0,/Pedra sorteada \(⚪0\)$/]]){
  const text=eventMessage({type:'win',number,color:COLOR[number]},rule,PRESET_MESSAGES);
  assert.match(text,tag);assert.equal((text.match(/Pedra sorteada/g)||[]).length,1);
 }
 assert.doesNotMatch(PRESET_MESSAGES.prealert,/Atenção/);
});

test('V11: ativação envia ATENÇÃO uma vez, sem reenviar ao salvar nem atualizar a tela',async()=>{
 const db=mockD1(),env=envFor(db),session=await cookie(env),calls=[];
 db.sqlite.prepare('INSERT INTO strategy_settings(source_id,config_json,updated_at) VALUES(?,?,?)').run(SOURCE,JSON.stringify({automatic:true}),epoch());
 const old=globalThis.fetch;
 globalThis.fetch=async(url,opts)=>{calls.push({method:new URL(url).pathname.split('/').at(-1),payload:JSON.parse(opts.body)});return new Response(JSON.stringify({ok:true,result:{message_id:101+calls.length}}));};
 try{
  const body={enabled:true,media:{activation:{type:'animation',fileId:id}}};
  const first=await tgRoute(env,session,'/api/telegram/settings','PUT',body);assert.equal(first.status,200);
  assert.deepEqual(calls.map(x=>x.method),['sendAnimation']);
  assert.match(calls[0].payload.caption,/ATENÇÃO/);
  const second=await tgRoute(env,session,'/api/telegram/settings','PUT',{enabled:true});assert.equal(second.status,200);
  assert.equal(calls.length,1);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM telegram_outbox WHERE event_type='activation'").get().n,1);
  const off=await tgRoute(env,session,'/api/telegram/settings','PUT',{enabled:false});assert.equal(off.status,200);
  const on=await tgRoute(env,session,'/api/telegram/settings','PUT',{enabled:true});assert.equal(on.status,200);
  assert.equal(calls.length,2,'uma ativação por mudança desligado->ligado');
 }finally{globalThis.fetch=old;db.sqlite.close();}
});

test('V11: GIF WIN sai em uma mensagem com texto; fila não duplica WIN',async()=>{
 const db=mockD1();setTelegram(db,{win:{type:'animation',fileId:id}});
 queue(db,'win',12,'final_12');queue(db,'win',12,'final_12');
 const calls=[],old=globalThis.fetch;
 globalThis.fetch=async(url,opts)=>{calls.push({name:new URL(url).pathname.split('/').at(-1),body:JSON.parse(opts.body)});return new Response(JSON.stringify({ok:true,result:{message_id:402}}));};
 try{
  assert.equal((await flushTelegram(envFor(db),1)).processed,1);
  assert.equal((await flushTelegram(envFor(db),1)).processed,0);
  assert.deepEqual(calls.map(x=>x.name),['sendAnimation']);
  assert.equal(calls[0].body.animation,id);assert.match(calls[0].body.caption,/Pedra sorteada/);
 }finally{globalThis.fetch=old;db.sqlite.close();}
});

test('V11: sticker + texto numa só ocorrência do resultado, sem repetição do sticker',async()=>{
 const db=mockD1();setTelegram(db,{win:{type:'sticker',fileId:id}});queue(db,'win',12,'sticker_final');
 const calls=[],old=globalThis.fetch;
 globalThis.fetch=async(url,opts)=>{const name=new URL(url).pathname.split('/').at(-1);calls.push(name);return new Response(JSON.stringify({ok:true,result:{message_id:603+calls.length}}));};
 try{
  await flushTelegram(envFor(db),1);await flushTelegram(envFor(db),1);
  assert.deepEqual(calls,['sendSticker','sendMessage']);
  const row=db.sqlite.prepare('SELECT status,telegram_message_id FROM telegram_outbox').get();assert.equal(row.status,'sent');assert.ok(row.telegram_message_id);
 }finally{globalThis.fetch=old;db.sqlite.close();}
});

test('V11: busca de mídia via bot filtra o Chat ID correto e exige sessão',async()=>{
 const db=mockD1(),env=envFor(db),session=await cookie(env),old=globalThis.fetch;
 const unauthorized=await tgRoute(env,'','/api/telegram/media');assert.equal(unauthorized.status,401);
 globalThis.fetch=async()=>new Response(JSON.stringify({ok:true,result:[
  {message:{message_id:10,date:epoch(),chat:{id:321},sticker:{file_id:'CAACAA1234567890'}}},
  {message:{message_id:11,date:epoch(),chat:{id:Number(CHAT)},animation:{file_id:id}}}
 ]}));
 try{const r=await tgRoute(env,session,'/api/telegram/media');assert.equal(r.status,200);assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].type,'animation');assert.equal(r.body.items[0].fileId,id);}
 finally{globalThis.fetch=old;db.sqlite.close();}
});

test('V11: interface reúne texto e mídia por evento e não exibe segredo',()=>{
 const html=readFileSync(new URL('../public/estrategias.html',import.meta.url),'utf8');
 const script=readFileSync(new URL('../public/estrategias.js',import.meta.url),'utf8');
 assert.match(html,/id="telegramPanel"/);assert.match(html,/id="templates"/);
 assert.match(script,/Puxar do Telegram/);assert.match(script,/telegram-event-card/);assert.match(script,/activation/);
 assert.ok(!html.includes(TOKEN));assert.ok(!script.includes(TOKEN));
});


test('V11: ATENÇÃO é disparada quando a automação for ligada por último',async()=>{
 const {handleStrategies}=await import('../src/strategies.js');
 const db=mockD1(),env=envFor(db),session=await cookie(env),calls=[];
 const old=globalThis.fetch;
 globalThis.fetch=async(url,opts)=>{calls.push(new URL(url).pathname.split('/').at(-1));return new Response(JSON.stringify({ok:true,result:{message_id:900+calls.length}}));};
 try{
  const initial=await tgRoute(env,session,'/api/telegram/settings','PUT',{enabled:true,media:{activation:{type:'animation',fileId:id}}});
  assert.equal(initial.status,200);assert.deepEqual(calls,[]);
  const req=new Request(ROOT+'/api/strategies/settings',{method:'PUT',headers:{Cookie:session,Origin:ROOT,'Content-Type':'application/json'},body:JSON.stringify({automatic:true})});
  const res=await handleStrategies(req,env,new URL(req.url));assert.equal(res.status,200);assert.deepEqual(calls,['sendAnimation']);
  const repeat=new Request(ROOT+'/api/strategies/settings',{method:'PUT',headers:{Cookie:session,Origin:ROOT,'Content-Type':'application/json'},body:JSON.stringify({automatic:true})});
  const res2=await handleStrategies(repeat,env,new URL(repeat.url));assert.equal(res2.status,200);assert.equal(calls.length,1);
 }finally{globalThis.fetch=old;db.sqlite.close();}
});

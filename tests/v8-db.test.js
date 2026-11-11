import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {processSmashSnapshot} from '../src/strategies.js';
import {COLOR} from '../src/strategyCore.js';

function mockD1(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
 return {
  sqlite,
  prepare(sql){
   const statement=sqlite.prepare(sql);
   return {bind(...params){return {
     run:async()=>({meta:statement.run(...params)}),
     all:async()=>({results:statement.all(...params)}),
     first:async()=>statement.get(...params),
     _run:()=>statement.run(...params)
   };}};
  },
  async batch(items){
   sqlite.exec('BEGIN');
   try{for(const item of items)item._run();sqlite.exec('COMMIT');}
   catch(error){sqlite.exec('ROLLBACK');throw error;}
  }
 };
}

function snapshots(numbers){const reversed=[...numbers].reverse();return {records:reversed.map((n,i)=>({number:n,color:COLOR[n],minute_epoch:1700000000+reversed.length-i})),ids:reversed.map((n,i)=>'round-'+(numbers.length-i-1))};}
test('V8: processamento persistido no D1 é idempotente; WIN só depois da entrada',async()=>{
 const db=mockD1(),source={id:'historicosblaze:smash:double',platform:'smash',game:'double'},env={DB:db};
 const rule={name:'Teste banco',pattern:[0,1,4,8,10].map(n=>({kind:'color',value:COLOR[n]})),targets:[{kind:'color',value:'red'}],galeMax:2,enabled:true};
 db.sqlite.prepare('INSERT INTO strategies(id,platform,game,definition,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('test1','smash','double',JSON.stringify(rule),1,100,100);
 db.sqlite.prepare('INSERT INTO strategy_settings(source_id,config_json,updated_at) VALUES(?,?,?)').run(source.id,JSON.stringify({automatic:true,prealert:true,entry:true}),100);
 let old=[8,9,10,11,13,14,9,13];
 let snap=snapshots(old);assert.deepEqual(await processSmashSnapshot(env,source,snap.records,snap.ids),{initialized:true});
 for(const number of [0,1,4,8,10,7]){old.push(number);snap=snapshots(old);await processSmashSnapshot(env,source,snap.records,snap.ids);}
 const logs=db.sqlite.prepare('SELECT event_type FROM strategy_events ORDER BY rowid').all().map(x=>x.event_type);
 assert.deepEqual(logs,['prealert','clear_prealert','entry','win']);
 await processSmashSnapshot(env,source,snap.records,snap.ids);
 assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM strategy_events').get().n,4);
 db.sqlite.close();
});

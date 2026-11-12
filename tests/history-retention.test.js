import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldPruneHistory, historyPruneStatements,ROUND_HISTORY_LIMIT} from '../src/retention.js';

const source={id:'historicosblaze:smash:double',platform:'smash',game:'double'};
function fakeDb(firstRow=null){
 const calls=[];
 return {calls,prepare(sql){
  return {bind(...params){calls.push({sql,params});return {
   first:async()=>firstRow
  }}};
 }};
}
test('V12: limite e isolamento por plataforma/jogo',()=>{
 const db=fakeDb(); const [prune,marker]=historyPruneStatements(db,source,'rounds',123456);
 assert.equal(ROUND_HISTORY_LIMIT,500);
 assert.match(db.calls[0].sql,/DELETE FROM rounds/);
 assert.match(db.calls[0].sql,/ORDER BY minute_epoch DESC, first_seen DESC, id DESC LIMIT 500/);
 assert.deepEqual(db.calls[0].params,['smash','double','smash','double']);
 assert.match(db.calls[1].sql,/history_retention_state/);
 assert.deepEqual(db.calls[1].params,[source.id,123456]);
 assert.ok(prune&&marker);
});
test('V12: nunca aceita tabela arbitrária para deletar',()=>{
 const db=fakeDb(); assert.throws(()=>historyPruneStatements(db,source,'strategy_events',123));
});
test('V12: primeira coleta limpa histórico antigo, sem novas rodadas',async()=>{
 const db=fakeDb(null);assert.equal(await shouldPruneHistory(db,source,false),true);
 assert.deepEqual(db.calls[0].params,[source.id]);
});
test('V12: sem novas rodadas e já limpo, evita trabalho desnecessário',async()=>{
 const db=fakeDb({source_id:source.id});assert.equal(await shouldPruneHistory(db,source,false),false);
 assert.equal(await shouldPruneHistory(db,source,true),true);
});
test('V12: também limita Crash sem misturar tabelas',()=>{
 const db=fakeDb();historyPruneStatements(db,{id:'x',platform:'brabet',game:'crash'},'multiplier_rounds',42);
 assert.match(db.calls[0].sql,/DELETE FROM multiplier_rounds/);
 assert.deepEqual(db.calls[0].params,['brabet','crash','brabet','crash']);
});

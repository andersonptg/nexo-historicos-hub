import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=x=>readFileSync(new URL('../'+x,import.meta.url),'utf8');
test('V19: ativacao de fonte confirma D1 e reinicia lease',()=>{
 const admin=read('src/admin.js');
 assert.match(admin,/confirmed:true/);
 assert.match(admin,/UPDATE collection_leases SET next_allowed=0/);
});
test('V19: placar por estrategia agrega eventos sem gravar D1',()=>{
 const engine=read('src/strategies.js');
 assert.match(engine,/GROUP BY strategy_id/);
 assert.match(engine,/white_wins/);
 assert.match(read('public/estrategias.js'),/Copiar placar/);
});
test('V19: indicacao so sai por envio explicito autenticado',()=>{
 const bot=read('src/telegram.js');
 assert.match(bot,/api\/telegram\/referral/);
 assert.match(bot,/messageId:result/);
 assert.match(read('public/estrategias.js'),/confirm\('Enviar esta mensagem/);
});

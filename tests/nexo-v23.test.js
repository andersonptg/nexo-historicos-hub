import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {telegramQueueStatement} from '../src/telegram.js';
const tg=readFileSync(new URL('../src/telegram.js',import.meta.url),'utf8');
const st=readFileSync(new URL('../src/strategies.js',import.meta.url),'utf8');
const now=1794500000;
function queue(type,age){const db={prepare(sql){return {sql,bind(...args){return {sql,args}}}}};return telegramQueueStatement(db,{eventId:'a:round:'+type,sourceId:'historicosblaze:smash:double',strategyId:'a',event:{type,roundId:'round',number:2,color:'red',minute_epoch:now-age},body:'resultado',now,config:{enabled:true,entry:true,win:true,red:true}});}
test('V23 GREEN atrasado entra na fila, entrada velha nao',()=>{assert.ok(queue('win',240));assert.equal(queue('entry',240),null);});
test('V23 RED atrasado entra na fila',()=>assert.ok(queue('red',240)));
test('V23 GREEN nao expira por idade da fila',()=>assert.match(tg,/event_type NOT IN \('win','winWhite','red'\)/));
test('V23 GREEN e RED mantem retentativa apos cinco falhas',()=>assert.match(tg,/n>=5&&!\['win','winWhite','red'\]\.includes/));
test('V23 pausa preserva estado e nao gera nova entrada',()=>{assert.doesNotMatch(st,/if\(old\.automatic&&!next\.automatic\)writes\.push/);assert.match(st,/!settings\.automatic\)&&!previous\.active/);});

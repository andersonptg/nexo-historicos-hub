import test from 'node:test';
import assert from 'node:assert/strict';
import {saoPauloDayStart,scoreCutoff} from '../src/scoreboard.js';
import {readFileSync} from 'node:fs';

test('V29 meia noite SP zera placar sem deletar eventos',()=>{
 const before=Date.parse('2026-11-14T02:59:59Z')/1000;
 const after=Date.parse('2026-11-14T03:00:01Z')/1000;
 assert.equal(saoPauloDayStart(before),Date.parse('2026-11-13T03:00:00Z')/1000);
 assert.equal(saoPauloDayStart(after),Date.parse('2026-11-14T03:00:00Z')/1000);
 assert.equal(scoreCutoff({scoreResetMode:'daily'},after),saoPauloDayStart(after));
 assert.equal(scoreCutoff({scoreResetMode:'manual',scoreResetAt:123},after),123);
 assert.equal(scoreCutoff({scoreResetMode:'daily',scoreResetAt:after},after),after);
});
test('V29 API do placar somente leitura do historico, com corte temporal',()=>{
 const a=readFileSync(new URL('../src/strategies.js',import.meta.url),'utf8');
 const t=readFileSync(new URL('../src/telegram.js',import.meta.url),'utf8');
 assert.match(a,/\/api\/strategies\/score\/reset/);
 assert.match(a,/created_at>=\?/);
 assert.match(t,/source_id=\? AND created_at>=\?/);
 assert.match(t,/signalDestination/);
 assert.match(t,/test-signal-destination/);
 assert.match(t,/Telegram HTTP 400/);
 const reset=a.slice(a.indexOf("if(path==='/api/strategies/score/reset'"),a.indexOf("if(path==='/api/strategies/state'"));
 assert.doesNotMatch(reset,/DELETE FROM/);
});

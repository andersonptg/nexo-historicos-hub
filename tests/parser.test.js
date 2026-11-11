import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSmashHtml,reconcileSnapshot,visibleTokens} from '../src/parser.js';
const page=(data)=>`<html><head><script>ignore</script></head><body><p>Sem Destaque</p>${data.map(([n,t])=>`<b>${n}</b><small>${t}</small>`).join('')}<p>Fim da lista</p></body></html>`;
const data=[[12,'14:12'],[11,'14:11'],[10,'14:11'],[14,'14:10'],[7,'14:10'],[1,'14:09'],[7,'14:09'],[8,'14:08']];
test('Parser finds real number and minute pairs',()=>{
 const rows=parseSmashHtml(page(data),Date.parse('2026-11-11T14:13:00-03:00')/1000);
 assert.equal(rows.length,8);assert.equal(rows[0].number,12);assert.equal(rows[0].color,'black');assert.equal(rows[4].color,'red');
 assert.equal(rows[0].minute_epoch,Date.parse('2026-11-11T14:12:00-03:00')/1000);
});
test('White reading with image alt and midnight rollover',()=>{
 const html='<div>Sem Destaque</div><img alt="Branco"/><span>00:01</span>'+Array.from({length:7},(_,i)=>`<b>${i+1}</b><span>${i===0?'00:00':'23:5'+(9-i)}</span>`).join('');
 const arr=parseSmashHtml(html,Date.parse('2026-11-11T00:02:00-03:00')/1000);
 assert.equal(arr[0].number,0);assert.equal(arr[0].color,'white');
 assert.equal(arr[2].minute_epoch,Date.parse('2026-11-10T23:58:00-03:00')/1000);
});
test('Reconciliation retains identities after new prefix arrives',()=>{
 const old=[{minute_epoch:1000,number:2,round_id:'a'},{minute_epoch:940,number:3,round_id:'b'}];
 const curr=[{minute_epoch:1060,number:1},{minute_epoch:1000,number:2},{minute_epoch:940,number:3}];
 assert.deepEqual(reconcileSnapshot(old,curr),[null,'a','b']);
});

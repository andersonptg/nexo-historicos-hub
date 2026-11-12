import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRule,evolve,COLOR,suffixMatches,eventMessage,PRESET_MESSAGES} from '../src/strategyCore.js';
import {readFileSync} from 'node:fs';
const seq=[0,1,4,8,10];
const pattern=seq.map(n=>({kind:'color',value:COLOR[n]}));
const rule=validateRule({name:'Duplas',pattern,targets:[{kind:'color',value:'red'},{kind:'color',value:'white'}],galeMax:2,enabled:true});
const run=(r,numbers)=>{let state={active:null,prealertRoundId:null},events=[],history=[];numbers.forEach((n,i)=>{history.push({id:`r${i}`,number:n,color:COLOR[n],minute_epoch:100+i});const v=evolve(state,r,history);state=v.state;events.push(...v.events);});return {state,events};};
const events=(r,list)=>run(r,list).events.map(x=>x.type);
test('V8: valida cores e números, misto e gale até 2',()=>{
 const m=validateRule({name:'Misto',pattern:[{kind:'number',value:0},{kind:'color',value:'red'}],targets:[{kind:'number',value:14}],galeMax:2});
 assert.equal(m.pattern[0].value,0);assert.equal(m.targets[0].value,14);assert.equal(m.enabled,false);
 assert.throws(()=>validateRule({...m,galeMax:3}),/Gale máximo/);
 assert.throws(()=>validateRule({...m,pattern:[]}),/1 e 500/);
 assert.throws(()=>validateRule({...m,targets:[{kind:'number',value:15}]}),/0 a 14/);
 assert.throws(()=>validateRule({...m,targets:[{kind:'color',value:'red'},{kind:'color',value:'red'}]}),/repetidos/);
});
test('V8: pré-aviso apenas no penúltimo elemento e entrada na próxima pedra',()=>{
 assert.deepEqual(events(rule,[0,1,4,8]),['prealert']);
 assert.deepEqual(events(rule,[0,1,4,8,10]),['prealert','clear_prealert','entry']);
 assert.deepEqual(events(rule,[0,1,4,8,7]),['prealert','cancel_prealert']);
});
test('V8: WIN na rodada seguinte à entrada, não na pedra do padrão',()=>{
 assert.deepEqual(events(rule,[0,1,4,8,10,7]),['prealert','clear_prealert','entry','win']);
 assert.equal(events(rule,[0,1,4,8,10]).includes('win'),false);
});
test('V8: Gale 1, Gale 2 e RED respeitam máximo configurado',()=>{
 assert.deepEqual(events(rule,[0,1,4,8,10,14,14,14]),['prealert','clear_prealert','entry','gale1','gale2','red']);
 const rule1={...rule,galeMax:1};assert.deepEqual(events(rule1,[0,1,4,8,10,9,11]),['prealert','clear_prealert','entry','gale1','red']);
 const rule0={...rule,galeMax:0};assert.deepEqual(events(rule0,[0,1,4,8,10,9]),['prealert','clear_prealert','entry','red']);
});
test('V8: segundo resultado acerta no Gale 1, usa alvo branco',()=>{
 assert.deepEqual(events(rule,[0,1,4,8,10,14,0]),['prealert','clear_prealert','entry','gale1','win']);
});
test('V8: cor é diferente do número exato',()=>{
 const r=validateRule({name:'Número',pattern:[{kind:'number',value:1},{kind:'number',value:4}],targets:[{kind:'number',value:14}],galeMax:0,enabled:true});
 assert.equal(suffixMatches([{number:7},{number:4}],r.pattern),false);
 assert.deepEqual(events(r,[1,4,14]),['prealert','clear_prealert','entry','win']);
 assert.deepEqual(events(r,[1,4,13]),['prealert','clear_prealert','entry','red']);
});
test('V8: templates convertem alvo sem afirmar previsão',()=>{
 const x=eventMessage({type:'entry'},rule,PRESET_MESSAGES);
 assert.match(x,/VERMELHO/);assert.match(x,/BRANCO/);assert.match(x,/(?:GALE 2|ATÉ 2 MARTINGALE)/);
 assert.equal(eventMessage({type:'clear_prealert'},rule,PRESET_MESSAGES),'');
});
test('V8: SQL não exclui resultados existentes e arquivo html contém funções reais',()=>{
 const schema=readFileSync(new URL('../schema.sql',import.meta.url),'utf8');
 for(const table of ['strategies','strategy_settings','strategy_runtime','strategy_cursors','strategy_events'])assert.ok(schema.includes('CREATE TABLE IF NOT EXISTS '+table));
 assert.equal(/DROP\s+TABLE|DELETE\s+FROM\s+rounds/gi.test(schema),false);
 const html=readFileSync(new URL('../public/estrategias.html',import.meta.url),'utf8');
 for(const key of ['automatic','prealert','entry','fireworks','patternChips','targetChips','saveRule','saveTemplates','simulate','events'])assert.ok(html.includes('id="'+key+'"'),key);
});

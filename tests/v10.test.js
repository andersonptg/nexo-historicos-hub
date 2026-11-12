import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRule,evolve,eventMessage,PRESET_MESSAGES} from '../src/strategyCore.js';
import {readFileSync} from 'node:fs';

const token=(value,kind='color')=>({kind,value});
const simple=validateRule({name:'WIN na preta ou no branco',pattern:[token('red'),token('black')],targets:[token('black')],galeMax:2,enabled:true});
function run(rule,ns){let state={active:null,prealertRoundId:null},events=[];const list=[];
 for(let i=0;i<ns.length;i++){
  const number=ns[i],color=number===0?'white':number<=7?'red':'black';
  const r={id:'r'+i,number,color,minute_epoch:1000+i};list.push(r);
  const x=evolve(state,rule,list.slice(-200));state=x.state;events.push(...x.events);
 }
 return {state,events};
}
test('V10: qualquer tamanho de 1 a 500 pedras',()=>{
 const arr=Array.from({length:220},()=>token(2,'number'));
 assert.equal(validateRule({...simple,pattern:arr}).pattern.length,220);
 assert.equal(validateRule({...simple,pattern:[token('red')]}).pattern.length,1);
 assert.throws(()=>validateRule({...simple,pattern:Array.from({length:501},()=>token('red'))}),/500/);
});
test('V10: padrão com mais de 200 pedras funciona pelo histórico incremental',()=>{
 const arr=Array.from({length:220},()=>token(2,'number'));
 const rule=validateRule({...simple,pattern:arr});
 const data=run(rule,Array(220).fill(2));
 assert.equal(data.events.filter(e=>e.type==='entry').length,1);
 assert.equal(data.events.filter(e=>e.type==='prealert').length,1);
});
test('V10: estratégia com uma pedra não cria pré-avisos vazios',()=>{
 const r=validateRule({...simple,pattern:[token('red')]});
 assert.deepEqual(run(r,[1]).events.map(e=>e.type),['entry']);
});
test('V10: branco vale WIN após entrada na cor escolhida',()=>{
 const data=run(simple,[1,8,0]);
 assert.deepEqual(data.events.map(x=>x.type),['prealert','clear_prealert','entry','win']);
 const m=eventMessage(data.events.at(-1),simple,PRESET_MESSAGES);
 assert.match(m,/WIN NO BRANCO/);
 assert.match(m,/Pedra sorteada \(⚪0\)/);
 assert.match(eventMessage({type:'entry'},simple,PRESET_MESSAGES),/PRETO ⚫ (?:OU|E) BRANCO ⚪/);
});
test('V10: WIN na preta mostra pedra sorteada exata',()=>{
 const data=run(simple,[1,8,12]);
 assert.equal(data.events.at(-1).type,'win');
 assert.match(eventMessage(data.events.at(-1),simple,PRESET_MESSAGES),/Pedra sorteada \(⚫12\)/);
});
test('V11: gale e RED não mostram pedra, sem converter alvo numérico antigo',()=>{
 const rule=validateRule({...simple,galeMax:1});
 const events=run(rule,[1,8,6,7]).events;
 assert.deepEqual(events.map(e=>e.type).slice(0,5),['prealert','clear_prealert','entry','gale1','red']);
 assert.doesNotMatch(eventMessage(events.find(e=>e.type==='red'),rule,PRESET_MESSAGES),/Pedra sorteada/);
 const legacy=validateRule({...simple,targets:[token(12,'number')]});
 assert.equal(run(legacy,[1,8,0]).events.at(-1).type,'gale1');
});
test('V10: interface tem seletor único de pedras, WIN branco e sem seletor antigo',()=>{
 const html=readFileSync(new URL('../public/estrategias.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../public/estrategias.js',import.meta.url),'utf8');
 for(const id of ['stonePicker','useNumbers','winPicker','patternChips','targetChips','saveRule'])assert.ok(html.includes('id="'+id+'"'),id);
 assert.ok(!html.includes('id="tabColors"'));
 assert.ok(js.includes('winWhite'));
});

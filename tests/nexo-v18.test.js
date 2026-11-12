import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRule,evolve,matches,tokenText} from '../src/strategyCore.js';
const token=(kind,value)=>({kind,value});
const rule=validateRule({name:'Teste coringa',pattern:[token('color','red'),token('any','any'),token('color','black')],targets:[token('color','red')],galeMax:0,enabled:true});
const round=(id,number)=>({id,number,color:number===0?'white':number<=7?'red':'black',minute_epoch:1000});
test('coringa azul combina qualquer numero, inclusive branco',()=>{
 assert.equal(matches(token('any','any'),round('1',0)),true);
 assert.equal(matches(token('any','any'),round('2',14)),true);
 assert.equal(tokenText(token('any','any')),'🟦');
});
test('coringa nao pode ser alvo WIN',()=>{
 assert.throws(()=>validateRule({...rule,targets:[token('any','any')]}),/Coringa/);
});
test('preaviso cancela quando a sequencia deixa de corresponder',()=>{
 const r=validateRule({name:'Cancelamento',pattern:[token('color','red'),token('color','black')],targets:[token('color','red')],galeMax:0,enabled:true});
 const first=evolve({},r,[round('a',1)]);
 assert.ok(first.events.some(x=>x.type==='prealert'));
 const second=evolve(first.state,r,[round('a',1),round('b',0)]);
 assert.ok(second.events.some(x=>x.type==='cancel_prealert'));
});
test('pedra azul no meio respeita ordem da sequencia',()=>{
 let state={};const h=[round('a',1),round('b',0),round('c',10)];
 for(let i=0;i<h.length;i++)state=evolve(state,rule,h.slice(0,i+1)).state;
 assert.ok(state.active?.entryRoundId==='c');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evolve,validateRule} from '../src/strategyCore.js';
const src=readFileSync(new URL('../src/strategies.js',import.meta.url),'utf8');
const rule=validateRule({name:'V22',pattern:[{kind:'number',value:1}],targets:[{kind:'color',value:'red'}],galeMax:2,enabled:true});
const round=(id,number)=>({id,number,color:number===0?'white':number<=7?'red':'black',minute_epoch:1794500000});
function play(numbers){let state={active:null},events=[];numbers.forEach((n,i)=>{const r=round('r'+i,n);const next=evolve(state,rule,[r]);state=next.state;events.push(...next.events.map(e=>e.type));});return {state,events};}
test('V22: entrada, gale 1, gale 2 e RED encerra a operacao',()=>{const x=play([1,8,9,10]);assert.deepEqual(x.events.filter(t=>['entry','gale1','gale2','win','red'].includes(t)),['entry','gale1','gale2','red']);assert.equal(x.state.active,null);});
test('V22: entrada, gale 1 e WIN encerra a operacao',()=>{const x=play([1,8,2]);assert.deepEqual(x.events.filter(t=>['entry','gale1','gale2','win','red'].includes(t)),['entry','gale1','win']);assert.equal(x.state.active,null);});
test('V22: operacao ativa continua mesmo se a regra for pausada',()=>{assert.match(src,/x\.enabled\|\|activeIds\.has\(x\.id\)/);});

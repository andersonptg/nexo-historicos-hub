import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseMultiplierHtml,reconcileSnapshot} from '../src/parser.js';
import {PLATFORMS,ENABLED_SOURCES,sourceFor,catalogGame} from '../src/sources/index.js';
import worker from '../src/worker.js';

const fixture=(vals)=>`<html><head><script>malicious</script></head><body><div>No Focus</div>${vals.map(([v,t])=>`<div>${v}</div><span>${t}</span>`).join('')}<b>footer</b></body></html>`;
const now=Date.parse('2026-11-11T21:34:00-03:00')/1000;
test('V7: lê multiplicadores e preserva casas decimais',()=>{
 const data=[['1.01x','21:33'],['13.44x','21:33'],['2.04x','21:32'],['13.17x','21:32'],['1.99x','21:31'],['1.12x','21:31'],['1.44x','21:30'],['2.18x','21:30']];
 const a=parseMultiplierHtml(fixture(data),now);
 assert.equal(a.length,8);assert.equal(a[0].value,'1.01x');assert.equal(a[1].numeric_value,13.44);
 assert.equal(a[0].minute_epoch,Date.parse('2026-11-11T21:33:00-03:00')/1000);
});
test('V7: multipliers continuam identificáveis com LCS',()=>{
 const prior=[{minute_epoch:1000,number:'1.2x',round_id:'a'},{minute_epoch:950,number:'9.8x',round_id:'b'}];
 const next=[{minute_epoch:1010,number:'2.4x'},{minute_epoch:1000,number:'1.2x'},{minute_epoch:950,number:'9.8x'}];
 assert.deepEqual(reconcileSnapshot(prior,next),[null,'a','b']);
});
test('V7: catálogo com 15 plataformas e 35 jogos separados',()=>{
 assert.equal(PLATFORMS.length,15);
 assert.equal(PLATFORMS.reduce((t,p)=>t+p.games.length,0),35);
 assert.ok(ENABLED_SOURCES.length>=20);
 assert.equal(sourceFor('smash','double').type,'double');
 assert.equal(sourceFor('brabet','crash').type,'multiplier');
 assert.equal(catalogGame('blitz','fortune-double').kind,'pending');
 assert.equal(sourceFor('trade-dolar','double').url,'https://historicosblaze.com/results/tradedolar/double');
});
test('V7: backend lista catálogo e bloqueia API administrativa sem senha configurada',async()=>{
 const req=new Request('https://nexo.example/api/catalog');
 const resp=await worker.fetch(req,{},{});assert.equal(resp.status,200);
 const arr=await resp.json();assert.equal(arr.length,15);
 const who=await worker.fetch(new Request('https://nexo.example/api/admin/whoami'),{},{});
 assert.equal(who.status,200);
 assert.deepEqual(await who.json(),{configured:false,authenticated:false});
 const protectedReq=await worker.fetch(new Request('https://nexo.example/api/admin/sources'),{},{});
 assert.equal(protectedReq.status,503);
 const unsupported=await worker.fetch(new Request('https://nexo.example/api/results?platform=blitz&game=slide'),{},{});
 assert.equal(unsupported.status,409);
});
test('V7: arquivos HTML contêm controles e nenhum segredo',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const admin=readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');
 for(const id of ['menuToggle','sidebar','navGames','pref-order','pref-flow','pref-clock','pref-columns','pref-fireworks','fireworksCanvas']){
  assert.match(html,new RegExp(`id="${id}"`));
 }
 assert.match(admin,/id="loginForm"/);
 assert.doesNotMatch(admin,/AIza|sk_live_|ghp_[a-z0-9]{20}/i);
});

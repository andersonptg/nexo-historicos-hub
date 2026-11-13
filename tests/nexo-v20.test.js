import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const tg=readFileSync(new URL('../src/telegram.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/estrategias.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/estrategias.html',import.meta.url),'utf8');
test('V20: destinos persistidos no mesmo settings D1 com validacao',()=>{
 assert.match(tg,/cleanDestinations/);assert.match(tg,/allowedChat\(String\(x\?\.id/);
 assert.match(tg,/\/api\/telegram\/destinations'&&request\.method==='PUT'/);
});
test('V20: discovery por updates sem expor token',()=>{
 assert.match(tg,/\/api\/telegram\/destinations\/discover/);
 assert.match(tg,/my_chat_member/);assert.doesNotMatch(html,/TELEGRAM_BOT_TOKEN\s*=/);
});
test('V20: escolha de destino para indicacao e placar',()=>{
 assert.match(tg,/targetForRequest\(data,await getTelegramSettings\(db\),env\)/);
 assert.match(ui,/destination:\$\('manualDestination'\)\.value/);
 assert.match(html,/id="manualDestination"/);
});

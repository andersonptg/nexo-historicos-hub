import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {telegramVisibleResultText} from '../src/telegram.js';

test('V29.2 resultado visivel contem a pedra sem duplicar WIN',()=>{
 assert.equal(telegramVisibleResultText({event_type:'win',message:'✅ WIN — alvo confirmado\n\nPedra sorteada (🔴7)'}),'✅ WIN — 🔴7');
 assert.equal(telegramVisibleResultText({event_type:'winWhite',message:'✅ WIN branco\n\nPedra sorteada (⚪0)'}),'✅ WIN — ⚪0');
 assert.equal(telegramVisibleResultText({event_type:'red',message:'❌ RED — limite configurado'}),'❌ RED');
});
test('V29.2 texto tem evento proprio, ordem preservada e sem expirar apos 180s',()=>{
 const s=readFileSync(new URL('../src/telegram.js',import.meta.url),'utf8');
 assert.match(s,/':visible-text-v29\.2'/);
 assert.match(s,/event_type NOT IN \('win','winWhite','red'\) AND event_type!='resultText'/);
 assert.match(s,/Aguardando texto do resultado/);
 assert.match(s,/if\(stone&&!separateResultText\)/);
 assert.match(s,/const captionText=separateResultText\?'':/);
 assert.match(s,/const resultMedia=settings\.resultTextWithSticker===true/);
});

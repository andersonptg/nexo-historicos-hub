// Coleta apenas texto PUBLICAMENTE exibido. Não acessa APIs protegidas.
const PUBLIC_MARKERS = new Set(['sem destaque', 'no focus']);
const TIME_RE = /^(?:[01]?\d|2[0-3]):[0-5]\d$/;

function plainText(value) {
  // HTML text nodes. Scripts/styles are removed before tokenization.
  return value
    .replace(/&nbsp;|&#160;|&#xA0;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .trim();
}
export function visibleTokens(html) {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<img\b[^>]*\balt\s*=\s*["'](?:branco|white)["'][^>]*>/gi, '>BRANCO<');
  const tokens = [];
  // Emulates HTMLParser.handle_data for plain text between tags, omitting empty text.
  for (const match of cleaned.matchAll(/>([^<>]+)</g)) {
    const value = plainText(match[1]);
    if (value) tokens.push(value);
  }
  return tokens;
}

// Results are approximate minute-level readings. No official round IDs or seconds.
export function parseSmashHtml(html, nowEpoch = Math.floor(Date.now()/1000)) {
  if (typeof html !== 'string' || html.length < 200) throw new Error('HTML público vazio');
  const tokens = visibleTokens(html);
  const i = tokens.findIndex(x => PUBLIC_MARKERS.has(x.toLowerCase()));
  if (i < 0) throw new Error('Marcador Sem Destaque ausente. Layout da fonte pode ter mudado.');
  const pairs = [];
  for (let p=i+1; p+1<tokens.length && pairs.length<200; p+=2) {
    const value=tokens[p];
    const clock=tokens[p+1];
    const number = /^(branco|white)$/i.test(value) ? 0 : (/^\d{1,2}$/.test(value) ? Number(value) : NaN);
    if (!Number.isInteger(number) || number < 0 || number > 14 || !TIME_RE.test(clock)) break;
    pairs.push({number, clock});
  }
  if (pairs.length < 8) throw new Error(`Somente ${pairs.length} resultados válidos encontrados; coleta interrompida`);
  // São Paulo is UTC-03 in 2026; use date parts from Intl to avoid server-timezone dependence.
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(nowEpoch * 1000));
  const part = name => Number(dateParts.find(x => x.type === name).value);
  const localDay = Date.UTC(part('year'), part('month') - 1, part('day'))/1000;
  let dayUtc = localDay;
  let prev = Infinity;
  const out=[];
  for (const {number, clock} of pairs) {
    const [hour, minute] = clock.split(':').map(Number);
    let when = dayUtc + hour*3600 + minute*60 + 3*3600;
    // First entry may refer to previous date; pages are newest -> oldest.
    if ((prev === Infinity && when > nowEpoch + 180) || (prev !== Infinity && when > prev)) {
      dayUtc -= 86400; when -= 86400;
    }
    prev=when;
    out.push({minute_epoch:when, number, color:number===0?'white':number<=7?'red':'black'});
  }
  return out;
}

// LCS preserves local identities across overlapping, shifting public snapshots.
export function reconcileSnapshot(previous, current) {
  const key=x=>`${x.minute_epoch}:${x.number}`;
  const a=previous.map(key), b=current.map(key);
  const m=a.length, n=b.length;
  const dp=Array.from({length:m+1},()=>new Uint16Array(n+1));
  for(let i=m-1;i>=0;i--) for(let j=n-1;j>=0;j--) {
    dp[i][j]=a[i]===b[j]?1+dp[i+1][j+1]:Math.max(dp[i+1][j],dp[i][j+1]);
  }
  const ids=new Array(n).fill(null);
  let i=0,j=0;
  while(i<m&&j<n){
    if(a[i]===b[j]){ids[j]=previous[i].round_id;i++;j++;}
    else if(dp[i+1][j]>=dp[i][j+1])i++; else j++;
  }
  // For interrupted sessions, match only uniquely identifiable minute+number pairs.
  const countsA=new Map(),countsB=new Map(), oldIndex=new Map();
  a.forEach((x,k)=>{countsA.set(x,(countsA.get(x)||0)+1);oldIndex.set(x,previous[k].round_id);});
  b.forEach(x=>countsB.set(x,(countsB.get(x)||0)+1));
  for(let k=0;k<n;k++) if(!ids[k]&&countsA.get(b[k])===1&&countsB.get(b[k])===1) ids[k]=oldIndex.get(b[k]);
  return ids;
}

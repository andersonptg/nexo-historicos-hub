import {reconcileSnapshot} from './parser.js';
import {ENABLED_SOURCES,PLATFORMS,sourceFor,catalogGame} from './sources/index.js';
import {collectMultiplier,queryMultiplier,exportMultiplier} from './multi.js';
import {adminHandler,sourceEnabled} from './admin.js';
const HEADERS = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const stamp=()=>Math.floor(Date.now()/1000);
const chunk=(arr,n)=>Array.from({length:Math.ceil(arr.length/n)},(_,i)=>arr.slice(i*n,(i+1)*n));

async function readSync(db,source){
 return (await db.prepare('SELECT * FROM sync_status WHERE source_id=?').bind(source.id).first())||null;
}

async function collect(env,source=ENABLED_SOURCES[0]){
 const db=env.DB;
 const started=stamp();
 // Prevent overlapping updates. Cron is once per minute and no external request can trigger it without admin secret.
 await db.prepare(`INSERT INTO sync_status(source_id,last_attempt,message) VALUES(?,?,?)
   ON CONFLICT(source_id) DO UPDATE SET last_attempt=excluded.last_attempt,message=excluded.message`).bind(source.id,started,'Consultando fonte').run();
 try{
  const resp=await fetch(source.url, {headers:{'Accept':'text/html','Cache-Control':'no-cache','User-Agent':'Mozilla/5.0 (compatible; NexoHistoricos/1.0; public monitoring)'},cf:{cacheTtl:0},redirect:'follow',signal:AbortSignal.timeout(14000)});
  if(!resp.ok)throw new Error(`Fonte pública HTTP ${resp.status}`);
  const len=Number(resp.headers.get('content-length')||0);
  if(len>2_000_000)throw new Error('HTML acima de 2MB');
  const html=await resp.text();
  if(html.length>2_000_000)throw new Error('HTML acima de 2MB');
  const records=source.parse(html,started);
  if(records[0].minute_epoch>started+180)throw new Error('Horário da fonte fora do fuso esperado');
  // Cache compacto evita regravar 200 linhas no D1 a cada coleta.
  const snapshot = await db.prepare('SELECT payload FROM snapshot_cache WHERE source_id=?').bind(source.id).first();
  const old = snapshot ? JSON.parse(snapshot.payload)
    : (await db.prepare('SELECT round_id,minute_epoch,number FROM snapshots WHERE source_id=? ORDER BY ordinal').bind(source.id).all()).results;
  if (!Array.isArray(old)) throw new Error('Cache de resultados invalido');
  const mapped=reconcileSnapshot(old,records);
  const known=new Set(mapped.filter(Boolean));
  const newRows=[];
  for(let i=0;i<records.length;i++)if(!mapped[i]){
    let uid=`public:${started}:${String(999-i).padStart(3,'0')}:${crypto.randomUUID()}`;
    while(known.has(uid))uid='public:'+crypto.randomUUID();
    mapped[i]=uid;known.add(uid);
    newRows.push({...records[i],id:uid});
  }
  // Batch statements form one D1 transaction. Under 100 parameters per SQL statement.
  const statements=[];
  for(const group of chunk(newRows,9)) {
   statements.push(db.prepare(`INSERT OR IGNORE INTO rounds(id,platform,game,number,color,minute_epoch,official_period,exact_epoch,precision,source,first_seen) VALUES ${group.map(()=>'(?,?,?,?,?,?,?,?,?,?,?)').join(',')}`)
     .bind(...group.flatMap(x=>[x.id,source.platform,source.game,x.number,x.color,x.minute_epoch,null,null,'minute',source.label,started])));
  }
  // Atualiza o cache somente quando o snapshot mudou, ou durante a migracao inicial.
  if (newRows.length || !snapshot) {
    const compact = records.map((x,i)=>({round_id:mapped[i],minute_epoch:x.minute_epoch,number:x.number}));
    statements.push(db.prepare(`INSERT INTO snapshot_cache(source_id,payload,last_updated) VALUES(?,?,?)
      ON CONFLICT(source_id) DO UPDATE SET payload=excluded.payload,last_updated=excluded.last_updated`)
      .bind(source.id,JSON.stringify(compact),started));
  }
  const latest=records[0].minute_epoch;
  const ageMin=Math.max(0,Math.floor((started-latest)/60));
  const message=ageMin>10 ? `Fonte atrasada cerca de ${ageMin} min` : `Fonte pública consultada; resultado mais recente há ~${ageMin} min`;
  statements.push(db.prepare(`UPDATE sync_status SET last_success=?,latest_minute=?,last_new=?,last_count=?,message=? WHERE source_id=?`)
    .bind(started,latest,newRows.length,records.length,message,source.id));
  await db.batch(statements);
  return {ok:true,new:newRows.length,count:records.length,latest,message};
 }catch(e){
  const error=String(e?.message||e).slice(0,350);
  await db.prepare('UPDATE sync_status SET message=? WHERE source_id=?').bind(error,source.id).run();
  return {ok:false,error};
 }
}


// Uma coleta no maximo a cada 20 s por fonte, mesmo com varias abas ou visitantes.
// O bloqueio fica no D1 e nao depende da memoria de cada servidor Cloudflare.
async function guardedCollect(env,source=ENABLED_SOURCES[0]){
 if(!(await sourceEnabled(env,source)))return {ok:true,paused:true};
 const now=stamp();
 await env.DB.prepare('INSERT OR IGNORE INTO collection_leases(source_id,next_allowed,started_at) VALUES(?,?,?)')
   .bind(source.id,0,0).run();
 const claim=await env.DB.prepare(`UPDATE collection_leases SET next_allowed=?,started_at=?
   WHERE source_id=? AND next_allowed<=?`)
   .bind(now+20,now,source.id,now).run();
 if(Number(claim.meta?.changes||0)!==1)return {ok:true,skipped:true};
 return source.type==='multiplier'?collectMultiplier(env,source):collect(env,source);
}

async function queryResults(env,url){
 const platform=url.searchParams.get('platform')||'smash';
 const game=url.searchParams.get('game')||'double';
 const precision=url.searchParams.get('precision')||'minute';
 if(!/^[a-z0-9_-]{1,30}$/.test(platform)||!/^[a-z0-9_-]{1,30}$/.test(game)||!['minute','second'].includes(precision))return json({error:'Filtro inválido'},400);
 const limit=Math.min(250,Math.max(1,Number(url.searchParams.get('limit')||150)||150));
 const offset=Math.min(100000,Math.max(0,Number(url.searchParams.get('offset')||0)||0));
 const clauses=['platform=?','game=?','precision=?'];const params=[platform,game,precision];
 const color=url.searchParams.get('color');
 if(color && ['red','black','white'].includes(color)){clauses.push('color=?');params.push(color);}
 const num=url.searchParams.get('number');
 if(num!==null && /^\d{1,2}$/.test(num)&&Number(num)<=14){clauses.push('number=?');params.push(Number(num));}
 const from=url.searchParams.get('from');
 const to=url.searchParams.get('to');
 if(from && /^\d{9,11}$/.test(from)){clauses.push('minute_epoch>=?');params.push(Number(from));}
 if(to && /^\d{9,11}$/.test(to)){clauses.push('minute_epoch<=?');params.push(Number(to));}
 const where=clauses.join(' AND ');
 const order=url.searchParams.get('order')==='asc'?'ASC':'DESC';
 const rows=(await env.DB.prepare(`SELECT id,platform,game,number,color,minute_epoch,official_period,exact_epoch,precision,source
   FROM rounds WHERE ${where} ORDER BY minute_epoch ${order},id ${order} LIMIT ? OFFSET ?`).bind(...params,limit,offset).all()).results;
 // Ordens reais das pedras com mesmo minuto vêm do snapshot público, não do UUID.
 if(offset===0&&limit>1&&rows.length){
  const snap=await env.DB.prepare('SELECT payload FROM snapshot_cache WHERE source_id=?')
   .bind(`historicosblaze:${platform}:${game}`).first();
  if(snap?.payload){
   const rank=new Map(JSON.parse(snap.payload).map((x,i)=>[x.round_id,i]));
   rows.sort((a,b)=>a.minute_epoch!==b.minute_epoch
    ? (order==='ASC'?a.minute_epoch-b.minute_epoch:b.minute_epoch-a.minute_epoch)
    : (rank.has(a.id)&&rank.has(b.id)?(order==='ASC'?rank.get(b.id)-rank.get(a.id):rank.get(a.id)-rank.get(b.id)):0));
  }
 }
 const found=url.searchParams.get('no_count')==='1'?null:await env.DB.prepare(`SELECT COUNT(*) AS total,SUM(CASE WHEN color='red' THEN 1 ELSE 0 END) AS red,SUM(CASE WHEN color='black' THEN 1 ELSE 0 END) AS black,SUM(CASE WHEN color='white' THEN 1 ELSE 0 END) AS white FROM rounds WHERE ${where}`).bind(...params).first();
 return json({items:rows,counts:found,checked_at:stamp(),offset,limit});
}
async function exportCsv(env,url){
 const platform=url.searchParams.get('platform')||'smash';
 const game=url.searchParams.get('game')||'double';
 const precision=url.searchParams.get('precision')||'minute';
 if(!['minute','second'].includes(precision)||!/^[a-z0-9-]{1,40}$/.test(platform)||game!=='double')return json({error:'Filtro inválido'},400);
 const rows=(await env.DB.prepare('SELECT number,color,minute_epoch,official_period,exact_epoch,source FROM rounds WHERE platform=? AND game=? AND precision=? ORDER BY minute_epoch DESC LIMIT 5000').bind(platform,game,precision).all()).results;
 const esc=x=>'"'+String(x??'').replace(/"/g,'""')+'"';
 const out='numero,cor,minuto_epoch,periodo_oficial,segundo_exato_epoch,origem\n'+rows.map(x=>[x.number,x.color,x.minute_epoch,x.official_period,x.exact_epoch,x.source].map(esc).join(',')).join('\n');
 return new Response('\ufeff'+out,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${platform}-${game}-${precision}.csv"`,'Cache-Control':'no-store'}});
}

export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url), path=url.pathname;
  try {
   if(path==='/admin')return Response.redirect(url.origin+'/admin.html',302);
   if(path.startsWith('/api/admin/'))return adminHandler(request,env,url);
   if(path==='/api/platforms'||path==='/api/catalog')return json(PLATFORMS);
   if(path==='/api/version'){
    const source=sourceFor(url.searchParams.get('platform')||'smash',url.searchParams.get('game')||'double');
    if(!source)return json({connected:false,version:null});
    const row=await env.DB.prepare('SELECT last_success,last_new FROM sync_status WHERE source_id=?').bind(source.id).first();
    return json({connected:true,version:row?.last_success||0,changed:row?.last_new||0});
   }
   if(path==='/api/status'){
    const platform=url.searchParams.get('platform')||'smash',game=url.searchParams.get('game')||'double';
    const source=sourceFor(platform,game),entry=catalogGame(platform,game);
    return json({source:source?.id||null,source_url:source?.url||entry?.public_url||null,
      connected:!!source,game_kind:entry?.kind||'pending',enabled:source?await sourceEnabled(env,source):false,
      cron_interval_seconds:60,ui_interval_seconds:5,active_collection_minimum_seconds:20,
      precision_available:'minute',kind:'third-party-public',status:source?await readSync(env.DB,source):null,now:stamp()});
   }
   if(path==='/api/tick'&&request.method==='POST'){
    // A interface so pode acionar coletas da propria origem.
    const origin=request.headers.get('Origin');
    const site=request.headers.get('Sec-Fetch-Site');
    if((origin&&origin!==url.origin)||(site&&site!=='same-origin'&&site!=='none'))
      return json({error:'Origem nao permitida'},403);
    const platform=url.searchParams.get('platform')||'smash',game=url.searchParams.get('game')||'double';
    const source=sourceFor(platform,game);
    if(!source)return json({error:'Fonte ainda não integrada'},409);
    ctx.waitUntil(guardedCollect(env,source));
    return json({ok:true,queued:true,source:source.id,minimum_interval_seconds:20},202);
   }
   if(path==='/api/results'){
    const p=url.searchParams.get('platform')||'smash',g=url.searchParams.get('game')||'double';
    const source=sourceFor(p,g);
    if(!source)return json({error:'Aguardando integração desta fonte',items:[],counts:{total:0,red:0,black:0,white:0}},409);
    return source.type==='multiplier'?queryMultiplier(env,url):queryResults(env,url);
   }
   if(path==='/api/export.csv'){
    const p=url.searchParams.get('platform')||'smash',g=url.searchParams.get('game')||'double';
    const source=sourceFor(p,g);
    if(!source)return json({error:'Aguardando integração'},409);
    return source.type==='multiplier'?exportMultiplier(env,url):exportCsv(env,url);
   }
   if(path==='/api/health')return json({ok:true,server:stamp()});
   if(path.startsWith('/api/'))return json({error:'Rota não encontrada'},404);
   return env.ASSETS.fetch(request);
  } catch(e){return json({error:'Erro no servidor',detail:String(e.message||e).slice(0,180)},500);}
 },
 async scheduled(controller,env,ctx){
  // Smash Double tem coleta de referência a cada minuto. Outros jogos rodam
  // em rodízio para respeitar os limites gratuitos e a fonte externa.
  const primary=sourceFor('smash','double');
  const others=ENABLED_SOURCES.filter(x=>x!==primary);
  const turn=others.length?others[Math.floor(Date.now()/60000)%others.length]:null;
  for(const s of [primary,turn])if(s)ctx.waitUntil(guardedCollect(env,s));
 }
};

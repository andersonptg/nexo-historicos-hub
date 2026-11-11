import {reconcileSnapshot} from './parser.js';
import {ENABLED_SOURCES,PLATFORMS} from './sources/index.js';
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
  const resp=await fetch(source.url, {headers:{'Accept':'text/html','User-Agent':'Mozilla/5.0 (compatible; NexoHistoricos/1.0; public monitoring)'},redirect:'follow',signal:AbortSignal.timeout(14000)});
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
    let uid='public:'+crypto.randomUUID();
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
 const now=stamp();
 await env.DB.prepare('INSERT OR IGNORE INTO collection_leases(source_id,next_allowed,started_at) VALUES(?,?,?)')
   .bind(source.id,0,0).run();
 const claim=await env.DB.prepare(`UPDATE collection_leases SET next_allowed=?,started_at=?
   WHERE source_id=? AND next_allowed<=?`)
   .bind(now+20,now,source.id,now).run();
 if(Number(claim.meta?.changes||0)!==1)return {ok:true,skipped:true};
 return collect(env,source);
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
 const rows=(await env.DB.prepare(`SELECT id,platform,game,number,color,minute_epoch,official_period,exact_epoch,precision,source
   FROM rounds WHERE ${where} ORDER BY minute_epoch DESC,id DESC LIMIT ? OFFSET ?`).bind(...params,limit,offset).all()).results;
 const found=url.searchParams.get('no_count')==='1'?null:await env.DB.prepare(`SELECT COUNT(*) AS total,SUM(CASE WHEN color='red' THEN 1 ELSE 0 END) AS red,SUM(CASE WHEN color='black' THEN 1 ELSE 0 END) AS black,SUM(CASE WHEN color='white' THEN 1 ELSE 0 END) AS white FROM rounds WHERE ${where}`).bind(...params).first();
 return json({items:rows,counts:found,checked_at:stamp(),offset,limit});
}
async function exportCsv(env,url){
 const platform=url.searchParams.get('platform')||'smash';
 const game=url.searchParams.get('game')||'double';
 const precision=url.searchParams.get('precision')||'minute';
 if(!['minute','second'].includes(precision)||!['smash','brabet','blitz'].includes(platform)||game!=='double')return json({error:'Filtro inválido'},400);
 const rows=(await env.DB.prepare('SELECT number,color,minute_epoch,official_period,exact_epoch,source FROM rounds WHERE platform=? AND game=? AND precision=? ORDER BY minute_epoch DESC LIMIT 5000').bind(platform,game,precision).all()).results;
 const esc=x=>'"'+String(x??'').replace(/"/g,'""')+'"';
 const out='numero,cor,minuto_epoch,periodo_oficial,segundo_exato_epoch,origem\n'+rows.map(x=>[x.number,x.color,x.minute_epoch,x.official_period,x.exact_epoch,x.source].map(esc).join(',')).join('\n');
 return new Response('\ufeff'+out,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${platform}-${game}-${precision}.csv"`,'Cache-Control':'no-store'}});
}

export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url), path=url.pathname;
  try {
   if(path==='/api/platforms')return json(PLATFORMS);
   if(path==='/api/status'){
    const source=ENABLED_SOURCES.find(s=>s.platform===(url.searchParams.get('platform')||'smash') && s.game===(url.searchParams.get('game')||'double'));
    return json({source:source?.id||null,source_url:source?.url||null,cron_interval_seconds:60,ui_interval_seconds:5,active_collection_minimum_seconds:20,kind:'third-party-public',status:source?await readSync(env.DB,source):null,now:stamp()});
   }
   if(path==='/api/tick'&&request.method==='POST'){
    // A interface so pode acionar coletas da propria origem.
    const origin=request.headers.get('Origin');
    const site=request.headers.get('Sec-Fetch-Site');
    if((origin&&origin!==url.origin)||(site&&site!=='same-origin'&&site!=='none'))
      return json({error:'Origem nao permitida'},403);
    ctx.waitUntil(guardedCollect(env));
    return json({ok:true,queued:true,minimum_interval_seconds:20},202);
   }
   if(path==='/api/results')return await queryResults(env,url);
   if(path==='/api/export.csv')return await exportCsv(env,url);
   if(path==='/api/health')return json({ok:true,server:stamp()});
   if(path==='/api/sync'&&request.method==='POST'){
    if(!env.ADMIN_TOKEN)return json({error:'Sincronização manual não configurada'},503);
    if(request.headers.get('X-Admin-Token')!==env.ADMIN_TOKEN)return json({error:'Não autorizado'},401);
    return json(await collect(env));
   }
   if(path.startsWith('/api/'))return json({error:'Rota não encontrada'},404);
   return env.ASSETS.fetch(request);
  } catch(e){return json({error:'Erro no servidor',detail:String(e.message||e).slice(0,180)},500);}
 },
 async scheduled(controller,env,ctx){for(const source of ENABLED_SOURCES)ctx.waitUntil(guardedCollect(env,source));}
};

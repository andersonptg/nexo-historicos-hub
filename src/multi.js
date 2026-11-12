import {shouldPruneHistory,historyPruneStatements} from './retention.js';
import {reconcileSnapshot} from './parser.js';
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers});
const now=()=>Math.floor(Date.now()/1000);
const chunks=(a,n)=>Array.from({length:Math.ceil(a.length/n)},(_,i)=>a.slice(i*n,(i+1)*n));
const valid=id=>/^[a-z0-9-]{1,40}$/.test(id||'');

export async function collectMultiplier(env,source){
 const db=env.DB,started=now();
 await db.prepare(`INSERT INTO sync_status(source_id,last_attempt,message) VALUES(?,?,?)
 ON CONFLICT(source_id) DO UPDATE SET last_attempt=excluded.last_attempt,message=excluded.message`)
  .bind(source.id,started,'Consultando fonte').run();
 try{
  const resp=await fetch(source.url,{headers:{'Accept':'text/html','Cache-Control':'no-cache','User-Agent':'Mozilla/5.0 (compatible; NexoHistoricos/1.0; public monitoring)'},cf:{cacheTtl:0},redirect:'follow',signal:AbortSignal.timeout(14000)});
  if(!resp.ok)throw new Error(`Fonte pública HTTP ${resp.status}`);
  if(Number(resp.headers.get('content-length')||0)>2_000_000)throw new Error('Resposta acima de 2MB');
  const html=await resp.text();if(html.length>2_000_000)throw new Error('HTML acima de 2MB');
  const rows=source.parse(html,started);
  if(rows[0].minute_epoch>started+180)throw new Error('Horário futuro detectado na fonte');
  const cache=await db.prepare('SELECT payload FROM snapshot_cache WHERE source_id=?').bind(source.id).first();
  const old=cache?JSON.parse(cache.payload):[];
  if(!Array.isArray(old))throw new Error('Snapshot inválido');
  const ids=reconcileSnapshot(old,rows);
  const fresh=[];
  for(let i=0;i<rows.length;i++)if(!ids[i]){
   ids[i]=`public:${started}:${String(999-i).padStart(3,'0')}:${crypto.randomUUID()}`;
   fresh.push({...rows[i],id:ids[i]});
  }
  const stmt=[];
  for(const grp of chunks(fresh,12))stmt.push(db.prepare(`INSERT OR IGNORE INTO multiplier_rounds
   (id,platform,game,value,numeric_value,minute_epoch,source,first_seen) VALUES ${grp.map(()=>'(?,?,?,?,?,?,?,?)').join(',')}`)
   .bind(...grp.flatMap(x=>[x.id,source.platform,source.game,x.value,x.numeric_value,x.minute_epoch,source.label,started])));
  // Limpeza transacional do historico de multiplicadores; não modifica eventos de estratégia.
  if(await shouldPruneHistory(db,source,fresh.length>0)){
   stmt.push(...historyPruneStatements(db,source,'multiplier_rounds',started));
  }
  if(fresh.length||!cache){
   const payload=rows.map((x,i)=>({round_id:ids[i],minute_epoch:x.minute_epoch,number:x.number}));
   stmt.push(db.prepare(`INSERT INTO snapshot_cache(source_id,payload,last_updated) VALUES(?,?,?)
    ON CONFLICT(source_id) DO UPDATE SET payload=excluded.payload,last_updated=excluded.last_updated`)
    .bind(source.id,JSON.stringify(payload),started));
  }
  const latest=rows[0].minute_epoch,age=Math.max(0,Math.floor((started-latest)/60));
  const message=age>10?`Fonte atrasada cerca de ${age} min`:`Fonte pública consultada; resultado mais recente há ~${age} min`;
  stmt.push(db.prepare(`UPDATE sync_status SET last_success=?,latest_minute=?,last_new=?,last_count=?,message=? WHERE source_id=?`)
   .bind(started,latest,fresh.length,rows.length,message,source.id));
  await db.batch(stmt);
  return {ok:true,new:fresh.length,count:rows.length,latest,message};
 }catch(e){
  const error=String(e?.message||e).slice(0,300);
  await db.prepare('UPDATE sync_status SET message=? WHERE source_id=?').bind(error,source.id).run();
  return {ok:false,error};
 }
}

function filters(url){
 const platform=url.searchParams.get('platform'),game=url.searchParams.get('game');
 if(!valid(platform)||!valid(game))throw new Error('Jogo inválido');
 const where=['platform=?','game=?'],params=[platform,game];
 for(const [name,operator] of [['from','>='],['to','<=']]){
  const input=url.searchParams.get(name);
  if(input&&/^\d{9,11}$/.test(input)){
   where.push(`minute_epoch${operator}?`);params.push(Number(input));
  }
 }
 return {where:where.join(' AND '),params,platform,game};
}
export async function queryMultiplier(env,url){
 let f;try{f=filters(url);}catch(e){return json({error:e.message},400)}
 const limit=Math.min(250,Math.max(1,Number(url.searchParams.get('limit')||150)||150));
 const offset=Math.min(100000,Math.max(0,Number(url.searchParams.get('offset')||0)||0));
 const dir=url.searchParams.get('order')==='asc'?'ASC':'DESC';
 const items=(await env.DB.prepare(`SELECT id,platform,game,value,numeric_value,minute_epoch,source,first_seen
 FROM multiplier_rounds WHERE ${f.where} ORDER BY minute_epoch ${dir},id ${dir} LIMIT ? OFFSET ?`)
  .bind(...f.params,limit,offset).all()).results;
 const counts=url.searchParams.get('no_count')==='1'?null:await env.DB.prepare(`SELECT
 COUNT(*) total,SUM(CASE WHEN numeric_value < 2 THEN 1 ELSE 0 END) red,
 SUM(CASE WHEN numeric_value >= 2 AND numeric_value < 10 THEN 1 ELSE 0 END) black,
 SUM(CASE WHEN numeric_value >= 10 THEN 1 ELSE 0 END) white
 FROM multiplier_rounds WHERE ${f.where}`).bind(...f.params).first();
 return json({items:items.map(x=>({...x,precision:'minute',color:x.numeric_value>=10?'high':x.numeric_value>=2?'mid':'low'})),counts,checked_at:now(),offset,limit,kind:'multiplier'});
}
export async function exportMultiplier(env,url){
 let f;try{f=filters(url);}catch(e){return json({error:e.message},400)}
 const rows=(await env.DB.prepare(`SELECT value,minute_epoch,source FROM multiplier_rounds WHERE ${f.where} ORDER BY minute_epoch DESC,id DESC LIMIT 5000`).bind(...f.params).all()).results;
 const esc=x=>'"'+String(x??'').replace(/"/g,'""')+'"';
 return new Response('\ufeffmultiplicador,minuto_epoch,fonte\n'+rows.map(x=>[x.value,x.minute_epoch,x.source].map(esc).join(',')).join('\n'),
 {headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${f.platform}-${f.game}.csv"`,'Cache-Control':'no-store'}});
}

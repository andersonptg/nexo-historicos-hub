import {ENABLED_SOURCES} from './sources/index.js';
const HEADER={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json=(obj,status=200,extra={})=>new Response(JSON.stringify(obj),{status,headers:{...HEADER,...extra}});
const now=()=>Math.floor(Date.now()/1000);
const enc=new TextEncoder();
async function hmac(password,message){
 const key=await crypto.subtle.importKey('raw',enc.encode(password),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(message)));
 return Array.from(bytes).map(x=>x.toString(16).padStart(2,'0')).join('');
}
function eq(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;
 let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
const readCookie=request=>(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('nexo_admin='))?.slice(11)||'';
async function authorized(request,env){
 if(!env.ADMIN_TOKEN||env.ADMIN_TOKEN.length<16)return false;
 const cookie=readCookie(request),parts=cookie.split('.');if(parts.length!==2)return false;
 const expires=Number(parts[0]);if(!Number.isInteger(expires)||expires<now()||expires>now()+28800)return false;
 return eq(parts[1],await hmac(env.ADMIN_TOKEN,'session:'+parts[0]));
}
async function accessKey(request,env){
 const ip=request.headers.get('CF-Connecting-IP')||'unknown';
 return (await hmac(env.ADMIN_TOKEN,'login:'+ip)).slice(0,40);
}
const sameOrigin=(request)=>{const origin=request.headers.get('Origin'),site=request.headers.get('Sec-Fetch-Site');
 return (!origin||origin===new URL(request.url).origin)&&(!site||site==='same-origin'||site==='none');};
const cookieAttrs='Path=/; HttpOnly; Secure; SameSite=Strict';
export async function adminHandler(request,env,url){
 const path=url.pathname;
 if(path==='/api/admin/whoami')return json({configured:!!(env.ADMIN_TOKEN&&env.ADMIN_TOKEN.length>=16),authenticated:await authorized(request,env)});
 if(!env.ADMIN_TOKEN||env.ADMIN_TOKEN.length<16)return json({error:'Defina ADMIN_TOKEN como segredo no Worker antes de habilitar o painel.'},503);
 if(request.method==='POST'&&!sameOrigin(request))return json({error:'Origem recusada'},403);
 if(path==='/api/admin/login'&&request.method==='POST'){
  const key=await accessKey(request,env),t=now();
  const old=await env.DB.prepare('SELECT attempts,blocked_until FROM admin_login_attempts WHERE key=?').bind(key).first();
  if(old?.blocked_until>t)return json({error:'Muitas tentativas. Tente mais tarde.'},429);
  let data;try{data=await request.json();}catch{return json({error:'Requisição inválida'},400)}
  if(typeof data.password!=='string'||data.password.length>256)return json({error:'Senha inválida'},400);
  const hashA=await hmac(env.ADMIN_TOKEN,data.password),hashB=await hmac(env.ADMIN_TOKEN,env.ADMIN_TOKEN);
  if(!eq(hashA,hashB)){
   const tries=(Number(old?.updated_at||0)<t-900?0:Number(old?.attempts||0))+1;
   await env.DB.prepare(`INSERT INTO admin_login_attempts(key,attempts,blocked_until,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET attempts=excluded.attempts,blocked_until=excluded.blocked_until,updated_at=excluded.updated_at`)
    .bind(key,tries,tries>=5?t+900:0,t).run();
   return json({error:'Senha incorreta'},401);
  }
  await env.DB.prepare('DELETE FROM admin_login_attempts WHERE key=?').bind(key).run();
  const exp=String(t+28800),sig=await hmac(env.ADMIN_TOKEN,'session:'+exp);
  return json({authenticated:true},200,{'Set-Cookie':`nexo_admin=${exp}.${sig}; Max-Age=28800; ${cookieAttrs}`});
 }
 if(!(await authorized(request,env)))return json({error:'Sessão administrativa necessária'},401);
 if(path==='/api/admin/logout'&&request.method==='POST')return json({authenticated:false},200,{'Set-Cookie':`nexo_admin=; Max-Age=0; ${cookieAttrs}`});
 if(path==='/api/admin/sources'&&request.method==='GET'){
  const statuses=(await env.DB.prepare('SELECT source_id,last_attempt,last_success,latest_minute,last_new,last_count,message FROM sync_status').all()).results;
  const controls=(await env.DB.prepare('SELECT source_id,enabled FROM source_controls').all()).results;
  return json({items:ENABLED_SOURCES.map(s=>({id:s.id,platform:s.platform,game:s.game,type:s.type,url:s.url,
   enabled:controls.find(c=>c.source_id===s.id)?.enabled!==0,status:statuses.find(st=>st.source_id===s.id)||null})),now:now()});
 }
 if(path==='/api/admin/control'&&request.method==='POST'){
  let body;try{body=await request.json();}catch{return json({error:'JSON inválido'},400)}
  if(!ENABLED_SOURCES.some(s=>s.id===body?.id)||typeof body.enabled!=='boolean')return json({error:'Fonte inválida'},400);
  await env.DB.prepare(`INSERT INTO source_controls(source_id,enabled,updated_at) VALUES(?,?,?)
  ON CONFLICT(source_id) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at`)
   .bind(body.id,body.enabled?1:0,now()).run();
  return json({ok:true,source:body.id,enabled:body.enabled});
 }
 return json({error:'Rota administrativa não encontrada'},404);
}
export async function sourceEnabled(env,source){
 const control=await env.DB.prepare('SELECT enabled FROM source_controls WHERE source_id=?').bind(source.id).first();
 return control?.enabled!==0;
}

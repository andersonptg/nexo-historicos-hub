// NEXO V29: zerar apenas a contagem visual, nunca apagar eventos.
export const saoPauloDayStart=(now=Math.floor(Date.now()/1000))=>{
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
  timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'
 }).formatToParts(new Date(now*1000)).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
 // Brasil não utiliza horário de verão atualmente (2026); meia-noite BRT=03:00 UTC.
 return Math.floor(Date.UTC(parts.year,parts.month-1,parts.day,3,0,0)/1000);
};
export const scoreCutoff=(settings={},now=Math.floor(Date.now()/1000))=>{
 const manual=Number.isFinite(Number(settings.scoreResetAt))?Math.max(0,Math.floor(Number(settings.scoreResetAt))):0;
 return settings.scoreResetMode==='manual'?manual:Math.max(manual,saoPauloDayStart(now));
};

// NEXO V12: retained live history is bounded per platform/game.
// Only the raw result tables are pruned. Strategies, alerts and Telegram logs stay intact.
export const ROUND_HISTORY_LIMIT = 500;

export async function shouldPruneHistory(db,source,hasNewRows){
 if(hasNewRows)return true;
 const row=await db.prepare('SELECT source_id FROM history_retention_state WHERE source_id=?').bind(source.id).first();
 return !row;
}

export function historyPruneStatements(db,source,table,now){
 if(table!=='rounds'&&table!=='multiplier_rounds')throw Error('Unexpected history table');
 const keepNewest=db.prepare(`DELETE FROM ${table}
  WHERE platform=? AND game=?
    AND id NOT IN (
      SELECT id FROM ${table} WHERE platform=? AND game=?
      ORDER BY minute_epoch DESC, first_seen DESC, id DESC LIMIT ${ROUND_HISTORY_LIMIT}
    )`).bind(source.platform,source.game,source.platform,source.game);
 const marker=db.prepare(`INSERT INTO history_retention_state(source_id,last_pruned_at)
  VALUES(?,?) ON CONFLICT(source_id) DO UPDATE SET last_pruned_at=excluded.last_pruned_at`).bind(source.id,now);
 return [keepNewest,marker];
}

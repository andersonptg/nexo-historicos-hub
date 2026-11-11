#!/usr/bin/env python3
"""Gera SQL de importação do banco local V4 para Cloudflare D1.
Uso: python export_v4_to_d1.py /caminho/smash_historico.sqlite3 > historico_v4.sql
Importa resultados públicos e resultados com ID oficial sem misturá-los.
Não inclui cookies, tokens, sessões ou apostas.
"""
import sqlite3, sys, time
from pathlib import Path

def quote(s):
    if s is None: return 'NULL'
    if isinstance(s, int): return str(s)
    return "'" + str(s).replace("'", "''") + "'"

def main():
    if len(sys.argv) < 2: raise SystemExit('Uso: python export_v4_to_d1.py caminho/smash_historico.sqlite3 > historico_v4.sql')
    db = Path(sys.argv[1]);
    if not db.is_file(): raise SystemExit('Banco não encontrado: ' + str(db))
    con=sqlite3.connect(f'file:{db}?mode=ro',uri=True)
    con.row_factory=sqlite3.Row
    tables={r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    print('-- Migração V4 -> D1: pública sem ID oficial e manual com ID oficial')
    print('-- Execute schema.sql ANTES deste arquivo. Preserve seu SQLite local como backup.')
    print('BEGIN TRANSACTION;')
    cpublic=0;cofficial=0
    if 'public_results' in tables:
        for r in con.execute('SELECT id,minute_epoch,number,color,observed_at,source FROM public_results'):
            rid='legacy-public:'+str(r['id'])
            args=[rid,'smash','double',r['number'],r['color'],r['minute_epoch'],None,None,'minute',r['source'],r['observed_at']]
            print('INSERT OR IGNORE INTO rounds(id,platform,game,number,color,minute_epoch,official_period,exact_epoch,precision,source,first_seen) VALUES ('+','.join(quote(x) for x in args)+');')
            cpublic+=1
    if 'results' in tables:
        for r in con.execute('SELECT period,number,color,result_time,source,received_at FROM results'):
            args=['official:'+str(r['period']),'smash','double',r['number'],r['color'],r['result_time'],r['period'],r['result_time'],'second',r['source'],r['received_at']]
            print('INSERT OR IGNORE INTO rounds(id,platform,game,number,color,minute_epoch,official_period,exact_epoch,precision,source,first_seen) VALUES ('+','.join(quote(x) for x in args)+');')
            cofficial+=1
    # If migrating the V4 public snapshot, preserve alignment so the next cron does not duplicate all current records.
    if 'public_snapshot' in tables:
        for r in con.execute('SELECT pos,public_id,minute_epoch,number FROM public_snapshot'):
            vals=['historicosblaze:smash:double',r['pos'],'legacy-public:'+str(r['public_id']),r['minute_epoch'],r['number']]
            print('INSERT OR IGNORE INTO snapshots(source_id,ordinal,round_id,minute_epoch,number) VALUES ('+','.join(quote(x) for x in vals)+');')
    print('COMMIT;')
    print(f'-- Importados: publicos={cpublic}, com_id={cofficial}',file=sys.stderr)
if __name__=='__main__':main()

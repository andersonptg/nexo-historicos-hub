-- Criar antes de ativar o Worker. Não armazena contas, cookies ou apostas.
CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  game TEXT NOT NULL,
  number INTEGER NOT NULL CHECK(number BETWEEN 0 AND 14),
  color TEXT NOT NULL CHECK(color IN ('red','black','white')),
  minute_epoch INTEGER NOT NULL,
  official_period TEXT,
  exact_epoch INTEGER,
  precision TEXT NOT NULL CHECK(precision IN ('minute','second')),
  source TEXT NOT NULL,
  first_seen INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_official_period ON rounds(platform,game,official_period) WHERE official_period IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_round_list ON rounds(platform,game,precision,minute_epoch DESC);
CREATE TABLE IF NOT EXISTS snapshots (
  source_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  round_id TEXT NOT NULL,
  minute_epoch INTEGER NOT NULL,
  number INTEGER NOT NULL,
  PRIMARY KEY (source_id,ordinal)
);
CREATE TABLE IF NOT EXISTS sync_status (
  source_id TEXT PRIMARY KEY,
  last_attempt INTEGER,
  last_success INTEGER,
  latest_minute INTEGER,
  last_new INTEGER DEFAULT 0,
  last_count INTEGER DEFAULT 0,
  message TEXT DEFAULT 'Aguardando primeira consulta'
);

-- V6: snapshots compactados em uma linha, evitando centenas de escritas a cada consulta.
-- Mantemos a tabela snapshots antiga para compatibilidade com os registros ja existentes.
CREATE TABLE IF NOT EXISTS snapshot_cache (
  source_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  last_updated INTEGER NOT NULL
);

-- V6: intervalo minimo compartilhado entre visitantes e agendamentos.
CREATE TABLE IF NOT EXISTS collection_leases (
  source_id TEXT PRIMARY KEY,
  next_allowed INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL DEFAULT 0
);

-- NEXO V7: resultados de multiplicadores sem forçar um valor Crash no formato 0-14.
CREATE TABLE IF NOT EXISTS multiplier_rounds (
 id TEXT PRIMARY KEY, platform TEXT NOT NULL, game TEXT NOT NULL,
 value TEXT NOT NULL, numeric_value REAL NOT NULL,
 minute_epoch INTEGER NOT NULL, source TEXT NOT NULL, first_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_multiplier_results ON multiplier_rounds(platform,game,minute_epoch DESC);
-- Estado configurável por administrador; nenhuma credencial em tabelas.
CREATE TABLE IF NOT EXISTS source_controls (
 source_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1,
 updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_login_attempts (
 key TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0,
 blocked_until INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
);

-- V8: cada estratégia pertence à sua plataforma/jogo; início restrito ao Smash Double.
CREATE TABLE IF NOT EXISTS strategies (
 id TEXT PRIMARY KEY,platform TEXT NOT NULL,game TEXT NOT NULL,
 definition TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_strategies_source ON strategies(platform,game,enabled);
CREATE TABLE IF NOT EXISTS strategy_settings (
 source_id TEXT PRIMARY KEY,config_json TEXT NOT NULL,updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS strategy_runtime (
 strategy_id TEXT PRIMARY KEY,state_json TEXT NOT NULL,updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS strategy_cursors (
 source_id TEXT PRIMARY KEY,last_round_id TEXT NOT NULL,last_updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS strategy_events (
 event_seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,source_id TEXT NOT NULL,strategy_id TEXT NOT NULL,
 event_type TEXT NOT NULL,round_id TEXT NOT NULL,step INTEGER NOT NULL,
 message TEXT NOT NULL,round_number INTEGER NOT NULL,minute_epoch INTEGER NOT NULL,created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_strategy_events ON strategy_events(source_id,created_at DESC);

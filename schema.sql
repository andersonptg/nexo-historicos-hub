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

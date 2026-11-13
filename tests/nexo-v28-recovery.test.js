import test from 'node:test';
import assert from 'node:assert/strict';
import { processSmashSnapshot } from '../src/strategies.js';

// Testes isolados: simulam o D1 em memoria. Nao acessam Cloudflare, Telegram nem internet.
const SOURCE = 'historicosblaze:smash:double';
const source = {id: SOURCE, platform: 'smash', game: 'double'};
const NOW = 1_794_606_500;
const roundIds = ['nova-2', 'nova-1', 'nova-0'];
const records = roundIds.map((id, i) => ({id, number: i + 1, color: 'red', minute_epoch: NOW - i * 60}));

function fakeEnv({ ageSeconds, progressRoundId = 'rodada-antiga' }) {
  const writes = [];
  const reads = [];
  const state = {
    active: {entryRoundId: 'rodada-antiga', step: 1},
    prealertRoundId: null,
    recent: []
  };
  const runtime = {
    strategy_id: 'estrategia-teste',
    state_json: JSON.stringify(state),
    updated_at: NOW - ageSeconds
  };
  const db = {
    prepare(sql) {
      const operation = {sql, args: []};
      return {
        bind(...args) { operation.args = args; return this; },
        async first() {
          reads.push(operation);
          if (sql.includes('SELECT last_round_id FROM strategy_cursors'))
            return {last_round_id: 'cursor-antigo'};
          throw new Error('Consulta first inesperada: ' + sql);
        },
        async all() {
          reads.push(operation);
          if (sql.includes('FROM strategy_runtime r JOIN strategies s'))
            return {results: [runtime]};
          if (sql.includes('SELECT round_id FROM strategy_events'))
            return {results: [{round_id: progressRoundId}]};
          throw new Error('Consulta all inesperada: ' + sql);
        },
        async run() {
          writes.push(operation);
          return {meta: {changes: 1}};
        }
      };
    },
    async batch(statements) {
      for (const stmt of statements) writes.push(stmt._op ?? stmt);
      // As instrucoes reais retornadas por prepare nao devem ser executadas neste teste.
      return [];
    }
  };
  // Gravar as instrucoes completas, inclusive seus binds, para afirmar o resultado.
  const originalPrepare = db.prepare;
  db.prepare = sql => {
    const operation = {sql, args: []};
    const stmt = originalPrepare(sql);
    const oldBind = stmt.bind;
    stmt.bind = (...args) => { operation.args = args; oldBind(...args); stmt._op = operation; return stmt; };
    stmt._op = operation;
    return stmt;
  };
  return {env: {DB: db}, writes, reads};
}

test('V28: encerra estado sem ancora apos 15 min e reposiciona cursor sem fabricar resultado', async () => {
  const {env, writes} = fakeEnv({ageSeconds: 1000});
  const result = await processSmashSnapshot(env, source, records, roundIds, NOW);
  assert.equal(result.reset, true);
  assert.equal(result.interrupted, true);
  assert.equal(writes.length, 2, 'somente atualizacao do runtime e cursor');
  assert.ok(writes[0].sql.includes('UPDATE strategy_runtime SET state_json='));
  const newState = JSON.parse(writes[0].args[0]);
  assert.equal(newState.active, null);
  assert.equal(newState.interruptedReason, 'ancora_ausente_mais_15_min');
  assert.ok(writes[1].sql.includes('UPDATE strategy_cursors SET last_round_id='));
  assert.equal(writes[1].args[0], roundIds[0]);
  assert.ok(!writes.some(x => /INSERT INTO strategy_events|telegram_outbox/i.test(x.sql)));
});

test('V28: preserva operacao recente sem ancora e nao altera o banco', async () => {
  const {env, writes} = fakeEnv({ageSeconds: 100});
  const result = await processSmashSnapshot(env, source, records, roundIds, NOW);
  assert.equal(result.stalled, true);
  assert.equal(writes.length, 0);
});

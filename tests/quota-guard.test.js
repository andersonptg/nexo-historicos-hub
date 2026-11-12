import test from 'node:test';
import assert from 'node:assert/strict';
import {MIN_COLLECTION_INTERVAL_SECONDS,nextCollectionLeaseAt} from '../src/quota.js';
import {readFileSync} from 'node:fs';

test('hotfix D1: intervalo mínimo é 45 segundos',()=>{
  assert.equal(MIN_COLLECTION_INTERVAL_SECONDS,45);
  assert.equal(nextCollectionLeaseAt(100),145);
  assert.equal(nextCollectionLeaseAt(100.4),145);
  assert.throws(()=>nextCollectionLeaseAt(Number.NaN),TypeError);
});

test('hotfix D1: Worker usa mesmo intervalo para lease e respostas',()=>{
  const src=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
  assert.match(src,/\.bind\(nextCollectionLeaseAt\(now\),now,source\.id,now\)\.run\(\)/);
  assert.match(src,/active_collection_minimum_seconds:MIN_COLLECTION_INTERVAL_SECONDS/);
  assert.match(src,/minimum_interval_seconds:MIN_COLLECTION_INTERVAL_SECONDS/);
  assert.doesNotMatch(src,/\.bind\(now\+5,now,source\.id,now\)/);
});

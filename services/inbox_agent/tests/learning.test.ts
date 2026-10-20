import assert from 'node:assert/strict';
import test from 'node:test';
import { LearningStore, qualification } from '../src/learning.js';

function approvedHistory(count: number): LearningStore {
  return {
    history: Array.from({ length: count }, (_, index) => ({
      emailType: 'design',
      unchanged: true,
      rating: 5,
      sent: true,
      createdAt: new Date(index * 1000).toISOString(),
    })),
  };
}

test('auto-send eligibility requires twenty consecutive unchanged, highly rated sends', () => {
  assert.equal(qualification(approvedHistory(19), 'design').eligible, false);
  assert.equal(qualification(approvedHistory(20), 'design').eligible, true);
});

test('a changed draft resets the unchanged streak and revokes eligibility', () => {
  const store = approvedHistory(20);
  store.history.push({
    emailType: 'design',
    unchanged: false,
    rating: 3,
    sent: true,
    createdAt: new Date().toISOString(),
  });
  const result = qualification(store, 'design');
  assert.equal(result.eligible, false);
  assert.equal(result.unchangedCount, 0);
});

test('sensitive categories are never eligible for automatic sending', () => {
  const store = approvedHistory(20);
  store.history = store.history.map((event) => ({ ...event, emailType: 'billing' }));
  assert.equal(qualification(store, 'billing').eligible, false);
});

test('another email type breaks the required consecutive sequence', () => {
  const store = approvedHistory(20);
  store.history.push({
    emailType: 'support',
    unchanged: true,
    rating: 5,
    sent: true,
    createdAt: new Date().toISOString(),
  });
  assert.equal(qualification(store, 'design').eligible, false);
});

test('a low recent quality rating removes automatic-send eligibility', () => {
  const store = approvedHistory(20);
  store.history[19].rating = 2;
  const result = qualification(store, 'design');
  assert.equal(result.eligible, false);
  assert.match(result.reason, /high-quality/);
});

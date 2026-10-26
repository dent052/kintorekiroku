import test from 'node:test';
import assert from 'node:assert/strict';
import { localDate } from './logic.js';

// app.js の保存・同期・復元を node --test で確かめる足場。
// localStorage と fetch は globalThis を差し替え、DOM は何を呼ばれても黙って受ける代役で起動だけ通す
// （画面の中身は e2e/app.test.mjs が実ブラウザで見る）。

function stub() {
  const fields = new Map();
  return new Proxy(function () {}, {
    get(target, key) {
      if (fields.has(key)) return fields.get(key);
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return hint => hint === 'number' ? 0 : '';
      if (key === 'then') return undefined;
      if (key === 'length') return 0;
      const child = stub();
      fields.set(key, child);
      return child;
    },
    set(target, key, value) {
      fields.set(key, value);
      return true;
    },
    apply: () => stub(),
    construct: () => stub()
  });
}

class MemoryStorage {
  constructor(entries = {}) {
    this.map = new Map(Object.entries(entries));
    this.failGet = false;
    this.failSet = false;
  }
  getItem(key) {
    if (this.failGet) throw new Error('SecurityError');
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    if (this.failSet) throw new Error('QuotaExceededError');
    this.map.set(key, String(value));
  }
  removeItem(key) {
    this.map.delete(key);
  }
}

function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

const respond = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const notFound = () => respond(404, {});
// 起動時のコーチ便確認（posts.json）を除いた、記録の送信だけの呼び出し。
const dataCalls = calls => calls.filter(call => call.url.endsWith('/data.json'));

let instance = 0;
/**
 * app.js を新しいモジュールとして読み込み直す（起動時の loadData / loadTraining もその都度走る）。
 * @param {{ storage?: Record<string, string>, failGet?: boolean, failSet?: boolean,
 *   fetch?: (url: string, options: any) => any }} options
 */
async function boot({ storage = {}, failGet = false, failSet = false, fetch = notFound } = {}) {
  const localStorage = new MemoryStorage(storage);
  localStorage.failGet = failGet;
  localStorage.failSet = failSet;
  const calls = [];
  setGlobal('localStorage', localStorage);
  setGlobal('fetch', async (url, options = {}) => {
    calls.push({ url, ...options });
    return fetch(url, options);
  });
  setGlobal('document', stub());
  setGlobal('window', stub());
  const { internals } = await import('./app.js?boot=' + ++instance);
  localStorage.failGet = false;
  return { app: internals, localStorage, calls };
}

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
}

const data = (o) => ({
  version: 1, updatedAt: '2026-10-01T00:00:00.000Z',
  exercises: [{ id: 'e1', name: '腕立て', type: 'reps', part: '胸', min: 8, max: 15, nextId: null, archived: false }],
  bands: [], templates: [], sessions: [], messages: [], skips: [], body: [],
  settings: { restSec: 90 }, ...o
});
const github = (o) => JSON.stringify({ owner: 'me', repo: 'log', token: 't', lastSyncAt: null, dirty: false, ...o });
const training = (o) => ({
  date: localDate(new Date()), light: false, index: 0, note: '', toCoach: false,
  entries: [{ id: 'e1', sets: [{ exerciseId: 'e1', reps: 10, sec: null, kg: null, bandId: null }], cursor: 0, goal: 1 }],
  ...o
});

// --- loadData（起動時の読み込みと、壊れた記録の退避） ---

test('loadData starts empty when nothing is stored', async () => {
  const { app, localStorage } = await boot();
  assert.equal(app.recovering, false);
  assert.deepEqual(app.state.exercises, []);
  assert.equal(app.state.settings.restSec, 90);
  assert.equal(localStorage.getItem('kintore:data'), null);
});

test('loadData reads stored data', async () => {
  const { app } = await boot({ storage: { 'kintore:data': JSON.stringify(data()) } });
  assert.equal(app.recovering, false);
  assert.equal(app.state.exercises[0].name, '腕立て');
  assert.equal(app.screen.mode, 'today');
});

test('loadData moves unreadable data aside and opens recovery without overwriting it', async () => {
  const raw = '{"version":1,"exercises":';
  const stored = training();
  const { app, localStorage } = await boot({
    storage: { 'kintore:data': raw, 'kintore:training': JSON.stringify({ training: stored, rest: null }) }
  });
  assert.equal(app.recovering, true);
  assert.equal(app.screen.mode, 'recovery');
  assert.equal(localStorage.getItem('kintore:data:broken'), raw);
  assert.equal(localStorage.getItem('kintore:data'), raw);
  assert.deepEqual(JSON.parse(localStorage.getItem('kintore:training')).training, stored);
  assert.equal(app.training, null);
});

test('loadData treats valid JSON of the wrong shape as broken', async () => {
  const raw = JSON.stringify({ version: 2 });
  const { app, localStorage } = await boot({ storage: { 'kintore:data': raw } });
  assert.equal(app.recovering, true);
  assert.equal(localStorage.getItem('kintore:data:broken'), raw);
});

test('loadData still opens recovery when the broken data cannot be moved aside', async () => {
  const raw = 'not json';
  const { app, localStorage } = await boot({ storage: { 'kintore:data': raw }, failSet: true });
  assert.equal(app.recovering, true);
  assert.equal(localStorage.getItem('kintore:data:broken'), null);
  assert.equal(localStorage.getItem('kintore:data'), raw);
});

test('loadData does not write a backup when storage cannot be read', async () => {
  const { app, localStorage } = await boot({ storage: { 'kintore:data': JSON.stringify(data()) }, failGet: true });
  assert.equal(app.recovering, true);
  assert.equal(localStorage.getItem('kintore:data:broken'), null);
  assert.equal(localStorage.getItem('kintore:data'), JSON.stringify(data()));
});

test('importing from recovery keeps the broken data aside and returns home', async () => {
  const raw = 'not json';
  const { app, localStorage } = await boot({ storage: { 'kintore:data': raw } });
  app.applyImport(data({ exercises: [] }));
  assert.equal(app.recovering, false);
  assert.equal(app.screen.mode, 'today');
  assert.equal(localStorage.getItem('kintore:data:before-import'), raw);
  assert.equal(localStorage.getItem('kintore:data:broken'), raw);
  assert.deepEqual(JSON.parse(localStorage.getItem('kintore:data')).exercises, []);
});

test('importing from recovery stays in recovery when the import cannot be saved', async () => {
  const raw = 'not json';
  const { app, localStorage } = await boot({ storage: { 'kintore:data': raw } });
  const previous = app.state;
  const imported = data();
  localStorage.setItem = (key, value) => {
    if (key === 'kintore:data') throw new Error('QuotaExceededError');
    localStorage.map.set(key, value);
  };
  app.applyImport(imported);
  assert.equal(app.recovering, true);
  assert.equal(app.state, previous);
  assert.equal(localStorage.getItem('kintore:data'), raw);
});

// --- save（失敗時の巻き戻し） ---

test('save stores the data with a new updatedAt', async () => {
  const { app, localStorage } = await boot({ storage: { 'kintore:data': JSON.stringify(data()) } });
  app.state.exercises[0].name = 'スクワット';
  assert.equal(app.save(), true);
  const stored = JSON.parse(localStorage.getItem('kintore:data'));
  assert.equal(stored.exercises[0].name, 'スクワット');
  assert.notEqual(stored.updatedAt, '2026-10-01T00:00:00.000Z');
  assert.equal(stored.updatedAt, app.state.updatedAt);
});

test('save rolls updatedAt back and keeps the stored data when storage is full', async () => {
  const before = JSON.stringify(data());
  const { app, localStorage } = await boot({
    storage: { 'kintore:data': before, 'kintore:github': github() }
  });
  localStorage.failSet = true;
  assert.equal(app.save(), false);
  assert.equal(app.state.updatedAt, '2026-10-01T00:00:00.000Z');
  assert.equal(localStorage.getItem('kintore:data'), before);
  assert.equal(app.github.dirty, false);
});

test('save marks GitHub dirty and pushes after the delay', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { app, localStorage, calls } = await boot({
    storage: { 'kintore:data': JSON.stringify(data()), 'kintore:github': github() },
    fetch: (url, options) => options.method === 'PUT' ? respond(201, {}) : notFound()
  });
  await settle();
  calls.length = 0;
  assert.equal(app.save(), true);
  assert.equal(app.github.dirty, true);
  assert.equal(JSON.parse(localStorage.getItem('kintore:github')).dirty, true);
  assert.equal(calls.length, 0);
  t.mock.timers.tick(5000);
  await settle();
  assert.deepEqual(calls.map(call => call.method ?? 'GET'), ['GET', 'PUT']);
  assert.equal(app.github.dirty, false);
});

test('applyImport puts the previous data back when it cannot be saved', async () => {
  const { app, localStorage } = await boot({ storage: { 'kintore:data': JSON.stringify(data()) } });
  const previous = app.state;
  localStorage.setItem = (key, value) => {
    if (key === 'kintore:data') throw new Error('QuotaExceededError');
    localStorage.map.set(key, value);
  };
  app.applyImport(data({ exercises: [] }));
  assert.equal(app.state, previous);
  assert.equal(JSON.parse(localStorage.getItem('kintore:data')).exercises.length, 1);
});

test('applyImport does not replace anything when the current data cannot be backed up', async () => {
  const { app, localStorage } = await boot({ storage: { 'kintore:data': JSON.stringify(data()) } });
  const previous = app.state;
  localStorage.failSet = true;
  app.applyImport(data({ exercises: [] }));
  assert.equal(app.state, previous);
  assert.equal(localStorage.getItem('kintore:data:before-import'), null);
});

// --- pushData（GitHub への送信と再送条件） ---

test('pushData does nothing when GitHub is not configured', async () => {
  const { app, calls } = await boot({ storage: { 'kintore:data': JSON.stringify(data()) } });
  await app.pushData();
  assert.equal(calls.length, 0);
});

test('pushData creates data.json and clears dirty on success', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { app, localStorage, calls } = await boot({
    storage: { 'kintore:data': JSON.stringify(data()), 'kintore:github': github({ dirty: true }) },
    fetch: (url, options) => options.method === 'PUT' ? respond(201, {}) : notFound()
  });
  await settle();
  const put = calls.find(call => call.method === 'PUT');
  assert.ok(put.url.endsWith('/repos/me/log/contents/data.json'));
  assert.equal(put.headers.Authorization, 'Bearer t');
  const body = JSON.parse(put.body);
  assert.equal(body.sha, undefined);
  const sent = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body.content), c => c.charCodeAt(0))));
  assert.equal(sent.exercises[0].name, '腕立て');
  const stored = JSON.parse(localStorage.getItem('kintore:github'));
  assert.equal(stored.dirty, false);
  assert.ok(stored.lastSyncAt);
  calls.length = 0;
  t.mock.timers.tick(5000);
  await settle();
  assert.equal(calls.length, 0, 'no retry once the push is clean');
});

test('pushData sends the existing sha when data.json is already there', async () => {
  const { app, calls } = await boot({
    storage: { 'kintore:data': JSON.stringify(data()), 'kintore:github': github() },
    fetch: (url, options) => options.method === 'PUT' ? respond(200, {}) : respond(200, { sha: 'abc' })
  });
  await app.pushData();
  assert.equal(JSON.parse(calls.find(call => call.method === 'PUT').body).sha, 'abc');
  assert.equal(app.github.dirty, false);
});

test('pushData keeps dirty and waits instead of retrying when the push fails', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { app, localStorage, calls } = await boot({
    storage: { 'kintore:data': JSON.stringify(data()), 'kintore:github': github() },
    fetch: (url, options) => options.method === 'PUT' ? respond(500, {}) : notFound()
  });
  await app.pushData();
  assert.equal(app.github.dirty, true);
  assert.equal(JSON.parse(localStorage.getItem('kintore:github')).dirty, true);
  assert.equal(app.github.lastSyncAt, null);
  calls.length = 0;
  t.mock.timers.tick(60000);
  await settle();
  assert.equal(calls.length, 0, 'failed pushes wait for online / visibility instead of looping');
});

test('pushData gives up on an unexpected status from the first request', async () => {
  const { app, calls } = await boot({
    storage: { 'kintore:data': JSON.stringify(data()), 'kintore:github': github() },
    fetch: () => respond(401, {})
  });
  await app.pushData();
  assert.equal(dataCalls(calls).length, 1);
  assert.equal(app.github.dirty, true);
});

test('pushData pushes again when data changed during the push', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let app;
  let edited = false;
  const booted = await boot({
    storage: { 'kintore:data': JSON.stringify(data()), 'kintore:github': github() },
    fetch: (url, options) => {
      if (options.method === 'PUT' && !edited) {
        edited = true;
        app.state.exercises[0].name = 'スクワット';
        app.save();
      }
      return options.method === 'PUT' ? respond(201, {}) : notFound();
    }
  });
  app = booted.app;
  await app.pushData();
  assert.equal(app.github.dirty, true, 'the edit made during the push is not on GitHub yet');
  booted.calls.length = 0;
  t.mock.timers.tick(5000);
  await settle();
  const put = booted.calls.find(call => call.method === 'PUT');
  assert.ok(put, 'a second push is scheduled');
  assert.match(new TextDecoder().decode(Uint8Array.from(atob(JSON.parse(put.body).content), c => c.charCodeAt(0))), /スクワット/);
  assert.equal(app.github.dirty, false);
});

test('pushData ignores a second call while a push is in flight', async () => {
  let release;
  const { app, calls } = await boot({
    storage: { 'kintore:data': JSON.stringify(data()), 'kintore:github': github() },
    fetch: (url, options) => !url.endsWith('/data.json') ? notFound()
      : options.method === 'PUT' ? respond(201, {})
        : new Promise(resolve => { release = () => resolve(notFound()); })
  });
  const first = app.pushData();
  await app.pushData();
  assert.equal(dataCalls(calls).length, 1);
  release();
  await first;
  assert.deepEqual(dataCalls(calls).map(call => call.method ?? 'GET'), ['GET', 'PUT']);
});

// --- loadTraining（途中のトレーニングの復元と検証） ---

const withTraining = (stored, extra = {}) => boot({
  storage: {
    'kintore:data': JSON.stringify(data()),
    'kintore:training': typeof stored === 'string' ? stored : JSON.stringify(stored),
    ...extra
  }
});

test('loadTraining restores today\'s training', async () => {
  const stored = training();
  const { app } = await withTraining({ training: stored, rest: null });
  assert.deepEqual(app.training, stored);
});

for (const [name, stored] of [
  ['from another day', training({ date: '2000-01-01' })],
  ['with no entries', training({ entries: [] })],
  ['with an index out of range', training({ index: 1 })],
  ['with a fractional index', training({ index: 0.5 })],
  ['for a deleted exercise', training({ entries: [{ ...training().entries[0], id: 'gone' }] })],
  ['with no planned sets', training({ entries: [{ ...training().entries[0], sets: [] }] })],
  ['with a zero goal', training({ entries: [{ ...training().entries[0], goal: 0 }] })]
]) {
  test(`loadTraining discards training ${name}`, async () => {
    const { app, localStorage } = await withTraining({ training: stored, rest: null });
    assert.equal(app.training, null);
    assert.equal(localStorage.getItem('kintore:training'), null);
  });
}

test('loadTraining ignores unreadable training', async () => {
  const { app } = await withTraining('{oops');
  assert.equal(app.training, null);
});

test('loadTraining resumes a rest that has not ended and drops one that has', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const running = { end: Date.now() + 60000, duration: 90000, verdict: null, verdictUntil: 0 };
  const { app, localStorage } = await withTraining({ training: training(), rest: running });
  assert.ok(app.training);
  assert.deepEqual(JSON.parse(localStorage.getItem('kintore:training')).rest, running);

  const ended = { end: Date.now() - 1000, duration: 90000, verdict: null, verdictUntil: 0 };
  const second = await withTraining({ training: training(), rest: ended });
  assert.ok(second.app.training);
  assert.equal(JSON.parse(second.localStorage.getItem('kintore:training')).rest, null);
});

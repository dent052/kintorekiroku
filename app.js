import {
  localDate, parseImport, value, recent, prefill, rows,
  lineText, sessionEvents, weekStats, weekStart, totalDays, feed, mergeFeed, firstSet, line, lineResult,
  top, load, totals, bodyAvg7, calendar, toBase64Utf8, consultText, parsePosts
} from './logic.js';

/** @typedef {import('./logic.js').Data} Data */

const view = document.querySelector('#view');
const dock = document.querySelector('#dock');
const tabs = document.querySelectorAll('[data-tab]');
const toastElement = document.querySelector('#toast');
const dialog = document.querySelector('#confirm-dialog');
let currentTab = 'home';
let toastTimeout;

/** @returns {Data} */
function loadData() {
  const empty = {
    version: 1,
    updatedAt: '',
    exercises: [],
    bands: [],
    templates: [],
    sessions: [],
    skips: [],
    body: [],
    settings: { restSec: 90 }
  };

  let raw;
  try {
    raw = localStorage.getItem('kintore:data');
    if (raw === null) return empty;
    return parseImport(raw);
  } catch {
    if (raw !== undefined && raw !== null) {
      try {
        localStorage.setItem('kintore:data:broken', raw);
      } catch {
        // 退避できなくても元の記録は上書きしない。
      }
    }
    window.alert('記録の読み込みに失敗しました。設定のバックアップから読み込んでください');
    return empty;
  }
}

/** @type {Data} */
let state = loadData();

function save() {
  state.updatedAt = new Date().toISOString();
  try {
    // shortcut: localStorage は約5MB上限、10年分程度で IndexedDB へ移行
    localStorage.setItem('kintore:data', JSON.stringify(state));
  } catch {
    toast('保存できませんでした。容量を確認してください');
    return;
  }
  scheduleSync();
}

let github = loadGithub();
let syncTimeout;
let pushing = false;
let syncVersion = 0;
let retryToastShown = false;
let feedbackCheckedAt = null;

function loadGithub() {
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem('kintore:github'));
  } catch {}
  return {
    owner: typeof stored?.owner === 'string' ? stored.owner.trim() : '',
    repo: typeof stored?.repo === 'string' ? stored.repo.trim() : '',
    token: typeof stored?.token === 'string' ? stored.token.trim() : '',
    lastSyncAt: stored?.lastSyncAt ?? null,
    dirty: stored?.dirty === true
  };
}

function configured(settings = github) {
  return [settings.owner, settings.repo, settings.token].every(text => text.trim());
}

function saveGithub() {
  try {
    localStorage.setItem('kintore:github', JSON.stringify(github));
  } catch {
    toast('保存できませんでした。容量を確認してください');
  }
  updateSyncStatus();
}

function syncStatus() {
  if (!configured()) return '未設定';
  if (github.dirty || !github.lastSyncAt) return '未保存の変更があります';
  const date = new Date(github.lastSyncAt);
  return `最終保存 ${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function updateSyncStatus() {
  const status = view.querySelector('[data-sync-status]');
  if (status) status.textContent = syncStatus();
}

function scheduleSync() {
  // shortcut: 単一端末前提で常に上書き。複数端末で使うなら updatedAt 比較を追加
  if (!configured()) return;
  syncVersion++;
  github.dirty = true;
  saveGithub();
  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(pushData, 5000);
}

function githubUrl(settings, file) {
  return `https://api.github.com/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}/contents/${file}`;
}

function githubHeaders(settings) {
  return {
    Authorization: `Bearer ${settings.token}`,
    Accept: 'application/vnd.github+json'
  };
}

function decodeGithub(content) {
  const binary = atob(content.replace(/[\r\n]/g, ''));
  return new TextDecoder('utf-8').decode(
    Uint8Array.from(binary, character => character.charCodeAt(0))
  );
}

async function pushData() {
  if (!configured() || pushing) return;
  clearTimeout(syncTimeout);
  pushing = true;
  const settings = github;
  const version = syncVersion;
  const content = toBase64Utf8(JSON.stringify(state, null, 1));
  settings.dirty = true;
  saveGithub();
  let succeeded = false;
  try {
    const url = githubUrl(settings, 'data.json');
    const headers = githubHeaders(settings);
    const response = await fetch(url, { headers, cache: 'no-store' });
    let sha;
    if (response.ok) sha = (await response.json()).sha;
    else if (response.status !== 404) throw new Error();
    const result = await fetch(url, {
      method: 'PUT',
      headers,
      cache: 'no-store',
      body: JSON.stringify({
        message: 'sync ' + new Date().toISOString(),
        content,
        ...(sha ? { sha } : {})
      })
    });
    if (!result.ok) throw new Error();
    if (github === settings) {
      github.dirty = syncVersion !== version;
      github.lastSyncAt = new Date().toISOString();
      saveGithub();
    }
    succeeded = true;
  } catch {
    if (!retryToastShown) {
      retryToastShown = true;
      toast('GitHub に保存できませんでした（あとで再送します）');
    }
  } finally {
    pushing = false;
    if ((succeeded || github !== settings) && configured() && github.dirty) {
      clearTimeout(syncTimeout);
      syncTimeout = setTimeout(pushData, 5000);
    }
  }
}

async function restoreGithub() {
  if (!configured()) return;
  try {
    const response = await fetch(githubUrl(github, 'data.json'), {
      headers: githubHeaders(github), cache: 'no-store'
    });
    if (!response.ok) throw new Error('読み込めないファイルです');
    const file = await response.json();
    const imported = parseImport(decodeGithub(file.content));
    if (!await confirmDialog('GitHub の記録で置き換えます。よろしいですか？')) return;
    state = imported;
    save();
    render();
  } catch {
    toast('読み込めないファイルです');
  }
}

async function fetchFeedback() {
  if (!configured()) return;
  const now = Date.now();
  if (feedbackCheckedAt !== null && now - feedbackCheckedAt < 600000) return;
  feedbackCheckedAt = now;
  const settings = github;
  try {
    const response = await fetch(githubUrl(settings, 'posts.json'), {
      headers: githubHeaders(settings), cache: 'no-store'
    });
    if (!response.ok) return;
    const file = await response.json();
    const raw = JSON.stringify(parsePosts(decodeGithub(file.content)));
    if (github !== settings || localStorage.getItem('kintore:posts') === raw) return;
    localStorage.setItem('kintore:posts', raw);
    if (currentTab === 'home') renderHome();
  } catch {}
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && github.dirty) pushData();
});
window.addEventListener('online', () => {
  if (github.dirty) pushData();
});

function uid(prefix) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let suffix = '';
  for (let i = 0; i < 8; i++) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${prefix}_${suffix}`;
}

/** @param {'home'|'train'|'history'|'settings'} tab */
function go(tab) {
  currentTab = tab;
  render();
}

function render() {
  hideResult();
  dock.replaceChildren();
  updateHomeBadge();
  for (const button of tabs) {
    if (button.dataset.tab === currentTab) {
      button.setAttribute('aria-current', 'page');
    } else {
      button.removeAttribute('aria-current');
    }
  }
  const renders = {
    home: renderHome,
    train: renderTrain,
    history: renderHistory,
    settings: renderSettings
  };
  renders[currentTab]();
}

function homeFeed() {
  let posts = [];
  let seen = [];
  try {
    const stored = JSON.parse(localStorage.getItem('kintore:posts'));
    if (Array.isArray(stored)) {
      posts = stored.filter(post => post && typeof post.id === 'string'
        && typeof post.text === 'string' && typeof post.at === 'string'
        && ['reply', 'weekly', 'finding', 'reading'].includes(post.kind));
    }
  } catch {}
  try {
    const stored = JSON.parse(localStorage.getItem('kintore:seen'));
    if (Array.isArray(stored)) seen = stored.filter(id => typeof id === 'string');
  } catch {}
  return { items: mergeFeed(feed(state, localDate(new Date())), posts, seen), seen };
}

function updateHomeBadge() {
  const button = document.querySelector('[data-tab="home"]');
  button.querySelector('.badge')?.remove();
  const { items, seen } = homeFeed();
  let unread = items.filter(item => !seen.includes(item.id)).length;
  const now = new Date();
  const cutoff = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 13));
  const today = localDate(now);
  if (!state.sessions.some(session => session.date >= cutoff && session.date <= today)) {
    unread = Math.min(unread, 2);
  }
  if (!unread) {
    button.removeAttribute('aria-label');
    return;
  }
  const label = unread > 9 ? '9+' : String(unread);
  const badge = element('span', label, 'badge');
  badge.setAttribute('aria-hidden', 'true');
  button.append(badge);
  button.setAttribute('aria-label', `ホーム 未読${label}件`);
}

function markSeen(items) {
  const { seen } = homeFeed();
  const displayed = items.map(item => item.id);
  const next = [...seen.filter(id => !displayed.includes(id)), ...displayed];
  try {
    localStorage.setItem('kintore:seen', JSON.stringify(next.slice(-500)));
  } catch {
    toast('保存できませんでした。容量を確認してください');
  }
  updateHomeBadge();
}

function appendFeed(parent, items, seen) {
  const list = element('div', '', 'feed');
  for (const item of items) {
    const row = element('article', '', `item${seen.includes(item.id) ? '' : ' new'}`);
    const bar = element('i');
    bar.setAttribute('aria-hidden', 'true');
    const content = element('div', '', 'stack');
    const coach = ['reply', 'weekly', 'finding', 'reading'].includes(item.kind);
    content.append(element('p', `${coach ? 'コーチ' : '記録'} ${shortDate(item.at.slice(0, 10))}`, 'k'));
    if (item.kind === 'reply' && typeof item.quote === 'string') {
      content.append(element('blockquote', item.quote, 'dim'));
    }
    content.append(element('p', item.text));
    if (item.kind === 'reading' && typeof item.source?.title === 'string') {
      try {
        const url = new URL(item.source.url);
        if (['https:', 'http:'].includes(url.protocol)) {
          const link = element('a', item.source.title, 'source-link');
          link.href = url.href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          content.append(link);
        }
      } catch {}
    }
    row.append(bar, content);
    list.append(row);
  }
  parent.append(list);
}

function renderHome() {
  fetchFeedback();
  dock.replaceChildren();
  view.replaceChildren();
  const today = localDate(new Date());
  const home = element('div', '', 'home stack');
  view.append(home);

  const stats = weekStats(state, today);
  const head = element('div', '', 'head');
  const total = element('div', '', 'total');
  total.append(element('span', '通算'), element('br'),
    element('span', String(totalDays(state)), 'num'), element('span', ' 日'));
  const weekly = element('div', '', 'weekly stack');
  weekly.append(element('p', `今週 ${stats.days}日`, 'dim'));
  const week = element('div', '', 'week');
  const [year, month, day] = weekStart(today).split('-').map(Number);
  for (let i = 0; i < 7; i++) {
    const date = localDate(new Date(year, month - 1, day + i));
    const mark = stats.marks[date];
    const cell = element('i', '', `bar${mark ? ` ${mark}` : ''}`);
    const status = { done: 'トレーニング', light: '軽めの日', rest: '休養' }[mark];
    cell.setAttribute('role', 'img');
    cell.setAttribute('aria-label',
      `${'月火水木金土日'[i]} ${date}${date === today ? ' 今日' : ''}${status ? ` ${status}` : ''}`);
    week.append(cell);
  }
  weekly.append(week);
  head.append(total, weekly);
  home.append(head);

  if (!state.exercises.length) {
    home.append(element('p', 'まず種目を登録しましょう', 'dim'));
    dock.append(action('種目を追加', () => {
      go('settings');
      editExercise();
    }, 'primary'));
    dock.className = 'dock';
  }

  const { items, seen } = homeFeed();
  const news = element('section', '', 'stack');
  news.append(element('h2', '新着'));
  const displayed = items.slice(0, 3);
  if (displayed.length) appendFeed(news, displayed, seen);
  else news.append(element('p', '新着なし', 'dim'));
  if (items.length) {
    news.append(action('すべて見る', () => {
      const { items, seen } = homeFeed();
      const ordered = [...items].sort((a, b) => b.at.localeCompare(a.at));
      const { content } = homeSheet('新着');
      appendFeed(content, ordered, seen);
      markSeen(ordered);
    }));
  }
  home.append(news);

  const candidates = element('section', '', 'stack');
  const carry = element('div', '', 'carry');
  for (const ex of state.exercises) {
    const session = state.sessions
      .filter(session => !session.light && session.date <= today && firstSet(state, ex, session))
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!session) continue;
    const target = line(state, ex.id, session.date);
    if (lineResult(target, value(ex, firstSet(state, ex, session))).kind !== 'short') continue;
    carry.append(element('span', ex.name),
      element('span', `ライン ${target.value}${ex.type === 'time' ? '秒' : ''}`, 'num'));
  }
  if (carry.childElementCount) {
    candidates.append(element('h2', '次回の候補'), carry);
    home.append(candidates);
  }

  if (state.exercises.length) {
    const buttons = element('div', '', 'row21');
    buttons.append(
      action('始める', () => {
        if (!workout) summaryId = null;
        go('train');
      }, 'primary'),
      action('軽めの日', () => {
        if (workout) {
          go('train');
          return;
        }
        summaryId = null;
        go('train');
        startWorkout({ light: true });
      })
    );
    const links = element('div', '', 'row2');
    if (!state.sessions.some(session => session.date === today)) {
      links.append(action('今日は休む', recordRest));
    }
    links.append(action('体重を記録', recordBody));
    dock.className = 'dock';
    dock.append(buttons, links);
  }
  markSeen(displayed);
}

function homeSheet(title) {
  const sheet = element('dialog', '', 'home-sheet');
  sheet.setAttribute('aria-label', title);
  sheet.append(element('h2', title));
  const content = element('div', '', 'stack');
  const actions = element('div', '', 'dialog-actions');
  actions.append(action('キャンセル', () => sheet.close()));
  sheet.append(content, actions);
  sheet.addEventListener('close', () => sheet.remove(), { once: true });
  document.body.append(sheet);
  sheet.showModal();
  return { sheet, content };
}

function recordRest() {
  const { sheet, content } = homeSheet('今日は休む');
  for (const reason of ['風邪', '疲れ', '予定', 'その他']) {
    content.append(action(reason, () => {
      const today = localDate(new Date());
      const skip = state.skips.find(item => item.date === today);
      if (skip) skip.reason = reason;
      else state.skips.push({ date: today, reason });
      save();
      sheet.close();
      render();
      toast('休むのも練習。また明日');
    }));
  }
}

function recordBody() {
  const entries = [...state.body].sort((a, b) => b.date.localeCompare(a.date));
  const latest = entries[0];
  const lastWaist = entries.find(entry => entry.waist !== null);
  let kg = latest?.kg ?? '';
  let waist = lastWaist?.waist ?? '';
  let none = latest?.waist === null;
  const { sheet, content } = homeSheet('体重を記録');

  function valid(number) {
    return String(number).trim() !== '' && Number.isFinite(Number(number));
  }

  const saveButton = action('保存', () => {
    if (!valid(kg) || (!none && !valid(waist))) return;
    const today = localDate(new Date());
    const entry = { date: today, kg: Number(kg), waist: none ? null : Number(waist) };
    const existing = state.body.find(item => item.date === today);
    if (existing) Object.assign(existing, entry);
    else state.body.push(entry);
    save();
    sheet.close();
    render();
  }, 'primary');

  function updateSave() {
    saveButton.disabled = !valid(kg) || (!none && !valid(waist));
  }

  function decimalField(title, amount, onInput) {
    const label = element('label', '', 'stack');
    const input = element('input');
    input.inputMode = 'decimal';
    input.value = String(amount);
    input.addEventListener('input', () => {
      onInput(input.value);
      updateSave();
    });
    label.append(element('span', title), input);
    return label;
  }

  function draw() {
    content.replaceChildren();
    content.append(latest
      ? stepper('体重', Number(kg), 0, Infinity, 0.1, next => {
        kg = Math.round(next * 10) / 10;
        draw();
      }, 'kg')
      : decimalField('体重 kg', kg, next => { kg = next; }));
    const toggle = action('なし', () => {
      none = !none;
      draw();
    }, `chip${none ? ' on' : ''}`);
    toggle.setAttribute('aria-pressed', String(none));
    toggle.setAttribute('aria-label', 'ウエストなし');
    if (!none) {
      content.append(lastWaist
        ? stepper('ウエスト', Number(waist), 0, Infinity, 0.5, next => {
          waist = Math.round(next * 10) / 10;
          draw();
        }, 'cm')
        : decimalField('ウエスト cm', waist, next => { waist = next; }));
    } else {
      content.append(element('span', 'ウエスト'));
    }
    content.append(toggle, saveButton);
    updateSave();
  }

  draw();
}

let workout = null;
let summaryId = null;
let wakeLock = null;
let endAt = null;
let timerInterval;
let resultTimeout;
const timerElement = document.querySelector('#timer');

function workoutCard(exerciseId, count) {
  const filled = prefill(state, exerciseId, localDate(new Date()));
  return {
    exerciseId,
    rows: (count === undefined ? filled : rows(filled, count))
      .map(set => ({ set: { ...set }, done: false, kind: null }))
  };
}

function startWorkout({ templateId, light = false, same = false } = {}) {
  const today = localDate(new Date());
  const template = state.templates.find(item => item.id === templateId);
  let exerciseIds = [];
  if (template) {
    exerciseIds = template.exerciseIds;
  } else if (light || same) {
    const previous = state.sessions
      .filter(session => session.date < today && (light || !session.light))
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!previous) {
      renderStartChoices(light);
      return;
    }
    exerciseIds = state.exercises
      .filter(ex => previous.sets.some(set => set.exerciseId === ex.id))
      .map(ex => ex.id);
  }
  workout = {
    light,
    index: 0,
    cards: exerciseIds
      .filter(id => state.exercises.some(ex => ex.id === id))
      .map(id => workoutCard(id, light ? 1 : template?.sets)),
    sessionId: null,
    toCoach: state.sessions.find(session => session.date === today)?.toCoach ?? false,
    note: state.sessions.find(session => session.date === today)?.note ?? ''
  };
  summaryId = null;
  requestWakeLock();
  go('train');
}

async function requestWakeLock() {
  if (!workout || wakeLock || document.visibilityState !== 'visible') return;
  const activeWorkout = workout;
  try {
    const lock = await navigator.wakeLock?.request('screen');
    if (!lock) return;
    if (workout !== activeWorkout) {
      await lock.release();
      return;
    }
    wakeLock = lock;
    lock.addEventListener('release', () => {
      if (wakeLock === lock) wakeLock = null;
    });
  } catch {}
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && workout) requestWakeLock();
});

function renderStartChoices(light = false) {
  view.replaceChildren(element('h1', 'トレーニング'));
  const section = settingsSection('テンプレート');
  for (const template of state.templates) {
    section.append(action(template.name, () =>
      startWorkout({ templateId: template.id, light }), 'settings-item'));
  }
  if (light) return;
  section.append(
    action('前回と同じ', () => startWorkout({ same: true })),
    action('種目を選んで始める', () => {
      startWorkout();
      pickWorkoutExercise();
    }),
    action('軽めの日', () => startWorkout({ light: true }), 'primary')
  );
}

function pickWorkoutExercise() {
  const { sheet, content } = homeSheet('種目を追加');
  for (const ex of state.exercises) {
    if (ex.archived) continue;
    content.append(action(ex.name, () => {
      workout.cards.push(workoutCard(ex.id));
      workout.index = workout.cards.length - 1;
      sheet.close();
      render();
    }, 'settings-item'));
  }
}

function previousText(ex, session) {
  const groups = [];
  for (const set of session.sets.filter(set => set.exerciseId === ex.id)) {
    const prefix = ex.type === 'band'
      ? state.bands.find(band => band.id === set.bandId)?.name ?? 'なし'
      : ex.type === 'weight' ? `${set.kg ?? 0}kg` : '';
    const last = groups[groups.length - 1];
    if (last && last.prefix === prefix) last.values.push(value(ex, set));
    else groups.push({ prefix, values: [value(ex, set)] });
  }
  return groups.map(group =>
    `${group.prefix ? `${group.prefix} ` : ''}${group.values.join('・')}`
  ).join(' / ');
}

function hideResult() {
  clearTimeout(resultTimeout);
  document.querySelector('.training-result')?.remove();
}

document.addEventListener('click', event => {
  const result = document.querySelector('.training-result');
  if (result && !result.contains(event.target)) hideResult();
}, true);

function completeRow(card, row) {
  if (row.done) return;
  const ex = state.exercises.find(item => item.id === card.exerciseId);
  const first = !card.rows.some(item => item.done);
  const today = localDate(new Date());
  const target = line(state, ex.id, today);
  let session = state.sessions.find(item => item.date === today);
  if (!session) {
    session = {
      id: uid('s'), date: today, light: workout.light,
      note: workout.note, toCoach: workout.toCoach, sets: []
    };
    state.sessions.push(session);
  } else {
    session.light = session.light && workout.light;
    session.note = workout.note;
    session.toCoach = workout.toCoach;
  }
  workout.sessionId = session.id;
  session.sets.push({ ...row.set });
  row.done = true;
  if (card.rows.every(item => item.done)) {
    card.rows.push({ set: { ...row.set }, done: false, kind: null });
  }
  save();
  startTimer(state.settings.restSec);
  render();
  if (!first) return;

  const result = lineResult(target, value(ex, row.set));
  const word = result.kind === 'clear' ? '突破'
    : result.kind === 'short' ? `あと${result.diff}`
      : result.kind === 'newload' ? '新しい基準' : '基準';
  let small = '';
  if (result.kind === 'clear') {
    const [year, month, day] = today.split('-').map(Number);
    const next = line(state, ex.id, localDate(new Date(year, month - 1, day + 1)));
    if ('value' in next) small = `次のライン ${next.value}${ex.type === 'time' ? '秒' : ''}`;
    else if (next.kind === 'up') small = `次は${next.next}で`;
    navigator.vibrate?.(60);
  } else if (result.kind === 'short') {
    small = 'ラインは次回へ';
  } else if (result.kind === 'newload') {
    if (ex.type === 'band') {
      small = `${state.bands.find(band => band.id === row.set.bandId)?.name ?? 'なし'}の1本目`;
    } else if (ex.type === 'weight') {
      small = `${row.set.kg ?? 0}kgの1本目`;
    } else if (ex.nextId) {
      small = `次は${target.next}で`;
    }
  }
  const feedback = element('div', '', `training-result ${result.kind === 'clear' ? 'clear' : 'short'}`);
  feedback.setAttribute('role', 'status');
  const text = element('div');
  text.append(element('div', word, 'word'));
  if (small) text.append(element('small', small));
  feedback.append(element('span', String(value(ex, row.set)), 'num'), text);
  view.querySelector('.training').append(feedback);
  resultTimeout = setTimeout(hideResult, 2500);
}

function workoutOptions(card, ex) {
  const { sheet, content } = homeSheet(ex.name);
  content.append(
    action('種目を追加', () => {
      sheet.close();
      pickWorkoutExercise();
    }),
    action('セットを追加', () => {
      const last = card.rows[card.rows.length - 1];
      card.rows.push({ set: { ...last.set }, done: false, kind: null });
      sheet.close();
      render();
    })
  );
  if (ex.nextId && state.exercises.some(item => item.id === ex.nextId)) {
    content.append(action('次の段階へ切り替え', () => {
      workout.cards[workout.index] = workoutCard(ex.nextId);
      sheet.close();
      render();
    }));
  }
  const label = element('label', '', 'stack');
  const note = element('textarea');
  note.value = workout.note;
  const persist = () => {
    const session = state.sessions.find(item =>
      item.id === workout.sessionId || item.date === localDate(new Date()));
    if (session) {
      session.note = workout.note;
      session.toCoach = workout.toCoach;
      save();
    }
  };
  note.addEventListener('input', () => {
    workout.note = note.value;
    persist();
  });
  label.append(element('span', 'メモ'), note);
  const toggle = action('コーチに送る', () => {
    workout.toCoach = !workout.toCoach;
    toggle.setAttribute('aria-pressed', String(workout.toCoach));
    toggle.classList.toggle('on', workout.toCoach);
    persist();
  }, `chip${workout.toCoach ? ' on' : ''}`);
  toggle.setAttribute('aria-pressed', String(workout.toCoach));
  content.append(label, toggle);
}

function renderTrain() {
  if (!workout) {
    if (summaryId) renderSummary();
    else renderStartChoices();
    return;
  }
  if (!workout.cards.length) {
    view.replaceChildren(element('h1', 'トレーニング'));
    dock.className = 'dock';
    dock.append(action('種目を追加', pickWorkoutExercise, 'primary'));
    return;
  }
  const card = workout.cards[workout.index];
  const ex = state.exercises.find(item => item.id === card.exerciseId);
  const row = card.rows.find(item => !item.done);
  const section = element('section', '', 'training stack');
  const head = element('div', '', 'head');
  const title = element('div');
  title.append(element('h2', ex.name),
    element('span', `${workout.index + 1} / ${workout.cards.length} 種目`, 'dim'));
  const more = action('…', () => workoutOptions(card, ex), 'more');
  more.setAttribute('aria-label', 'トレーニングの操作');
  head.append(title, more);
  section.append(head);

  const target = line(state, ex.id, localDate(new Date()));
  if (!card.rows.some(item => item.done)) {
    const chip = element('div', '', 'line-chip');
    if ('value' in target) {
      chip.append(element('span', 'ライン'),
        element('span', `${target.value}${ex.type === 'time' ? '秒' : ''}`, 'num'));
    } else {
      chip.textContent = lineText(target, ex);
    }
    section.append(chip);
    if (target.kind === 'flat' || target.kind === 'down') {
      section.append(element('p', lineText(target, ex), 'dim'));
    }
    const previous = recent(state, ex.id, localDate(new Date()), 1)[0];
    if (previous) section.append(element('p', `前回 ${previousText(ex, previous)}`, 'training-note'));
  }

  const done = element('div', '', 'done-sets');
  for (const item of card.rows.filter(item => item.done)) {
    const prefix = ex.type === 'band'
      ? `${state.bands.find(band => band.id === item.set.bandId)?.name ?? 'なし'} `
      : ex.type === 'weight' ? `${item.set.kg ?? 0}kg ` : '';
    done.append(element('span', `${prefix}${value(ex, item.set)}${ex.type === 'time' ? '秒' : ''}`));
  }
  if (done.childElementCount) section.append(done);
  section.append(timerElement);

  const update = (key, next) => {
    row.set[key] = next;
    render();
  };
  if (ex.type === 'band') {
    const bands = element('div', '', 'training-bands');
    if (!state.bands.some(band => band.id === row.set.bandId)) {
      bands.append(element('span', 'なし', 'chip on'));
    }
    for (const band of [...state.bands].sort((a, b) => a.order - b.order)) {
      const selected = band.id === row.set.bandId;
      const button = action(band.name, () => update('bandId', band.id),
        selected ? 'on' : '');
      button.setAttribute('aria-pressed', String(selected));
      bands.append(button);
    }
    section.append(bands);
  }
  const spacer = element('div', '', 'training-space');
  section.append(spacer, element('p', `${card.rows.indexOf(row) + 1}セット目`, 'training-label'));
  view.replaceChildren(section);
  dock.className = 'dock training-dock';
  if (ex.type === 'weight') {
    const weight = stepper('重り', row.set.kg ?? 0, 0, Infinity, 0.5,
      next => update('kg', next), 'kg');
    weight.classList.add('training-weight');
    dock.append(weight);
  }
  const time = ex.type === 'time';
  const control = stepper(ex.name, value(ex, row.set), 0, Infinity, time ? 5 : 1,
    next => update(time ? 'sec' : 'reps', next), time ? '秒' : '回');
  dock.append(control.querySelector('.stepper'),
    action('完了', () => completeRow(card, row), 'primary'));
  const navigation = element('div', '', 'row2');
  const previous = action('◀ 前の種目', () => {
    workout.index--;
    render();
  });
  previous.disabled = workout.index === 0;
  const last = workout.index === workout.cards.length - 1;
  navigation.append(previous, action(last ? '終了' : '次の種目 ▶', () => {
    if (last) finishWorkout();
    else {
      workout.index++;
      render();
    }
  }, last ? 'primary' : ''));
  dock.append(navigation);
}

function finishWorkout() {
  const session = state.sessions.find(item => item.id === workout.sessionId);
  if (session) {
    session.note = workout.note;
    session.toCoach = workout.toCoach;
    save();
  }
  summaryId = session?.id ?? null;
  workout = null;
  stopTimer();
  const lock = wakeLock;
  wakeLock = null;
  lock?.release().catch(() => {});
  if (summaryId) render();
  else go('home');
}

function totalReps(session) {
  return session.sets.reduce((total, set) => {
    const ex = state.exercises.find(item => item.id === set.exerciseId);
    return total + (ex && ex.type !== 'time' ? value(ex, set) : 0);
  }, 0);
}

function renderSummary() {
  const session = state.sessions.find(item => item.id === summaryId);
  const [year, month, day] = session.date.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const heading = `${month}月${day}日（${'日月火水木金土'[date.getDay()]}）`;
  const section = element('div', '', 'summary stack');
  section.append(element('p', heading, 'dim'));
  let clear = 0;
  let lines = 0;
  for (const ex of state.exercises) {
    const first = firstSet(state, ex, session);
    if (!first) continue;
    const result = lineResult(line(state, ex.id, session.date), value(ex, first));
    if (result.kind === 'clear' || result.kind === 'short') lines++;
    if (result.kind === 'clear') clear++;
  }
  const record = element('div');
  record.append(element('h2', '今日の記録'),
    element('p', `ライン突破 ${clear} / ${lines}`, 'ratio'));
  section.append(record);
  const total = totalReps(session);
  const amount = element('div');
  const number = element('p');
  number.append(element('span', String(total), 'num big'), element('span', ' 回', 'dim'));
  amount.append(number);
  const previous = state.sessions
    .filter(item => item.date < session.date)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (previous) {
    const diff = total - totalReps(previous);
    const comparison = element('p', '前回より ', 'dim');
    comparison.append(element('b', `${diff >= 0 ? '+' : ''}${diff}`, diff > 0 ? 'positive' : 'dim'));
    amount.append(comparison);
  }
  section.append(amount);
  const events = element('div');
  for (const event of sessionEvents(state, session.id)) {
    const row = element('div', '', `ev ${event.kind}`);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.5');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', event.kind === 'pr' ? 'M5 13l4 4 10-10'
      : event.kind === 'load' ? 'M12 19V5M5 12l7-7 7 7'
        : 'M4 20h4v-4h4v-4h4V8h4');
    svg.append(path);
    row.append(svg, element('p', event.text));
    events.append(row);
  }
  section.append(events);
  view.replaceChildren(section);
  dock.className = 'dock';
  dock.append(action('ホームへ', () => {
    summaryId = null;
    go('home');
  }, 'primary'));
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = undefined;
  endAt = null;
  timerElement.hidden = true;
}

function startTimer(sec) {
  stopTimer();
  endAt = Date.now() + sec * 1000;
  const display = element('output', '', 'num');
  display.setAttribute('aria-label', '休憩の残り時間');
  timerElement.replaceChildren(
    element('span', '休憩', 'dim'),
    display,
    action('+15秒', () => {
      endAt += 15000;
      tick();
    }),
    action('スキップ', stopTimer)
  );
  function tick() {
    const remaining = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
    if (remaining === 0) {
      stopTimer();
      navigator.vibrate?.([300, 100, 300]);
      return;
    }
    display.textContent = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
  }
  timerElement.hidden = false;
  timerInterval = setInterval(tick, 250);
  tick();
}

let historyTab = 'exercise';
let historyExerciseId = null;
let historyDate = null;

function shortDate(date) {
  return date.split('-').slice(1).map(Number).join('/');
}

function lineChart(points, opts = {}) {
  if (!points.length) return '<p class="dim">まだ記録がありません</p>';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 328 180');
  svg.setAttribute('class', 'history-chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '記録の推移');
  const add = (tag, attrs, text) => {
    const node = document.createElementNS(svg.namespaceURI, tag);
    for (const [key, val] of Object.entries(attrs)) node.setAttribute(key, String(val));
    if (text !== undefined) node.textContent = text;
    svg.append(node);
    return node;
  };
  const smooth = opts.smooth ?? [];
  const values = [...points, ...smooth].map(point => point.y);
  const body = opts.smooth !== undefined;
  const min = body ? Math.floor(Math.min(...values) - 1) : 0;
  const max = body
    ? Math.ceil(Math.max(...values) + 1)
    : Math.max(5, Math.ceil(Math.max(...values) / 5) * 5);
  const dateNumber = date => {
    const [year, month, day] = date.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  const first = dateNumber(points[0].x);
  const last = dateNumber(points[points.length - 1].x);
  const x = point => first === last ? 175
    : 36 + (dateNumber(point.x) - first) / (last - first) * 280;
  const y = point => 140 - (point.y - min) / (max - min) * 120;
  for (const fraction of [0, 0.5, 1]) {
    const height = 140 - fraction * 120;
    const amount = min + (max - min) * fraction;
    add('line', {
      x1: 32, y1: height, x2: 328, y2: height, stroke: 'var(--line)'
    });
    add('text', {
      x: 28, y: height + 4, fill: 'var(--fg2)',
      'text-anchor': 'end', 'font-size': 11
    }, body ? Math.round(amount * 10) / 10 : amount);
  }
  const indices = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  for (const index of indices) {
    const point = points[index];
    add('text', {
      x: x(point), y: 172, fill: 'var(--fg2)', 'font-size': 11,
      'text-anchor': indices.length === 1 ? 'middle'
        : index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'
    }, shortDate(point.x));
  }
  if (!body) {
    const runs = [];
    for (const point of points) {
      const color = point.color ?? 'var(--fg2)';
      const run = runs[runs.length - 1];
      if (run?.color === color) run.points.push(point);
      else runs.push({ color, points: [point] });
    }
    for (const run of runs) {
      if (run.points.length > 1) {
        add('polyline', {
          fill: 'none', stroke: run.color, 'stroke-width': 3,
          points: run.points.map(point => `${x(point)},${y(point)}`).join(' ')
        });
      }
      const point = run.points[0];
      if (point.label) {
        add('text', {
          x: x(point), y: Math.min(156, y(point) + 18),
          fill: run.color, 'font-size': 12,
          'text-anchor': x(point) > 250 ? 'end' : 'start'
        }, point.label);
      }
    }
  }
  if (smooth.length > 1) {
    add('polyline', {
      fill: 'none', stroke: 'var(--primary)', 'stroke-width': 3,
      points: smooth.map(point => `${x(point)},${y(point)}`).join(' ')
    });
  }
  points.forEach((point, index) => {
    const final = index === points.length - 1;
    add('circle', {
      cx: x(point), cy: y(point), r: final ? 5 : 4,
      fill: point.color ?? 'var(--fg2)',
      ...(final ? { stroke: 'var(--fg)', 'stroke-width': 2 } : {})
    });
  });
  return svg.outerHTML;
}

function renderHistory() {
  view.replaceChildren();
  const history = element('div', '', 'history stack');
  const segmented = element('div', '', 'seg');
  for (const [id, title] of [['exercise', '種目'], ['body', '体'], ['date', '日付']]) {
    const button = action(title, () => {
      historyTab = id;
      render();
    }, historyTab === id ? 'on' : '');
    button.setAttribute('aria-pressed', String(historyTab === id));
    segmented.append(button);
  }
  dock.className = 'dock';
  dock.append(segmented);
  view.append(history);
  if (historyTab === 'exercise') renderExerciseHistory(history);
  else if (historyTab === 'body') renderBodyHistory(history);
  else renderCalendar(history);
}

function renderExerciseHistory(parent) {
  const exercises = state.exercises.filter(ex =>
    state.sessions.some(session => session.sets.some(set => set.exerciseId === ex.id)));
  if (!exercises.length) {
    parent.append(element('p', 'まだ記録がありません', 'dim'));
    return;
  }
  if (!exercises.some(ex => ex.id === historyExerciseId)) {
    historyExerciseId = [...exercises].sort((a, b) => {
      const latest = ex => state.sessions
        .filter(session => session.sets.some(set => set.exerciseId === ex.id))
        .reduce((date, session) => session.date > date ? session.date : date, '');
      return latest(b).localeCompare(latest(a));
    })[0].id;
  }
  const ex = exercises.find(ex => ex.id === historyExerciseId);
  dock.append(action(`種目を選ぶ：${ex.name} ▾`, () => {
    const { sheet, content } = homeSheet('種目を選ぶ');
    for (const exercise of exercises) {
      content.append(action(exercise.name, () => {
        historyExerciseId = exercise.id;
        sheet.close();
        render();
      }, 'settings-item'));
    }
  }, 'pick'));

  const sessions = state.sessions
    .filter(session => session.sets.some(set => set.exerciseId === ex.id))
    .sort((a, b) => a.date.localeCompare(b.date));
  const records = sessions.map(session => ({ session, ...top(state, ex, session) }));
  const loads = [...new Set(sessions.flatMap(session => session.sets
    .filter(set => set.exerciseId === ex.id)
    .map(set => load(state, ex, set))))].sort((a, b) => a - b);
  const palette = ['var(--fg2)', 'var(--primary)', 'var(--good)', '#60A5FA'];
  const loadName = amount => ex.type === 'band'
    ? state.bands.find(band => band.order === amount)?.name ?? 'なし'
    : ex.type === 'weight' ? `${amount}kg` : '';
  const chart = element('div');
  chart.innerHTML = lineChart(records.map((record, index) => ({
    x: record.session.date,
    y: record.value,
    color: palette[loads.indexOf(record.load) % palette.length],
    label: index === 0 || record.load !== records[index - 1].load
      ? loadName(record.load) : ''
  })));
  parent.append(chart);

  const current = records[records.length - 1].load;
  const best = Math.max(...sessions.flatMap(session => session.sets
    .filter(set => set.exerciseId === ex.id && load(state, ex, set) === current)
    .map(set => value(ex, set))));
  const unit = ex.type === 'time' ? '秒' : '回';
  const stats = element('div', '', 'stats');
  const stat = (amount, title, suffix = '') => {
    const item = element('div');
    const number = element('span', String(amount), 'num');
    if (suffix) number.append(element('small', ` ${suffix}`, 'dim'));
    item.append(number, element('span', title, 'dim'));
    stats.append(item);
  };
  const currentName = loadName(current);
  stat(best, `最高${currentName ? `（${currentName}）` : ''}`, unit);
  if (ex.type === 'band' || ex.type === 'weight') {
    stat(currentName, ex.type === 'band' ? '今のバンド' : '今の重さ');
  }
  stat(totals(state)[ex.id].toLocaleString('ja-JP'),
    ex.type === 'time' ? '累計秒数' : '累計回数');
  parent.append(stats);

  const list = element('div', '', 'history-log stack');
  for (const session of [...sessions].reverse()) {
    const row = element('div', '', 'history-log-row');
    row.append(element('span', shortDate(session.date), 'dim'));
    if (ex.type === 'band' || ex.type === 'weight') {
      const groups = [];
      for (const set of session.sets.filter(set => set.exerciseId === ex.id)) {
        const amount = load(state, ex, set);
        const name = ex.type === 'band'
          ? state.bands.find(band => band.id === set.bandId)?.name ?? 'なし'
          : `${set.kg ?? 0}kg`;
        const last = groups[groups.length - 1];
        if (last?.name === name) last.values.push(value(ex, set));
        else groups.push({ name, amount, values: [value(ex, set)] });
      }
      const content = element('div', '', 'stack');
      for (const group of groups) {
        const line = element('div', '', 'history-load');
        const chips = element('div', '', 'chips');
        const chip = element('span', group.name, 'chip on');
        chip.style.background = palette[loads.indexOf(group.amount) % palette.length];
        chips.append(chip);
        line.append(chips, element('b', group.values.join('・'), 'num'));
        content.append(line);
      }
      row.append(content);
    } else {
      row.append(element('b', previousText(ex, session), 'num'));
    }
    list.append(row);
  }
  parent.append(list);
}

function renderBodyHistory(parent) {
  const entries = [...state.body].sort((a, b) => a.date.localeCompare(b.date));
  const hasWaist = entries.some(entry => entry.waist !== null);
  for (const [key, title] of [['kg', '体重 kg'], ['waist', 'ウエスト cm']]) {
    if (key === 'waist' && !hasWaist) continue;
    const section = element('section', '', 'stack');
    const points = entries.filter(entry => entry[key] !== null)
      .map(entry => ({ x: entry.date, y: entry[key], color: 'var(--fg2)' }));
    const chart = element('div');
    chart.innerHTML = lineChart(points, {
      smooth: points.map(point => ({
        x: point.x,
        y: bodyAvg7(state.body, point.x, key)
      }))
    });
    section.append(element('h2', title), chart);
    parent.append(section);
  }
  const list = element('div', '', 'stack body-log');
  for (const entry of [...entries].reverse()) {
    list.append(element('p',
      `${shortDate(entry.date)}  ${entry.kg.toFixed(1)}kg`
      + (hasWaist && entry.waist !== null
        ? `  ウエスト${entry.waist.toFixed(1)}cm` : '')));
  }
  parent.append(list);
}

function renderCalendar(parent) {
  const today = localDate(new Date());
  const marks = calendar(state, today);
  const grid = element('div', '', 'calendar');
  for (const day of '月火水木金土日') {
    grid.append(element('span', day, 'dim calendar-heading'));
  }
  const [year, month, day] = weekStart(today).split('-').map(Number);
  for (let i = 0; i < 84; i++) {
    const date = localDate(new Date(year, month - 1, day - 77 + i));
    const mark = marks[date];
    const button = action(shortDate(date), () => {
      historyDate = date;
      render();
      // The detail renders below 12 calendar rows, off screen on a phone.
      view.querySelector('.history > section:last-child')?.scrollIntoView({ block: 'start' });
    }, `bar calendar-day${mark ? ` ${mark}` : ''}${date === today ? ' today' : ''}`);
    button.disabled = date > today;
    button.setAttribute('aria-label',
      `${date}${mark ? ` ${{ done: 'トレーニング', light: '軽めの日', rest: '休養' }[mark]}` : ''}`);
    button.setAttribute('aria-pressed', String(historyDate === date));
    grid.append(button);
  }
  parent.append(grid);
  if (historyDate) renderDayHistory(parent, historyDate);
}

function renderDayHistory(parent, date) {
  const section = element('section', '', 'ex stack');
  section.append(element('h2', shortDate(date)));
  const sessions = state.sessions.filter(session => session.date === date);
  if (!sessions.length) {
    const skips = state.skips.filter(skip => skip.date === date);
    if (skips.length) {
      for (const skip of skips) {
        section.append(element('p', `休み（${skip.reason}）`));
      }
    } else {
      section.append(element('p', '記録なし', 'dim'));
    }
    parent.append(section);
    return;
  }
  for (const session of sessions) {
    if (session.light) section.append(element('p', '軽めの日', 'dim'));
    for (const ex of state.exercises) {
      const sets = session.sets.filter(set => set.exerciseId === ex.id);
      if (!sets.length) continue;
      const group = element('div', '', 'stack');
      group.append(element('h3', ex.name));
      sets.forEach((set, index) => {
        const row = element('div', '', 'stack');
        if (ex.type === 'band' || ex.type === 'weight') {
          const chips = element('div', '', 'chips');
          const name = ex.type === 'band'
            ? state.bands.find(band => band.id === set.bandId)?.name ?? 'なし'
            : `${set.kg ?? 0}kg`;
          chips.append(element('span', name, 'chip on'));
          row.append(chips);
        }
        const time = ex.type === 'time';
        row.append(
          stepper(`${ex.name} ${index + 1}セット`, value(ex, set),
            0, Infinity, time ? 5 : 1, next => {
              set[time ? 'sec' : 'reps'] = next;
              save();
              render();
            }, time ? '秒' : '回'),
          action('削除', () => {
            session.sets.splice(session.sets.indexOf(set), 1);
            if (!session.sets.length) {
              state.sessions = state.sessions.filter(item => item !== session);
            }
            save();
            render();
          }, 'danger')
        );
        group.append(row);
      });
      section.append(group);
    }
    const label = element('label', '', 'stack');
    const note = element('textarea');
    note.value = session.note;
    note.addEventListener('input', () => {
      session.note = note.value;
      save();
    });
    label.append(element('span', 'メモ'), note);
    section.append(label);
  }
  section.append(action('この日の記録を削除', async () => {
    if (!await confirmDialog('この日の記録を削除します。よろしいですか？')) return;
    state.sessions = state.sessions.filter(session => session.date !== date);
    save();
    render();
  }, 'danger'));
  parent.append(section);
}

const parts = ['胸', '背中', '脚', '肩', '腕', '体幹', '全身'];
const exerciseTypes = [
  ['reps', '自重'],
  ['band', 'バンド'],
  ['time', '時間'],
  ['weight', '重り']
];
let showArchived = false;

function element(tag, text = '', className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}

function action(text, onClick, className = '') {
  const button = element('button', text, className);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

function settingsSection(title) {
  const section = element('section', '', 'ex stack');
  section.append(element('h2', title));
  view.append(section);
  return section;
}

function settingsEditor(title) {
  dock.className = 'dock';
  dock.replaceChildren(action('キャンセル', renderSettings));
  view.replaceChildren(element('h1', title));
  const form = element('form', '', 'ex stack');
  form.addEventListener('submit', event => event.preventDefault());
  view.append(form);
  return form;
}

function textField(parent, title, value, onInput) {
  const label = element('label', '', 'stack');
  const input = element('input');
  input.type = 'text';
  input.value = value;
  input.addEventListener('input', () => onInput(input.value));
  label.append(element('span', title), input);
  parent.append(label);
  return input;
}

function choices(parent, title, options, selected, onSelect) {
  const group = element('fieldset', '', 'stack');
  const buttons = element('div', '', 'chips');
  group.append(element('legend', title), buttons);
  for (const [value, text] of options) {
    const button = action(text, () => onSelect(value),
      `chip${value === selected ? ' on' : ''}`);
    button.setAttribute('aria-pressed', String(value === selected));
    buttons.append(button);
  }
  parent.append(group);
}

function stepper(title, value, min, max, step, onChange, unit = '') {
  const group = element('div', '', 'stack');
  const row = element('div', '', 'stepper');
  const minus = action('−', () => onChange(Math.max(min, value - step)), 'pm');
  const plus = action('＋', () => onChange(Math.min(max, value + step)), 'pm');
  minus.disabled = value <= min;
  plus.disabled = value >= max;
  minus.setAttribute('aria-label', `${title}を減らす`);
  plus.setAttribute('aria-label', `${title}を増やす`);
  const output = element('output', String(value), 'num val');
  output.setAttribute('aria-label', title);
  if (unit) output.append(element('small', unit));
  row.append(minus, output, plus);
  group.append(element('span', title), row);
  return group;
}

function moveItem(items, index, offset) {
  [items[index], items[index + offset]] = [items[index + offset], items[index]];
}

function renderSettings() {
  dock.replaceChildren();
  view.replaceChildren(element('h1', '設定'));

  const exercises = settingsSection('種目');
  exercises.append(action('種目を追加', () => editExercise()));
  const toggle = action('アーカイブ済みを表示', () => {
    showArchived = !showArchived;
    render();
  }, `chip${showArchived ? ' on' : ''}`);
  toggle.setAttribute('aria-pressed', String(showArchived));
  exercises.append(toggle);
  for (const part of parts) {
    const items = state.exercises.filter(ex =>
      ex.part === part && (showArchived || !ex.archived));
    if (!items.length) continue;
    const group = element('div', '', 'stack');
    group.append(element('h3', part));
    for (const ex of items) {
      const button = action('', () => editExercise(ex), 'settings-item');
      button.append(element('span', ex.name, 'name'));
      if (ex.archived) button.append(element('span', 'アーカイブ済み', 'dim'));
      group.append(button);
    }
    exercises.append(group);
  }

  const bands = settingsSection('バンド');
  bands.append(action('バンドを追加', () => editBand()));
  const orderedBands = [...state.bands].sort((a, b) => a.order - b.order);
  orderedBands.forEach((band, index) => {
    const row = element('div', '', 'head');
    const edit = action('', () => editBand(band), 'settings-item');
    edit.append(element('span', band.name, 'name'));
    if (band.note) edit.append(element('span', band.note, 'dim'));
    const controls = element('div', '', 'actions');
    for (const [offset, text] of [[-1, '↑'], [1, '↓']]) {
      const button = action(text, () => {
        moveItem(orderedBands, index, offset);
        orderedBands.forEach((item, i) => { item.order = i + 1; });
        state.bands = orderedBands;
        save();
        render();
      });
      button.disabled = index + offset < 0 || index + offset >= orderedBands.length;
      button.setAttribute('aria-label', `${band.name}を${offset < 0 ? '上' : '下'}へ`);
      controls.append(button);
    }
    row.append(edit, controls);
    bands.append(row);
  });

  const templates = settingsSection('テンプレート');
  templates.append(action('テンプレートを追加', () => editTemplate()));
  for (const template of state.templates) {
    templates.append(action(template.name, () => editTemplate(template), 'settings-item'));
  }

  const general = settingsSection('一般');
  general.append(
    stepper('休憩秒数', state.settings.restSec, 30, 300, 15, value => {
      state.settings.restSec = value;
      save();
      render();
    }, '秒')
  );

  renderGithubSettings();

  const backup = settingsSection('バックアップ');
  const file = element('input');
  file.type = 'file';
  file.hidden = true;
  file.addEventListener('change', async () => {
    const selected = file.files[0];
    if (!selected) return;
    let imported;
    try {
      imported = parseImport(await selected.text());
    } catch (error) {
      toast(error.message);
      file.value = '';
      return;
    }
    const confirmed = await confirmDialog('今の記録を読み込んだ内容で置き換えます。よろしいですか？');
    file.value = '';
    if (!confirmed) return;
    state = imported;
    save();
    render();
  });
  backup.append(
    action('書き出し', () => {
      const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = element('a');
      link.href = url;
      link.download = `kintore-${localDate(new Date())}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }),
    action('読み込み', () => file.click()),
    file
  );

  const consult = settingsSection('AIに相談');
  consult.append(action('AIに相談', async () => {
    try {
      await navigator.clipboard.writeText(consultText(state, localDate(new Date())));
    } catch {
      toast('コピーできませんでした');
      return;
    }
    toast('コピーしました。ChatGPT に貼り付けて送ってください');
    window.open('https://chatgpt.com/', '_blank');
  }));
}

function renderGithubSettings() {
  const section = settingsSection('GitHub 保存');
  const form = element('form', '', 'stack');
  const draft = { owner: github.owner, repo: github.repo, token: github.token };
  for (const key of ['owner', 'repo', 'token']) {
    const input = textField(form, key, draft[key], value => { draft[key] = value; });
    if (key === 'token') input.type = 'password';
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    clearTimeout(syncTimeout);
    syncVersion++;
    github = {
      owner: draft.owner.trim(),
      repo: draft.repo.trim(),
      token: draft.token.trim(),
      lastSyncAt: github.lastSyncAt,
      dirty: github.dirty
    };
    if (configured()) github.dirty = true;
    saveGithub();
    render();
    if (configured()) pushData();
  });
  const saveButton = element('button', '保存', 'primary');
  saveButton.type = 'submit';
  form.append(saveButton);
  const link = element('a', 'トークンの作り方');
  link.href = 'https://github.com/settings/personal-access-tokens/new';
  link.className = 'settings-item';
  link.style.minHeight = '48px';
  link.style.color = 'var(--primary)';
  const status = element('p', syncStatus(), 'dim');
  status.dataset.syncStatus = '';
  const buttons = element('div', '', 'actions');
  const push = action('今すぐ保存', pushData);
  const restore = action('GitHub から復元', restoreGithub);
  push.disabled = restore.disabled = !configured();
  buttons.append(push, restore);
  section.append(
    form,
    link,
    element('p', '対象はデータ用リポジトリ1つ、権限は Contents の Read and write だけ', 'dim'),
    buttons,
    status
  );
}

function editExercise(existing) {
  const draft = existing ? { ...existing } : {
    id: uid('e'),
    name: '',
    type: 'reps',
    part: '胸',
    nextId: null,
    archived: false
  };

  function draw() {
    const form = settingsEditor('種目');
    const saveButton = action('保存', () => {
      draft.name = draft.name.trim();
      if (!draft.name) return;
      if (existing) Object.assign(existing, draft);
      else state.exercises.push(draft);
      save();
      render();
    }, 'primary');
    saveButton.disabled = !draft.name.trim();
    textField(form, '名前', draft.name, value => {
      draft.name = value;
      saveButton.disabled = !value.trim();
    });
    choices(form, 'タイプ', exerciseTypes, draft.type, type => {
      draft.type = type;
      draw();
    });
    choices(form, '部位', parts.map(part => [part, part]), draft.part, part => {
      draft.part = part;
      draw();
    });
    const label = element('label', '', 'stack');
    const select = element('select');
    const none = element('option', 'なし');
    none.value = '';
    select.append(none);
    for (const ex of state.exercises) {
      if (ex.archived || ex.id === draft.id) continue;
      const option = element('option', ex.name);
      option.value = ex.id;
      select.append(option);
    }
    select.value = draft.nextId ?? '';
    select.addEventListener('change', () => {
      draft.nextId = select.value || null;
    });
    label.append(element('span', '次の段階'), select);
    form.append(label);
    dock.prepend(saveButton);
    if (existing && !existing.archived) {
      dock.insertBefore(action('アーカイブ', () => {
        existing.archived = true;
        save();
        render();
      }, 'danger'), dock.lastElementChild);
    }
  }

  draw();
}

function editBand(existing) {
  const draft = existing ? { ...existing } : {
    id: uid('b'),
    name: '',
    order: Math.max(0, ...state.bands.map(band => band.order)) + 1,
    note: ''
  };
  const form = settingsEditor('バンド');
  const saveButton = action('保存', () => {
    draft.name = draft.name.trim();
    if (!draft.name) return;
    if (existing) Object.assign(existing, draft);
    else state.bands.push(draft);
    save();
    render();
  }, 'primary');
  saveButton.disabled = !draft.name.trim();
  textField(form, '名前', draft.name, value => {
    draft.name = value;
    saveButton.disabled = !value.trim();
  });
  textField(form, 'メモ', draft.note, value => { draft.note = value; });
  dock.prepend(saveButton);
  const used = existing && state.sessions.some(session =>
    session.sets.some(set => set.bandId === existing.id));
  if (existing && !used) {
    dock.insertBefore(action('削除', () => {
      state.bands = state.bands.filter(band => band.id !== existing.id);
      state.bands.sort((a, b) => a.order - b.order);
      state.bands.forEach((band, i) => { band.order = i + 1; });
      save();
      render();
    }, 'danger'), dock.lastElementChild);
  }
}

function editTemplate(existing) {
  const draft = existing ? { ...existing, exerciseIds: [...existing.exerciseIds] } : {
    id: uid('t'),
    name: '',
    exerciseIds: [],
    sets: 3
  };

  function draw() {
    const form = settingsEditor('テンプレート');
    const saveButton = action('保存', () => {
      draft.name = draft.name.trim();
      if (!draft.name || !draft.exerciseIds.length) return;
      if (existing) Object.assign(existing, draft);
      else state.templates.push(draft);
      save();
      render();
    }, 'primary');
    saveButton.disabled = !draft.name.trim() || !draft.exerciseIds.length;
    textField(form, '名前', draft.name, value => {
      draft.name = value;
      saveButton.disabled = !value.trim() || !draft.exerciseIds.length;
    });
    draft.exerciseIds.forEach((id, index) => {
      const name = state.exercises.find(ex => ex.id === id)?.name ?? '';
      const row = element('div', '', 'head');
      const controls = element('div', '', 'actions');
      for (const [offset, text] of [[-1, '↑'], [1, '↓']]) {
        const button = action(text, () => {
          moveItem(draft.exerciseIds, index, offset);
          draw();
        });
        button.disabled = index + offset < 0 || index + offset >= draft.exerciseIds.length;
        button.setAttribute('aria-label', `${name}を${offset < 0 ? '上' : '下'}へ`);
        controls.append(button);
      }
      const remove = action('外す', () => {
        draft.exerciseIds.splice(index, 1);
        draw();
      });
      remove.setAttribute('aria-label', `${name}を外す`);
      controls.append(remove);
      row.append(element('span', name, 'name'), controls);
      form.append(row);
    });
    const label = element('label', '', 'stack');
    const select = element('select');
    const placeholder = element('option', '種目を選択');
    placeholder.value = '';
    select.append(placeholder);
    for (const ex of state.exercises) {
      if (ex.archived || draft.exerciseIds.includes(ex.id)) continue;
      const option = element('option', ex.name);
      option.value = ex.id;
      select.append(option);
    }
    select.addEventListener('change', () => {
      if (!select.value) return;
      draft.exerciseIds.push(select.value);
      draw();
    });
    label.append(element('span', '種目を追加'), select);
    form.append(
      label,
      stepper('セット数', draft.sets, 1, 6, 1, value => {
        draft.sets = value;
        draw();
      })
    );
    dock.prepend(saveButton);
  }

  draw();
}

function toast(text) {
  clearTimeout(toastTimeout);
  toastElement.textContent = text;
  toastElement.hidden = false;
  toastTimeout = setTimeout(() => {
    toastElement.hidden = true;
  }, 4000);
}

/** @returns {Promise<boolean>} */
function confirmDialog(text) {
  document.querySelector('#confirm-text').textContent = text;
  dialog.returnValue = '';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'confirm');
    }, { once: true });
    dialog.showModal();
  });
}

for (const button of tabs) {
  button.addEventListener('click', () => go(button.dataset.tab));
}

render();
if (github.dirty) pushData();
fetchFeedback();

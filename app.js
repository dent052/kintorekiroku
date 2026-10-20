import {
  localDate, parseImport, value, load, recent, totalDays, feed, mergeFeed,
  firstSet, line, firstSetResult, lineText, prefill, rows, prKind,
  menuExercises, setHistory, clearCount, weekHeat, history, bodyAvg7,
  weekStart, toBase64Utf8, consultText, parsePosts
} from './logic.js';

/** @typedef {import('./logic.js').Data} Data */

const app = document.querySelector('.app');
const view = document.querySelector('.see');
const dock = document.querySelector('.press');
const tabs = document.querySelector('.tabs');
const toastElement = document.querySelector('#toast');
const dialog = document.querySelector('#confirm-dialog');
let currentMode = 'today';
let screen = { mode: 'today', depth: 0 };
let pendingTab = null;
let menu;
let toastTimeout;
let recordsView = 'exercise';
try {
  if (JSON.parse(localStorage.getItem('kintore:recordsView')) === 'day') recordsView = 'day';
} catch {}

window.history.replaceState(screen, '');

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
menu = loadMenu();

function save() {
  const updatedAt = state.updatedAt;
  state.updatedAt = new Date().toISOString();
  try {
    // shortcut: localStorage は約5MB上限、10年分程度で IndexedDB へ移行
    localStorage.setItem('kintore:data', JSON.stringify(state));
  } catch {
    state.updatedAt = updatedAt;
    toast('保存できませんでした。もう一度押してください');
    return false;
  }
  scheduleSync();
  return true;
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
    if (currentMode === 'today' || currentMode === 'records') render();
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

function loadMenu() {
  try {
    const stored = JSON.parse(localStorage.getItem('kintore:menu'));
    if (stored?.kind === 'same' ||
        (stored?.kind === 'template' && typeof stored.templateId === 'string') ||
        (stored?.kind === 'custom' && Array.isArray(stored.exerciseIds))) return stored;
  } catch {}
  return state.sessions.length ? { kind: 'same' } : { kind: 'custom', exerciseIds: [] };
}

function saveMenu(next) {
  try {
    localStorage.setItem('kintore:menu', JSON.stringify(next));
  } catch {
    toast('保存できませんでした。容量を確認してください');
    return false;
  }
  menu = next;
  return true;
}

function lightToday() {
  try {
    return JSON.parse(localStorage.getItem('kintore:light')) === localDate(new Date());
  } catch {
    return false;
  }
}

function showScreen(next) {
  if (currentMode === 'train' && next.mode !== 'train') {
    wakeLock?.release().catch(() => {});
    wakeLock = null;
  }
  screen = next;
  currentMode = next.mode;
  render();
  if (currentMode === 'train') requestWakeLock();
}

function go(mode, details = {}) {
  const next = { mode, depth: screen.depth + (mode === 'summary' ? 0 : 1), ...details };
  if (mode === 'summary' || window.history.state?.sheet) {
    window.history.replaceState(next, '');
  } else {
    window.history.pushState(next, '');
  }
  showScreen(next);
}

function selectTab(mode) {
  if (mode === 'today') {
    returnHome();
    return;
  }
  if (screen.depth > 1) {
    pendingTab = mode;
    window.history.go(1 - screen.depth);
    return;
  }
  if (currentMode === mode) return;
  if (currentMode === 'today') {
    go(mode);
    return;
  }
  const next = { mode, depth: 1 };
  window.history.replaceState(next, '');
  showScreen(next);
}

function returnHome() {
  if (currentMode === 'summary') {
    training = null;
    saveTraining();
  }
  if (screen.depth) window.history.go(-screen.depth);
  else if (currentMode !== 'today') showScreen({ mode: 'today', depth: 0 });
}

function back() {
  window.history.back();
}

window.addEventListener('popstate', event => {
  const next = event.state ?? { mode: 'today', depth: 0 };
  const open = [...document.querySelectorAll('dialog[open]')].at(-1);
  if (open && open.dataset.historySheet !== next.sheet) open.close();
  if (next.sheet) return;
  if (!open && currentMode === 'summary') {
    training = null;
    saveTraining();
  }
  const { sheet, ...destination } = next;
  showScreen(destination);
  if (pendingTab) {
    const mode = pendingTab;
    pendingTab = null;
    selectTab(mode);
  }
});

function trackSheet(sheet) {
  const token = uid('sheet');
  sheet.dataset.historySheet = token;
  const next = { ...screen, sheet: token };
  // シートを続けて開く操作では、閉じかけのシートの履歴を引き継ぐ。
  if (window.history.state?.sheet && !document.querySelector('dialog[open]')) {
    window.history.replaceState(next, '');
  } else {
    window.history.pushState(next, '');
  }
  sheet.addEventListener('close', () => {
    if (window.history.state?.sheet === token) window.history.back();
  }, { once: true });
}

function homeButton() {
  const button = action('ホーム', returnHome, 'home');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', 'M2 8 8 2.5 14 8M4 7v6.5h8V7');
  svg.append(path);
  button.prepend(svg);
  return button;
}

function renderTabs() {
  tabs.hidden = !['today', 'records', 'detail', 'exercises', 'settings'].includes(currentMode);
  tabs.replaceChildren();
  const icons = [
    ['today', 'ホーム', '<path d="M3 11 12 3.5 21 11M5.5 9.5V20h13V9.5"/>'],
    ['records', '記録', '<path d="M4 20V14h5V9h5V4h6v16z"/>'],
    ['exercises', '種目', '<path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>'],
    ['settings', '設定', '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>']
  ];
  for (const [mode, name, drawing] of icons) {
    const button = action(name, () => selectTab(mode));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = drawing;
    button.prepend(svg);
    if (mode === (currentMode === 'detail' ? 'records' : currentMode)) {
      button.setAttribute('aria-current', 'page');
    }
    tabs.append(button);
  }
}

let swipeStart = null;
app.addEventListener('touchstart', event => {
  const touch = event.touches[0];
  swipeStart = event.touches.length === 1 &&
    !event.target.closest('input, textarea, select, .chips')
    ? { x: touch.clientX, y: touch.clientY, t: Date.now() } : null;
}, { passive: true });
app.addEventListener('touchcancel', () => { swipeStart = null; });
app.addEventListener('touchend', event => {
  if (!swipeStart) return;
  const touch = event.changedTouches[0];
  const dx = touch.clientX - swipeStart.x;
  const dy = touch.clientY - swipeStart.y;
  const elapsed = Date.now() - swipeStart.t;
  swipeStart = null;
  if (elapsed > 700 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2) return;
  if (currentMode !== 'train') return;
  moveExercise(dx < 0 ? 1 : -1);
  view.classList.remove('slide-next', 'slide-prev');
  void view.offsetWidth;
  view.classList.add(dx < 0 ? 'slide-next' : 'slide-prev');
}, { passive: true });

function render() {
  stopCounter();
  app.dataset.mode = currentMode;
  view.className = currentMode === 'settings' || currentMode.endsWith('-editor')
    ? 'see slab' : ['records', 'exercises'].includes(currentMode) ? 'see list' : 'see';
  view.replaceChildren();
  view.scrollTop = 0;
  dock.className = ['today', 'exercises'].includes(currentMode) ? 'press slim' : 'press';
  dock.replaceChildren();
  renderTabs();
  if (currentMode === 'today') renderToday();
  else if (currentMode === 'records') renderRecords();
  else if (currentMode === 'detail') renderDetail();
  else if (currentMode === 'exercises') renderExercises();
  else if (currentMode === 'settings') renderSettings();
  else if (currentMode === 'exercise-editor') {
    editExercise(state.exercises.find(ex => ex.id === screen.id), false);
  } else if (currentMode === 'band-editor') {
    editBand(state.bands.find(band => band.id === screen.id), false);
  } else if (currentMode === 'template-editor') {
    editTemplate(state.templates.find(template => template.id === screen.id), false);
  } else if (currentMode === 'summary') renderSummary();
  else renderTrain();
  saveTraining();
}

function homeFeed() {
  let posts = [];
  let seen = [];
  try {
    posts = parsePosts(localStorage.getItem('kintore:posts') ?? '[]');
  } catch {}
  try {
    const stored = JSON.parse(localStorage.getItem('kintore:seen'));
    if (Array.isArray(stored)) seen = stored.filter(id => typeof id === 'string');
  } catch {}
  return { items: mergeFeed(feed(state, localDate(new Date())), posts, seen), seen };
}

function markSeen(items) {
  const { seen } = homeFeed();
  const displayed = items.map(item => item.id);
  try {
    localStorage.setItem('kintore:seen', JSON.stringify([
      ...seen.filter(id => !displayed.includes(id)), ...displayed
    ].slice(-500)));
  } catch {
    toast('保存できませんでした。容量を確認してください');
  }
}

function appendFeed(parent, items, full = false) {
  for (const item of items) {
    const post = element('article', '', 'post');
    const coach = ['reply', 'weekly', 'finding', 'reading'].includes(item.kind);
    const body = element('p', '', full ? '' : 'preview');
    body.append(element('b', coach ? 'コーチ' : '記録'), document.createTextNode(item.text));
    post.append(body);
    if (full && item.kind === 'reply' && typeof item.quote === 'string') {
      post.prepend(element('blockquote', item.quote, 'dim'));
    }
    if (full && typeof item.source?.title === 'string') {
      try {
        const url = new URL(item.source.url);
        if (['http:', 'https:'].includes(url.protocol)) {
          const link = element('a', item.source.title);
          link.href = url.href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          post.append(link);
        }
      } catch {}
    }
    parent.append(post);
  }
}

function menuName() {
  if (menu.kind === 'template') {
    const template = state.templates.find(item => item.id === menu.templateId);
    if (template) return template.name;
  }
  return menu.kind === 'custom' ? '種目を選ぶ' : '前回と同じ';
}

function renderToday() {
  view.replaceChildren();
  dock.replaceChildren();
  const now = new Date();
  const today = localDate(now);
  const date = element('div', '', 'date');
  date.append(element('span',
    now.getMonth() + 1 + '月' + now.getDate() + '日 ' + '日月火水木金土'[now.getDay()] + '曜', 'k'));
  const total = element('span');
  total.append(element('span', '通算 ', 'k'), element('span', String(totalDays(state)), 'num'),
    element('span', ' 日', 'k'));
  date.append(total);
  view.append(date);

  const head = element('div', '', 'head');
  const hello = element('p', '', 'hello');
  hello.append(element('small', '今日のメニュー'), document.createTextNode(menuName()));
  const picker = action('種目を変える', () => changeMenu(), 'pill');
  const pencil = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  pencil.setAttribute('viewBox', '0 0 16 16');
  pencil.setAttribute('aria-hidden', 'true');
  pencil.innerHTML = '<path d="M3 13h3l7-7-3-3-7 7z"/>';
  picker.prepend(pencil);
  head.append(hello, picker);
  view.append(head);

  if (!state.exercises.some(ex => !ex.archived)) {
    view.append(element('p', 'まず種目を登録しましょう', 'lines'));
    dock.append(action('＋ 新しい種目',
      () => go('exercise-editor', { addToMenu: true }), 'go'));
  } else {
    const lines = element('div', '', 'lines');
    for (const id of menuExercises(state, menu, today)) {
      const ex = state.exercises.find(item => item.id === id);
      const target = line(state, id, today);
      const [previous] = recent(state, id, today, 1);
      const first = previous && firstSet(state, ex, previous);
      const result = first && firstSetResult(state, id, previous.date, first);
      let detail = first ? '前回 ' + value(ex, first) + (ex.type === 'time' ? '秒' : '') : '初回';
      if (result?.kind === 'clear') detail += ' ・ 突破';
      if (result?.kind === 'short') detail += ' ・ あと' + result.diff;
      if (ex.type === 'band') {
        const band = state.bands.find(item => item.id === first?.bandId) ??
          [...state.bands].sort((a, b) => a.order - b.order)[0];
        if (band) detail = band.name + ' ・ ' + detail;
      }
      const row = action('', () => go('detail', { id, from: 'today' }), 'ln tap');
      row.dataset.exerciseId = id;
      const name = element('span', ex.name, 'name');
      name.append(element('small', detail));
      const number = element('span', '', 'num' + (result?.kind === 'short' ? ' carry' : ''));
      if (target.kind === 'base' || target.kind === 'up') {
        number.classList.add('word');
        number.textContent = target.kind === 'base' ? '初回' : target.next + 'へ';
      } else {
        number.append(document.createTextNode(String(target.value)));
        if (ex.type === 'time') number.append(element('small', '秒'));
      }
      row.append(name, miniChart(id), number, element('span', '›', 'chev'));
      lines.append(row);
    }
    view.append(lines);
    const resume = training?.date === today;
    dock.append(action(resume ? '続きから' : '始める',
      () => resume ? go('train') : startWorkout(), 'go'));
  }

  const news = element('div', '', 'feed');
  news.append(element('p', '今週', 'k'));
  const week = element('div', '', 'week');
  const [year, month, day] = weekStart(today).split('-').map(Number);
  const days = new Set(state.sessions.filter(session => session.sets.length)
    .map(session => session.date));
  [...'月火水木金土日'].forEach((name, index) => {
    const date = localDate(new Date(year, month - 1, day + index));
    const cell = element('span', name);
    const mark = element('i', '', [days.has(date) ? 'd' : '', date === today ? 't' : '']
      .filter(Boolean).join(' '));
    cell.append(mark);
    week.append(cell);
  });
  news.append(week);
  const quick = element('div', '', 'quick');
  quick.append(action('今日は休む', recordRest, 'pill'),
    action('体重を記録', recordBody, 'pill'));
  news.append(quick);
  view.append(news);
  fetchFeedback();
}

function miniChart(id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'mini');
  svg.setAttribute('viewBox', '0 0 64 28');
  svg.setAttribute('aria-hidden', 'true');
  const entries = id === 'body'
    ? [...state.body].sort((a, b) => a.date.localeCompare(b.date))
      .map(entry => ({ value: entry.kg }))
    : setHistory(state, id);
  const points = (id === 'body' ? entries :
    entries.filter(point => point.load === entries.at(-1)?.load)).slice(-8);
  if (points.length < 2) return svg;
  const min = Math.min(...points.map(point => point.value));
  const max = Math.max(...points.map(point => point.value));
  const y = point => min === max ? 14 : 24 - (point.value - min) / (max - min) * 20;
  let d = 'M0 ' + y(points[0]);
  points.slice(1).forEach((point, index) => {
    const x = (index + 1) / (points.length - 1) * 64;
    d += ' L' + x + ' ' + y(point);
  });
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'var(--ai)');
  path.setAttribute('stroke-width', '2.5');
  svg.append(path);
  return svg;
}

function homeSheet(title) {
  const sheet = element('dialog', '', 'sheet');
  sheet.setAttribute('aria-label', title);
  sheet.append(element('h2', title));
  const content = element('div', '', 'stack');
  const actions = element('div', '', 'dialog-actions sub');
  actions.append(action('閉じる', () => sheet.close()));
  sheet.append(content, actions);
  trackSheet(sheet);
  sheet.addEventListener('close', () => sheet.remove(), { once: true });
  document.body.append(sheet);
  sheet.showModal();
  return { sheet, content };
}

function changeMenu(onSelect) {
  const today = localDate(new Date());
  let draft = { ...menu };
  let selected = menuExercises(state, menu, today)
    .filter(id => state.exercises.some(ex => ex.id === id && !ex.archived));
  let light = lightToday();
  const { sheet, content } = homeSheet('今日の種目');
  sheet.classList.add('picker');

  function draw() {
    content.replaceChildren();
    const chips = element('div', '', 'chips2');
    for (const [name, next] of [
      ['前回と同じ', { kind: 'same' }],
      ...state.templates.map(template =>
        [template.name, { kind: 'template', templateId: template.id }])
    ]) {
      const active = draft.kind === next.kind && draft.templateId === next.templateId;
      const button = action(name, () => {
        draft = next;
        selected = menuExercises(state, next, today)
          .filter(id => state.exercises.some(ex => ex.id === id && !ex.archived));
        draw();
      }, 'menu-chip' + (active ? ' on' : ''));
      button.setAttribute('aria-pressed', String(active));
      chips.append(button);
    }
    content.append(chips);
    for (const ex of state.exercises.filter(ex => !ex.archived)) {
      const checked = selected.includes(ex.id);
      const button = action('', () => {
        if (checked) selected = selected.filter(id => id !== ex.id);
        else selected.push(ex.id);
        draft = { kind: 'custom', exerciseIds: [...selected] };
        draw();
      }, 'check' + (checked ? ' on' : ''));
      button.dataset.exerciseId = ex.id;
      button.setAttribute('aria-pressed', String(checked));
      const mark = element('i');
      mark.setAttribute('aria-hidden', 'true');
      const name = element('span', ex.name + ' ');
      name.append(element('small', ex.part));
      const target = line(state, ex.id, today);
      const detail = target.kind === 'base' ? '初回' :
        target.kind === 'up' ? target.next + 'へ' :
          'ライン ' + target.value + (ex.type === 'time' ? '秒' : '');
      button.append(mark, name, element('small', detail));
      content.append(button);
    }
    content.append(action('＋ 新しい種目を作る', () => {
      // シートの履歴を戻してから編集画面を積む。
      window.addEventListener('popstate',
        () => go('exercise-editor', { addToMenu: true }), { once: true });
      sheet.close();
    }, 'addrow'));
    const toggle = action('軽めの日（各1セット）', () => {
      light = !light;
      draw();
    }, 'toggle' + (light ? ' on' : ''));
    toggle.setAttribute('aria-pressed', String(light));
    const knob = element('i');
    knob.setAttribute('aria-hidden', 'true');
    toggle.append(knob);
    const done = action('決定', () => {
      if (!selected.length) return;
      try {
        if (light) localStorage.setItem('kintore:light', JSON.stringify(localDate(new Date())));
        else localStorage.removeItem('kintore:light');
      } catch {
        toast('保存できませんでした。容量を確認してください');
        return;
      }
      if (!saveMenu(draft)) return;
      if (typeof onSelect === 'function') {
        window.addEventListener('popstate', onSelect, { once: true });
      }
      sheet.close();
      render();
    }, 'go sm');
    done.disabled = !selected.length;
    content.append(toggle, done);
  }

  draw();
}

let training = null;
let rest = null;
let restInterval;
let wakeLock = null;
let stopCounter = () => {};

function saveTraining() {
  try {
    if (training) {
      localStorage.setItem('kintore:training', JSON.stringify({ training, rest }));
    } else {
      localStorage.removeItem('kintore:training');
    }
    return true;
  } catch {
    toast('保存できませんでした。もう一度押してください');
    return false;
  }
}

function loadTraining() {
  try {
    const stored = JSON.parse(localStorage.getItem('kintore:training'));
    const saved = stored?.training;
    if (!saved || saved.date !== localDate(new Date()) ||
        !Array.isArray(saved.entries) || !saved.entries.length ||
        !Number.isInteger(saved.index) || saved.index < 0 || saved.index >= saved.entries.length ||
        !saved.entries.every(entry => state.exercises.some(ex => ex.id === entry.id) &&
          Array.isArray(entry.sets) && entry.sets.length &&
          Number.isInteger(entry.goal) && entry.goal > 0)) {
      localStorage.removeItem('kintore:training');
      return;
    }
    training = saved;
    if (Number.isFinite(stored.rest?.end) && stored.rest.end > Date.now() &&
        Number.isFinite(stored.rest.duration) && stored.rest.duration > 0) {
      rest = stored.rest;
      if (Date.now() >= rest.verdictUntil) rest.verdict = null;
      restInterval = setInterval(updateRest, 250);
    }
  } catch {
    training = null;
    rest = null;
  }
}

function trainingEntry(id, count) {
  const sets = prefill(state, id, training.date);
  const planned = rows(sets, training.light ? 1 : count ?? sets.length);
  const done = trainingSession()?.sets.filter(set => set.exerciseId === id) ?? [];
  return { id, sets: planned, cursor: done.length, goal: planned.length };
}

function startWorkout(light = lightToday()) {
  const date = localDate(new Date());
  const ids = menuExercises(state, menu, date);
  if (!ids.length) {
    changeMenu(() => startWorkout());
    return;
  }
  const session = state.sessions.find(item => item.date === date);
  const template = menu.kind === 'template'
    ? state.templates.find(item => item.id === menu.templateId) : null;
  endRest(false);
  training = { date, light, index: 0, entries: [],
    note: session?.note ?? '', toCoach: session?.toCoach === true };
  training.entries = ids.map(id => trainingEntry(id, template?.sets));
  go('train');
}

async function requestWakeLock() {
  if (!navigator.wakeLock || currentMode !== 'train' || wakeLock) return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (currentMode !== 'train') {
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
  if (document.visibilityState === 'visible') {
    requestWakeLock();
    updateRest();
  }
});

function trainingSession() {
  return state.sessions.find(item => item.date === training.date);
}

function currentEntry() {
  return training.entries[training.index];
}

function dismissVerdict() {
  if (rest?.verdict) {
    rest.verdict = null;
    saveTraining();
  }
  view.querySelector('.verdict')?.remove();
}

function moveExercise(offset) {
  const next = training.index + offset;
  if (next < 0 || next >= training.entries.length) return;
  dismissVerdict();
  training.index = next;
  render();
}

function trainingTop(resting) {
  const top = element('div', '', 'tr-top');
  const dots = element('div', '', 'dots');
  training.entries.forEach((entry, index) => {
    const count = trainingSession()?.sets.filter(set => set.exerciseId === entry.id).length ?? 0;
    dots.append(element('i', '', index === training.index ? 'on' :
      count >= entry.goal ? 'done' : ''));
  });
  const ex = state.exercises.find(item => item.id === currentEntry().id);
  const count = trainingSession()?.sets.filter(set => set.exerciseId === ex.id).length ?? 0;
  top.append(dots, element('span',
    (training.index + 1) + ' / ' + training.entries.length +
    (resting && count < currentEntry().goal ? ' ・ ' + (count + 1) + 'セット目へ' : ''), 'k'));
  return top;
}

function renderTrainPaper() {
  const entry = currentEntry();
  const ex = state.exercises.find(item => item.id === entry.id);
  const session = trainingSession();
  const done = session?.sets.filter(set => set.exerciseId === ex.id) ?? [];
  entry.cursor = done.length;
  const [previous] = recent(state, ex.id, training.date, 1);
  const previousSets = previous?.sets.filter(set => set.exerciseId === ex.id) ?? [];
  const target = line(state, ex.id, training.date);
  const result = done.length ? firstSetResult(state, ex.id, training.date, done[0]) : null;
  view.replaceChildren(trainingTop(Boolean(rest)), element('h1', ex.name, 'exname'));
  if (rest) {
    if (rest.verdict && Date.now() < rest.verdictUntil) {
      const verdict = element('div', '', 'verdict');
      const detail = element('div');
      detail.append(element('b', rest.verdict.title));
      if (rest.verdict.small) detail.append(element('small', rest.verdict.small));
      verdict.append(element('span', String(rest.verdict.value), 'num'), detail);
      view.append(verdict);
    }
    const bar = element('div', '', 'restbar');
    const track = element('div', '', 'track');
    track.append(element('div'));
    bar.append(element('span', '休憩', 'k'), element('span', '', 'num'), track);
    view.append(bar);
  } else {
    let text = lineText(target, ex);
    if (result?.kind === 'newload') {
      text = '新しい負荷';
    } else if (target.kind === 'up') {
      text = '前回' + (ex.type === 'time' ? '60秒' : '20回') + '以上' +
        (done.length ? ' ・ ' : '。') + target.next + 'を検討';
    } else if (target.value !== undefined) {
      text = 'ライン ' + target.value + (ex.type === 'time' ? '秒' : '') + ' ・ ';
      text += !result ? '1セット目' :
        result.kind === 'clear' ? '突破' : 'あと' + result.diff;
    }
    view.append(element('p', text, 'prev'));
  }
  const table = element('div', '', 'sets');
  const header = element('div', '', 'hd');
  for (const text of ['セット', ex.type === 'time' ? '前回(秒)' : '前回',
    ex.type === 'time' ? '今日(秒)' : '今日', '']) {
    header.append(element('span', text));
  }
  table.append(header);
  for (let index = 0; index < Math.max(entry.goal, done.length); index++) {
    const saved = done[index];
    const current = !saved && index === done.length && done.length < entry.goal;
    const row = saved
      ? action('', () => editSet(session, saved, index), 'r done')
      : element('div', '', 'r' + (current ? ' cur' : ''));
    const today = saved ?? (current ? entry.sets[index] : null);
    const number = setValue(ex, today, 'td');
    if (!today) number.style.color = 'var(--hair)';
    if (index === 0 && saved && result.kind === 'clear') number.classList.add('over');
    row.append(element('span', String(index + 1), 'no'),
      setValue(ex, previousSets[index], 'pv'), number,
      element('span', '', saved ? 'ok' : ''));
    table.append(row);
  }
  view.append(table);
  if (rest) updateRest();
}

function loadText(ex, set) {
  return ex.type === 'band'
    ? state.bands.find(item => item.id === set.bandId)?.name ?? 'なし'
    : ex.type === 'weight' ? set.kg + 'kg' : '';
}

function setText(ex, set) {
  const prefix = loadText(ex, set);
  return (prefix ? prefix + ' ' : '') + value(ex, set) + (ex.type === 'time' ? '秒' : '');
}

function setValue(ex, set, className = '') {
  const number = element('span', set ? String(value(ex, set)) : '—', className);
  if (set && (ex.type === 'band' || ex.type === 'weight')) {
    number.append(document.createTextNode(' '), element('small', loadText(ex, set), 'ed'));
  }
  return number;
}

function appendSetHistory(parent, ex, sets, highlight = false) {
  sets.forEach((set, index) => {
    const load = loadText(ex, set);
    const same = index > 0 && load === loadText(ex, sets[index - 1]);
    if (index) parent.append(document.createTextNode(load && same ? '・' : ' ・ '));
    if (load && !same) parent.append(document.createTextNode(load + ' '));
    parent.append(index === 0 && highlight
      ? element('b', String(value(ex, set)))
      : document.createTextNode(String(value(ex, set))));
  });
  if (ex.type === 'time') parent.append(document.createTextNode('秒'));
}

function renderTrain() {
  if (rest && rest.end <= Date.now()) {
    endRest(true);
    return;
  }
  renderTrainPaper();
  const entry = currentEntry();
  const ex = state.exercises.find(item => item.id === entry.id);
  const finished = entry.cursor >= entry.goal;
  if (rest) {
    const sub = element('div', '', 'sub');
    sub.append(action('+15秒', () => {
      dismissVerdict();
      rest.end += 15000;
      rest.duration += 15000;
      saveTraining();
      updateRest();
    }), action('休憩を終える', () => endRest(false)));
    dock.append(sub);
  }
  if (finished) {
    const sub = element('div', '', 'subgo');
    sub.append(action('＋ もう1セット', () => {
      dismissVerdict();
      const done = trainingSession().sets.filter(set => set.exerciseId === ex.id);
      entry.goal = Math.max(entry.goal, done.length) + 1;
      entry.sets[done.length] = { ...done.at(-1) };
      render();
    }));
    dock.append(sub, training.index === training.entries.length - 1
      ? action('トレーニングを終える', finishWorkout, 'go')
      : action('次の種目へ ▶', () => moveExercise(1), 'go'));
  } else {
    const set = entry.sets[entry.cursor];
    setLoadControls(ex, set, dock, () => {
      dismissVerdict();
      render();
    });
    counter(ex, set);
    dock.append(action((entry.cursor + 1) + 'セット目を完了', completeSet, 'go'));
  }
  const nav = element('div', '', 'nav');
  const previous = action('◀ 前', () => moveExercise(-1));
  previous.disabled = training.index === 0;
  nav.append(homeButton(), previous, action('メモ', trainingMore));
  if (!finished) {
    nav.append(training.index === training.entries.length - 1
      ? action('終了', finishWorkout) : action('次 ▶', () => moveExercise(1)));
  }
  dock.append(nav);
}

function setLoadControls(ex, set, parent, refresh) {
  if (ex.type === 'weight') {
    parent.append(stepper('重さ', set.kg ?? 0, 0, 500, 0.5, (kg, direct) => {
      set.kg = kg;
      if (!direct) refresh();
      else if (parent === dock) {
        dismissVerdict();
        renderTrainPaper();
        saveTraining();
      }
    }, 'kg'));
  }
  if (ex.type === 'band') {
    const chips = element('div', '', 'chips');
    for (const band of [...state.bands].sort((a, b) => a.order - b.order)) {
      const button = action(band.name, () => {
        set.bandId = band.id;
        refresh();
      }, 'chip' + (band.id === set.bandId ? ' on' : ''));
      button.setAttribute('aria-pressed', String(band.id === set.bandId));
      chips.append(button);
    }
    parent.append(chips);
  }
}

function counter(ex, set, parent = dock) {
  const time = ex.type === 'time';
  const step = time ? 5 : 1;
  const max = time ? 600 : 200;
  const key = time ? 'sec' : 'reps';
  const row = element('div', '', 'counter');
  const big = element('div', '', 'big');
  const number = directNumber(set[key], 0, max, false, time ? '秒数' : '回数', next => {
    dismissVerdict();
    set[key] = next;
    if (parent === dock) {
      renderTrainPaper();
      saveTraining();
    }
  });
  big.append(number, element('small', time ? '秒' : '回'));
  function draw() {
    number.textContent = String(set[key]);
  }
  function change(direction) {
    dismissVerdict();
    const next = Math.max(0, Math.min(max, set[key] + direction * step));
    if (next === set[key]) return;
    set[key] = next;
    navigator.vibrate?.(5);
    draw();
    if (parent === dock) {
      renderTrainPaper();
      saveTraining();
    }
  }
  let delay;
  let repeat;
  let pointer = null;
  function stop() {
    clearTimeout(delay);
    clearInterval(repeat);
    pointer = null;
  }
  stopCounter = stop;
  function button(direction) {
    const control = action(direction < 0 ? '−' : '＋', event => {
      // Keyboard and assistive clicks have no pointerdown.
      if (event.detail === 0) change(direction);
    }, 'pm');
    control.setAttribute('aria-label', ex.name + ' ' + (time ? '5秒' : '1回') +
      (direction < 0 ? '減らす' : '増やす'));
    control.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      stop();
      pointer = event.pointerId;
      row.querySelector('input')?.blur();
      change(direction);
      delay = setTimeout(() => {
        change(direction);
        repeat = setInterval(() => change(direction), 100);
      }, 400);
    });
    control.addEventListener('pointermove', event => {
      if (event.pointerId !== pointer) return;
      const bounds = control.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX >= bounds.right ||
          event.clientY < bounds.top || event.clientY >= bounds.bottom) stop();
    });
    for (const event of ['pointerup', 'pointerleave', 'pointercancel', 'lostpointercapture']) {
      control.addEventListener(event, stop);
    }
    return control;
  }
  row.append(button(-1), big, button(1));
  parent.append(row, element('p', '数字を押すと直接入力', 'hint2'));
  draw();
}

function editSet(session, set, index, context) {
  dismissVerdict();
  stopCounter();
  const ex = state.exercises.find(ex => ex.id === set.exerciseId);
  const title = (index + 1) + 'セット目を直す';
  const { sheet, content } = context ?? homeSheet(title);
  const draft = { ...set };
  sheet.addEventListener('close', () => stopCounter(), { once: true });
  sheet.setAttribute('aria-label', title);
  sheet.querySelector('h2').textContent = title;

  function draw() {
    stopCounter();
    content.replaceChildren();
    setLoadControls(ex, draft, content, draw);
    counter(ex, draft, content);
    content.append(action('保存', () => {
      stopCounter();
      const previous = { ...set };
      Object.assign(set, draft);
      if (!save()) {
        Object.assign(set, previous);
        return;
      }
      render();
      if (context) context.back();
      else sheet.close();
    }, 'go sm'));
    const remove = element('div', '', 'subgo');
    remove.append(action('このセットを消す', () => {
      stopCounter();
      const position = session.sets.indexOf(set);
      const sessionPosition = state.sessions.indexOf(session);
      session.sets.splice(position, 1);
      const removedSession = !session.sets.length;
      if (removedSession) state.sessions.splice(sessionPosition, 1);
      if (!save()) {
        if (removedSession) state.sessions.splice(sessionPosition, 0, session);
        session.sets.splice(position, 0, set);
        return;
      }
      render();
      const message = (index + 1) + 'セット目を消しました';
      const undo = () => {
        const restoreSession = !state.sessions.includes(session);
        if (restoreSession) state.sessions.splice(sessionPosition, 0, session);
        session.sets.splice(position, 0, set);
        if (!save()) {
          session.sets.splice(position, 1);
          if (restoreSession) state.sessions.splice(state.sessions.indexOf(session), 1);
          return;
        }
        render();
        if (context) context.back();
      };
      if (context) context.back({ message, undo });
      else {
        sheet.close();
        toast(message, undo);
      }
    }, 'danger'));
    content.append(remove);
  }

  draw();
}

function completeSet() {
  const entry = currentEntry();
  if (entry.cursor >= entry.goal) return;
  const ex = state.exercises.find(item => item.id === entry.id);
  const set = { ...entry.sets[entry.cursor] };
  let session = trainingSession();
  const created = !session;
  const first = !session?.sets.some(item => item.exerciseId === ex.id);
  const result = first ? firstSetResult(state, ex.id, training.date, set) : null;
  if (!session) {
    session = { id: uid('s'), date: training.date, light: training.light,
      note: training.note, toCoach: training.toCoach, sets: [] };
    state.sessions.push(session);
  }
  session.sets.push(set);
  if (!save()) {
    session.sets.pop();
    if (created) state.sessions.splice(state.sessions.indexOf(session), 1);
    return;
  }
  entry.cursor++;
  let verdict = null;
  if (first) {
    let title = '基準';
    let small = '';
    if (result.kind === 'clear' || result.kind === 'short') {
      title = result.kind === 'clear' ? '突破' : 'あと' + result.diff;
      const date = new Date(training.date + 'T12:00:00');
      date.setDate(date.getDate() + 1);
      const next = line(state, ex.id, localDate(date));
      if (result.kind === 'clear') {
        small = next.value === undefined ? lineText(next, ex) :
          '次のライン ' + next.value + (ex.type === 'time' ? '秒' : '');
        navigator.vibrate?.(60);
      } else if (next.value !== undefined) {
        small = '次回のライン ' + next.value + (ex.type === 'time' ? '秒' : '');
      }
    } else if (result.kind === 'previous') {
      title = result.diff > 0 ? '前回より +' + result.diff :
        result.diff < 0 ? '前回より −' + Math.abs(result.diff) : '前回と同じ';
      small = result.next + 'を検討';
    } else if (result.kind === 'newload') {
      title = '新しい負荷';
      small = (loadText(ex, set) || ex.name) + 'の1本目';
    }
    verdict = { value: value(ex, set), title, small };
  }
  clearInterval(restInterval);
  const duration = state.settings.restSec * 1000;
  rest = { end: Date.now() + duration, duration, verdict, verdictUntil: Date.now() + 2500 };
  render();
  restInterval = setInterval(updateRest, 250);
}

function updateRest() {
  if (!rest) return;
  const remaining = Math.max(0, Math.ceil((rest.end - Date.now()) / 1000));
  if (!remaining) {
    endRest(true);
    return;
  }
  if (rest.verdict && Date.now() >= rest.verdictUntil) dismissVerdict();
  const bar = view.querySelector('.restbar');
  if (bar) {
    bar.querySelector('.track > div').style.width = Math.max(0, Math.min(100,
      (rest.end - Date.now()) / rest.duration * 100)) + '%';
    bar.querySelector('.num').textContent =
      Math.floor(remaining / 60) + ':' + String(remaining % 60).padStart(2, '0');
  }
}

function endRest(vibrate) {
  clearInterval(restInterval);
  rest = null;
  saveTraining();
  if (vibrate) navigator.vibrate?.([300, 100, 300]);
  if (currentMode === 'train') render();
}

function trainingMore() {
  dismissVerdict();
  const { sheet, content } = homeSheet('メモ・その他');
  const label = element('label', '', 'stack');
  const note = element('textarea');
  note.value = training.note;
  function saveNote() {
    const session = trainingSession();
    if (session) {
      session.note = training.note;
      session.toCoach = training.toCoach;
      save();
    }
    saveTraining();
  }
  note.addEventListener('input', () => {
    training.note = note.value;
    saveNote();
  });
  label.append(element('span', 'メモ'), note);
  const coach = action('', () => {
    training.toCoach = !training.toCoach;
    saveNote();
    drawCoach();
  }, 'chip');
  function drawCoach() {
    coach.textContent = 'コーチに送る：' + (training.toCoach ? 'オン' : 'オフ');
    coach.setAttribute('aria-pressed', String(training.toCoach));
  }
  drawCoach();
  content.append(label, coach, action('種目を追加', () => {
    content.replaceChildren();
    for (const ex of state.exercises.filter(item => !item.archived &&
        !training.entries.some(entry => entry.id === item.id))) {
      content.append(action(ex.name, () => {
        training.entries.push(trainingEntry(ex.id));
        training.index = training.entries.length - 1;
        sheet.close();
        render();
      }));
    }
  }));
  const ex = state.exercises.find(item => item.id === currentEntry().id);
  if (ex.nextId && state.exercises.some(item => item.id === ex.nextId)) {
    content.append(action('次の段階へ切り替え', () => {
      const index = training.entries.findIndex(entry => entry.id === ex.nextId);
      if (index >= 0) training.index = index;
      else training.entries[training.index] = trainingEntry(ex.nextId);
      sheet.close();
      render();
    }));
  }
  content.append(action('トレーニングをやめる', () => {
    // シートの履歴を戻してから、トレーニングをまとめに置き換える。
    window.addEventListener('popstate', finishWorkout, { once: true });
    sheet.close();
  }));
}

function finishWorkout() {
  endRest(false);
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  go('summary');
}

function renderSummary() {
  view.append(element('h1', '今日の記録', 'exname'));
  const session = trainingSession();
  const ids = [...new Set(session?.sets.map(set => set.exerciseId) ?? [])];
  const bests = session ? session.sets.filter(set => prKind(state, set, session.id) === 'pr')
    .map(set => set.exerciseId) : [];
  for (const id of ids) {
    const ex = state.exercises.find(item => item.id === id);
    const row = element('div', '', 'sumrow');
    row.dataset.exerciseId = id;
    const name = element('p', ex.name, 'n');
    if (bests.includes(id)) name.append(element('em', '自己ベスト'));
    const numbers = element('p', '', 't');
    appendSetHistory(numbers, ex, session.sets.filter(set => set.exerciseId === id));
    const previous = [...state.sessions].filter(item => item.date < training.date &&
      item.sets.some(set => set.exerciseId === id))
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    const last = element('p', previous ? '前回 ' : '初回', 'p');
    if (previous) appendSetHistory(last, ex, previous.sets.filter(set => set.exerciseId === id));
    row.append(name, numbers, last);
    view.append(row);
  }
  dock.append(action('ホームへ', returnHome, 'go'));
}

function openNews() {
  const { items } = homeFeed();
  const { content } = homeSheet('新着');
  appendFeed(content, [...items].sort((a, b) => b.at.localeCompare(a.at)), true);
  markSeen(items);
  if (currentMode === 'records') render();
}

function renderRecords() {
  const today = localDate(new Date());
  const { items, seen } = homeFeed();
  const unread = items.filter(item => !seen.includes(item.id)).length;
  view.append(element('h1', '記録', 'h1'));
  const segments = element('div', '', 'seg');
  for (const [kind, label] of [['exercise', '種目ごと'], ['day', '日ごと']]) {
    const button = action(label, () => {
      try {
        localStorage.setItem('kintore:recordsView', JSON.stringify(kind));
      } catch {
        toast('保存できませんでした。もう一度押してください');
        return;
      }
      recordsView = kind;
      render();
    }, kind === recordsView ? 'on' : '');
    button.setAttribute('aria-pressed', String(kind === recordsView));
    segments.append(button);
  }
  view.append(segments);
  if (recordsView === 'day') {
    const quick = element('div', '', 'quick');
    quick.style.marginTop = '10px';
    quick.append(action('＋ 過去の日を記録', pastDay, 'pill'));
    view.append(quick);
    const dates = [...new Set([
      ...state.sessions.filter(session => session.sets.length).map(session => session.date),
      ...state.skips.map(skip => skip.date), ...state.body.map(entry => entry.date)
    ])].sort((a, b) => b.localeCompare(a));
    for (const date of dates) {
      const sessions = state.sessions.filter(session => session.date === date);
      const sets = sessions.flatMap(session => session.sets);
      const ids = [...new Set(sets.map(set => set.exerciseId))];
      const skips = state.skips.filter(skip => skip.date === date);
      const body = state.body.find(entry => entry.date === date);
      const row = action('', () => recordDay(date), 'day');
      row.dataset.date = date;
      const text = element('div');
      const heading = element('p', dayLabel(date), 'd');
      heading.append(element('small', ids.length ? ids.length + '種目' +
        (skips.length ? '・休み' : sessions.some(session => session.light) ? '・軽め' : '') : skips.length ? '休み' : ''));
      const detail = element('p');
      for (const id of ids) {
        const ex = state.exercises.find(ex => ex.id === id);
        if (detail.childNodes.length) detail.append(element('br'));
        detail.append(document.createTextNode(ex.name + ' '));
        const numbers = element('b');
        appendSetHistory(numbers, ex, sets.filter(set => set.exerciseId === id));
        detail.append(numbers);
      }
      for (const skip of skips) {
        if (detail.childNodes.length) detail.append(element('br'));
        detail.append(document.createTextNode((ids.length ? '休み ' : '') + skip.reason));
      }
      if (!ids.length && !skips.length && body) detail.textContent = '体重 ' + body.kg.toFixed(1) + 'kg';
      text.append(heading, detail);
      row.append(text, element('span', '›', 'chev'));
      view.append(row);
    }
    return;
  }
  if (!state.sessions.some(session => session.sets.length) && !state.body.length) {
    const empty = element('div', '', 'empty');
    empty.append(element('b', 'まだ記録がありません'),
      element('p', '1回トレーニングすると、ここに種目ごとの伸びが階段で出ます。'));
    if (unread) {
      const quick = element('div', '', 'quick');
      quick.append(action('新着 ' + unread, openNews, 'pill'));
      empty.append(quick);
    }
    view.append(empty);
    return;
  }

  const recorded = new Set(state.sessions.flatMap(session => session.sets.map(set => set.exerciseId)));
  for (const ex of state.exercises.filter(ex => recorded.has(ex.id))) {
    const row = action('', () => go('detail', { id: ex.id, from: 'records' }), 'rec');
    row.dataset.exerciseId = ex.id;
    const name = element('b', ex.name);
    const load = history(state, ex.id, today).load;
    const band = ex.type === 'band' ? state.bands.find(band => band.order === load) : null;
    const latest = [...state.sessions].filter(session =>
      session.sets.some(set => set.exerciseId === ex.id))
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    const detail = element('small', (band ? band.name + ' ・ ' : '') +
      '突破 ' + clearCount(state, ex.id) + '回 ・ 前回 ');
    appendSetHistory(detail, ex, latest.sets.filter(set => set.exerciseId === ex.id));
    name.append(detail);
    row.append(name, miniChart(ex.id),
      element('span', String(line(state, ex.id, today).value ?? '—'), 'num'),
      element('span', '›', 'chev'));
    view.append(row);
  }
  if (state.body.length) {
    const latest = [...state.body].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
    const average = bodyAvg7(state.body, today, 'kg');
    const row = action('', () => go('detail', { id: 'body', from: 'records' }), 'rec');
    row.dataset.exerciseId = 'body';
    const name = element('b', '体重');
    name.append(element('small', '7日平均 ' + (average === null ? '—' : average.toFixed(1)) + 'kg'));
    row.append(name, miniChart('body'), element('span', latest.kg.toFixed(1), 'num'),
      element('span', '›', 'chev'));
    view.append(row);
  }

  const section = element('div', '', 'sec');
  section.append(element('p', '12週間', 'k'));
  const heat = element('div', '', 'heat');
  heat.style.marginTop = '6px';
  weekHeat(state, today).forEach(days => {
    const cell = element('i', '', days >= 3 ? 'd' : days ? 'l' : '');
    cell.setAttribute('aria-label', days + '日');
    heat.append(cell);
  });
  section.append(heat);
  const quick = element('div', '', 'quick');
  quick.style.marginTop = '14px';
  quick.append(action('新着 ' + unread, openNews, 'pill'));
  view.append(section, quick);
}

function renderDetail() {
  const today = localDate(new Date());
  const body = screen.id === 'body';
  const ex = state.exercises.find(ex => ex.id === screen.id);
  view.append(action(screen.from === 'today' ? '‹ ホーム' : '‹ 記録', back, 'back'),
    element('h1', body ? '体重' : ex.name, 'exname'));
  const entries = body
    ? [...state.body].sort((a, b) => a.date.localeCompare(b.date))
    : setHistory(state, ex.id);
  if (entries.length) {
    view.append(growthChart(entries, ex, today));
  } else {
    view.append(element('p', '記録が増えると、ここに階段ができる', 'stairs k'));
  }

  const stats = element('div', '', 'stat');
  function stat(title, amount, suffix = '') {
    const item = element('div');
    item.append(element('p', title, 'k'), element('span', String(amount), 'num'));
    if (suffix) item.append(element('span', suffix, 'k'));
    stats.append(item);
  }
  if (body) {
    const latest = entries.at(-1);
    const average = bodyAvg7(state.body, today, 'kg');
    const date = new Date(today + 'T12:00:00');
    date.setDate(date.getDate() - 28);
    const previous = bodyAvg7(state.body, localDate(date), 'kg');
    const diff = average === null || previous === null ? null : average - previous;
    stat('最新', latest ? latest.kg.toFixed(1) : '—');
    stat('7日平均', average === null ? '—' : average.toFixed(1));
    stat('4週間前との差', diff === null ? '—' : (diff > 0 ? '+' : '') + diff.toFixed(1));
  } else {
    const latest = entries.at(-1);
    const sets = state.sessions.flatMap(session => session.sets)
      .filter(set => set.exerciseId === ex.id && load(state, ex, set) === latest?.load);
    stat('自己ベスト', sets.length ? Math.max(...sets.map(set => value(ex, set))) : '—',
      ex.type === 'time' ? ' 秒' : ' 回');
    stat('前回', latest?.value ?? '—');
    stat('ライン', line(state, ex.id, today).value ?? '—');
  }
  view.append(stats);
  if (body) {
    const list = element('div', '', 'hist');
    for (const entry of [...entries].reverse()) {
      const row = action('', () => editBody(entry), 'bl');
      row.dataset.date = entry.date;
      const number = element('span', entry.kg.toFixed(1), 'num');
      number.append(element('small', ' kg', 'k'));
      row.append(element('span', dayLabel(entry.date), 'd'), number, element('span', '›', 'chev'));
      list.append(row);
    }
    view.append(list);
  } else {
    const hist = element('div', '', 'hist');
    const dates = [...new Set(state.sessions.filter(session =>
      session.sets.some(set => set.exerciseId === ex.id)).map(session => session.date))]
      .sort((a, b) => b.localeCompare(a));
    for (const date of dates) {
      const sets = state.sessions.filter(session => session.date === date)
        .flatMap(session => session.sets.filter(set => set.exerciseId === ex.id));
      const row = action('', () => exerciseDay(ex, date), 'r');
      row.dataset.date = date;
      const numbers = element('span', '', 'v');
      appendSetHistory(numbers, ex, sets,
        firstSetResult(state, ex.id, date, sets[0]).kind === 'clear');
      numbers.append(element('small', sets.length + 'セット'));
      row.append(element('span', dayLabel(date), 'd'), numbers);
      hist.append(row);
    }
    view.append(hist);
  }
}

function dayLabel(date) {
  const day = new Date(date + 'T12:00:00');
  return (day.getMonth() + 1) + '月' + day.getDate() + '日 ' + '日月火水木金土'[day.getDay()];
}

function exerciseDay(ex, date) {
  const title = dayLabel(date) + ' ' + ex.name;
  const { sheet, content } = homeSheet(title);
  let undoTimeout;
  sheet.addEventListener('close', () => {
    clearTimeout(undoTimeout);
    stopCounter();
  }, { once: true });

  function draw(notice) {
    clearTimeout(undoTimeout);
    stopCounter();
    sheet.setAttribute('aria-label', title);
    sheet.querySelector('h2').textContent = title;
    content.replaceChildren();
    if (notice) {
      const row = element('div', '', 'restore');
      row.append(element('span', notice.message),
        action('元に戻す', notice.undo, 'pill'));
      content.append(row);
      undoTimeout = setTimeout(() => row.remove(), 4000);
    }
    const sets = state.sessions.filter(session => session.date === date)
      .flatMap(session => session.sets.filter(set => set.exerciseId === ex.id)
        .map(set => ({ session, set })));
    sets.forEach(({ session, set }, index) => {
      const row = action('', () => {
        clearTimeout(undoTimeout);
        editSet(session, set, index, { sheet, content, back: draw });
      }, 'row');
      const number = setValue(ex, set);
      if (ex.type === 'time') number.append(element('small', '秒'));
      number.append(document.createTextNode(' ›'));
      row.append(element('span', (index + 1) + 'セット目'), number);
      content.append(row);
    });
  }

  draw();
}

function growthChart(entries, ex, today) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', ex ? '0 0 316 175' : '0 0 316 190');
  svg.setAttribute('class', ex ? 'stairs chart' : 'stairs');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', ex ? ex.name + ' 日ごとの記録' : '体重と7日平均');
  function add(tag, attrs, text) {
    const node = document.createElementNS(svg.namespaceURI, tag);
    for (const [key, val] of Object.entries(attrs)) node.setAttribute(key, String(val));
    if (text !== undefined) node.textContent = text;
    svg.append(node);
    return node;
  }
  const body = !ex;
  const points = entries.map(entry => ({
    ...entry, value: body ? entry.kg : entry.value
  }));
  const averages = body ? points.map(point => ({
    date: point.date, value: bodyAvg7(state.body, point.date, 'kg')
  })) : [];
  const values = body ? [...points, ...averages].map(point => point.value) :
    points.flatMap(point => [point.value, ...point.others]);
  const min = body ? Math.floor(Math.min(...values) - 1) : Math.min(...values);
  const max = body ? Math.ceil(Math.max(...values) + 1) : Math.max(...values);
  const dateNumber = date => new Date(date + 'T12:00:00').getTime();
  const first = dateNumber(points[0].date);
  const last = dateNumber(points.at(-1).date);
  const x = point => first === last ? (body ? 158 : 172) :
    (body ? 0 : 32) + (dateNumber(point.date) - first) / (last - first) * (body ? 316 : 280);
  const y = point => min === max ? (body ? 95 : 87) :
    (body ? 160 : 136) - (point.value - min) / (max - min) * (body ? 130 : 98);
  for (const height of body ? [30, 95, 160] : [38, 136]) {
    add('line', { x1: body ? 0 : 22, y1: height, x2: 316, y2: height, stroke: 'var(--hair)' });
  }
  if (body) {
    for (const point of points) {
      add('circle', { cx: x(point), cy: y(point), r: 4, fill: 'var(--mute-ai)' });
    }
    if (averages.length > 1) {
      add('polyline', { points: averages.map(point => x(point) + ',' + y(point)).join(' '),
        fill: 'none', stroke: 'var(--ai)', 'stroke-width': 3 });
    }
  } else {
    add('text', { x: 0, y: 42 }, max);
    add('text', { x: 0, y: 140 }, min);
    for (const point of points) {
      for (const amount of point.others) {
        add('circle', { class: 'other', cx: x(point), cy: y({ value: amount }),
          r: 3, fill: '#B5BECC' });
      }
    }
    const currentLoad = points.at(-1).load;
    let start = 0;
    while (start < points.length) {
      let end = start;
      while (end + 1 < points.length && points[end + 1].load === points[start].load) end++;
      const current = points[start].load === currentLoad;
      const color = current ? 'var(--shu)' : 'var(--ai)';
      if (end > start) {
        let path = 'M' + x(points[start]) + ' ' + y(points[start]);
        for (let i = start + 1; i <= end; i++) {
          path += ' L' + x(points[i]) + ' ' + y(points[i]);
        }
        add('path', { d: path, class: current ? 'now' : 'old', fill: 'none',
          stroke: color, 'stroke-width': 2.5 });
      }
      for (let i = start; i <= end; i++) {
        add('circle', { class: 'first', cx: x(points[i]), cy: y(points[i]), r: 4, fill: color });
      }
      if (start > 0) {
        const name = ex.type === 'band'
          ? state.bands.find(band => band.order === points[start].load)?.name ?? 'なし'
          : ex.type === 'weight' ? points[start].load + 'kg' : ex.name;
        const label = add('text', { x: x(points[start]), y: Math.min(155, y(points[start]) + 18),
          'text-anchor': x(points[start]) > 250 ? 'end' : 'start' }, name + 'へ');
        label.style.fontFamily = 'var(--ja)';
        label.style.fontWeight = '700';
        label.style.fill = 'var(--shu)';
      }
      start = end + 1;
    }
  }
  for (const [point, position, anchor] of [
    [points[0], body ? 0 : 22, 'start'], [points.at(-1), 316, 'end']
  ]) {
    add('text', { x: position, y: body ? 182 : 172, 'font-size': 12, fill: 'var(--mute)',
      'font-family': 'Barlow Condensed', 'text-anchor': anchor },
    Number(point.date.slice(5, 7)) + '月');
  }
  return svg;
}

function shortDate(date) {
  return date.split('-').slice(1).map(Number).join('/');
}

function pastDay() {
  const { sheet, content } = homeSheet('＋ 過去の日を記録');
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const label = element('label', '', 'stack');
  const input = element('input');
  input.type = 'date';
  input.max = localDate(yesterday);
  input.value = input.max;
  label.append(element('span', '日付'), input);
  const decide = action('決定', () => {
    if (!input.value || input.value > input.max) return;
    recordDay(input.value, { sheet, content });
  }, 'go sm');
  input.addEventListener('input', () => {
    decide.disabled = !input.value || input.value > input.max;
  });
  content.append(label, decide);
}

function recordDay(date, context) {
  const title = dayLabel(date);
  const { sheet, content } = context ?? homeSheet(title);
  let undoTimeout;
  sheet.addEventListener('close', () => {
    clearTimeout(undoTimeout);
    stopCounter();
  }, { once: true });

  function edit(session, set, index) {
    clearTimeout(undoTimeout);
    editSet(session, set, index, { sheet, content, back: draw });
  }

  function add(ex) {
    let session = state.sessions.find(session => session.date === date);
    const previous = session?.sets.filter(set => set.exerciseId === ex.id).at(-1);
    const set = { ...(previous ?? prefill(state, ex.id, date)[0]) };
    const created = !session;
    if (!session) {
      session = { id: uid('s'), date, light: false, note: '', sets: [] };
      state.sessions.push(session);
    }
    session.sets.push(set);
    if (!save()) {
      session.sets.pop();
      if (created) state.sessions.splice(state.sessions.indexOf(session), 1);
      return;
    }
    render();
    edit(session, set, session.sets.filter(item => item.exerciseId === ex.id).length - 1);
  }

  function draw(notice) {
    clearTimeout(undoTimeout);
    stopCounter();
    sheet.setAttribute('aria-label', title);
    sheet.querySelector('h2').textContent = title;
    content.replaceChildren();
    if (notice) {
      const row = element('div', '', 'restore');
      row.append(element('span', notice.message), action('元に戻す', notice.undo, 'pill'));
      content.append(row);
      undoTimeout = setTimeout(() => row.remove(), 4000);
    }
    const sessions = state.sessions.filter(session => session.date === date);
    const ids = [...new Set(sessions.flatMap(session => session.sets.map(set => set.exerciseId)))];
    if (!ids.length) content.append(element('p', '記録なし', 'dim'));
    for (const id of ids) {
      const ex = state.exercises.find(ex => ex.id === id);
      const group = element('div', '', 'stack');
      group.append(element('h3', ex.name));
      const sets = sessions.flatMap(session => session.sets
        .filter(set => set.exerciseId === id).map(set => ({ session, set })));
      sets.forEach(({ session, set }, index) => {
        const row = action('', () => edit(session, set, index), 'row');
        const number = setValue(ex, set);
        if (ex.type === 'time') number.append(element('small', '秒'));
        number.append(document.createTextNode(' ›'));
        row.append(element('span', (index + 1) + 'セット目'), number);
        group.append(row);
      });
      group.append(action('＋ セット', () => add(ex), 'pill'));
      content.append(group);
    }
    content.append(action('＋ 種目を足す', () => {
      clearTimeout(undoTimeout);
      content.replaceChildren();
      sheet.setAttribute('aria-label', '種目を足す');
      sheet.querySelector('h2').textContent = '種目を足す';
      for (const ex of state.exercises.filter(ex => !ex.archived)) {
        const row = action('', () => add(ex), 'row');
        row.append(element('span', ex.name), element('small', '›'));
        content.append(row);
      }
    }, 'pill'));
    for (const skip of state.skips.filter(skip => skip.date === date)) {
      content.append(element('p', '休み（' + skip.reason + '）', 'dim'));
    }
    const body = state.body.find(entry => entry.date === date);
    if (body) content.append(element('p', '体重 ' + body.kg.toFixed(1) + 'kg', 'dim'));
    const label = element('label', '', 'stack');
    const note = element('textarea');
    note.value = sessions[0]?.note ?? '';
    note.disabled = !sessions.length;
    note.addEventListener('input', () => {
      clearTimeout(undoTimeout);
      content.querySelector('.restore')?.remove();
      const previous = sessions[0].note;
      sessions[0].note = note.value;
      if (!save()) {
        sessions[0].note = previous;
        return;
      }
      render();
    });
    label.append(element('span', 'メモ'), note);
    content.append(label, action('この日の記録を削除', async () => {
      clearTimeout(undoTimeout);
      if (!await confirmDialog('この日の記録を削除します。よろしいですか？')) return;
      const previous = state.sessions;
      state.sessions = state.sessions.filter(session => session.date !== date);
      if (!save()) {
        state.sessions = previous;
        return;
      }
      render();
      draw();
    }, 'danger'));
  }

  draw();
}

function editBody(entry) {
  const { sheet, content } = homeSheet(dayLabel(entry.date) + ' 体重');
  let kg = entry.kg;
  const big = element('div', '', 'big');
  big.append(directNumber(kg, 0, 500, true, '体重 kg', next => { kg = next; }),
    element('small', 'kg'));
  content.append(big, action('保存', () => {
    const previous = entry.kg;
    entry.kg = kg;
    if (!save()) {
      entry.kg = previous;
      return;
    }
    render();
    sheet.close();
  }, 'go sm'), action('この日の体重を消す', () => {
    const position = state.body.indexOf(entry);
    state.body.splice(position, 1);
    if (!save()) {
      state.body.splice(position, 0, entry);
      return;
    }
    render();
    sheet.close();
    toast('この日の体重を消しました', () => {
      state.body.splice(position, 0, entry);
      if (!save()) {
        state.body.splice(position, 1);
        return;
      }
      render();
    });
  }, 'danger'));
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
      toast('休むのも練習');
      render();
    }));
  }
}

function recordBody() {
  const entries = [...state.body].sort((a, b) => b.date.localeCompare(a.date));
  const latest = entries[0];
  const lastWaist = entries.find(entry => entry.waist !== null);
  let kg = latest ? Math.round(latest.kg * 10) / 10 : '';
  let waist = lastWaist ? Math.round(lastWaist.waist * 10) / 10 : '';
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
  }, 'go');

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
      ? stepper('体重', Number(kg), 0, 500, 0.1, (next, direct) => {
        kg = Math.round(next * 10) / 10;
        if (direct) updateSave();
        else draw();
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

const parts = ['胸', '背中', '脚', '肩', '腕', '体幹', '全身'];
const exerciseTypes = [
  ['reps', '自重'],
  ['band', 'バンド'],
  ['time', '時間'],
  ['weight', '重り']
];

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

function renderExercises() {
  view.append(element('h1', '種目', 'h1'));
  for (const part of parts) {
    const items = state.exercises.filter(ex => ex.part === part && !ex.archived);
    if (!items.length) continue;
    view.append(element('h2', part, 'group'));
    for (const ex of items) {
      const button = action('', () => editExercise(ex), 'ex');
      button.dataset.exerciseId = ex.id;
      const name = element('span', ex.name);
      name.append(element('small', exerciseTypes.find(([type]) => type === ex.type)[1]));
      button.append(name, element('span', '›', 'chev'));
      view.append(button);
    }
  }
  view.append(element('h2', 'テンプレート', 'group'));
  for (const template of state.templates) {
    const button = action('', () => editTemplate(template), 'ex');
    const name = element('span', template.name);
    name.append(element('small', template.exerciseIds.length + '種目'));
    button.append(name, element('span', '›', 'chev'));
    view.append(button);
  }
  view.append(action('＋ テンプレート', () => editTemplate(), 'pill'));
  const deleted = state.exercises.filter(ex => ex.archived);
  if (deleted.length) {
    view.append(element('h2', '削除した種目', 'group'));
    for (const ex of deleted) {
      const row = element('div', '', 'restore');
      row.dataset.exerciseId = ex.id;
      row.append(element('span', ex.name), action('元に戻す', () => {
        ex.archived = false;
        save();
        render();
      }, 'pill'));
      view.append(row);
    }
  }
  dock.append(action('＋ 新しい種目', () => editExercise(), 'go sm'));
}

function settingsSection(title) {
  const section = element('section', '', 'settings-section stack');
  section.append(element('h2', title));
  view.append(section);
  return section;
}

function settingsEditor(title) {
  dock.className = 'press';
  dock.replaceChildren(action('キャンセル', back));
  view.replaceChildren(element('h1', title));
  const form = element('form', '', 'settings-section stack');
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

function directNumber(amount, min, max, decimal, label, onChange) {
  const button = action(String(amount), () => {
    const input = element('input');
    input.inputMode = decimal ? 'decimal' : 'numeric';
    input.setAttribute('aria-label', label);
    input.value = button.firstChild.textContent;
    const previous = input.value;
    let finished = false;
    function finish(cancel = false) {
      if (finished) return;
      finished = true;
      const parsed = Number(input.value);
      const valid = input.value.trim() !== '' && Number.isFinite(parsed);
      const number = cancel || !valid ? Number(previous) :
        Math.round(Math.max(min, Math.min(max, parsed)) * (decimal ? 10 : 1)) / (decimal ? 10 : 1);
      button.firstChild.textContent = String(number);
      input.replaceWith(button);
      if (!cancel && valid) onChange(number, true);
    }
    input.addEventListener('blur', () => finish());
    input.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(event.key === 'Escape');
        button.focus();
      }
    });
    button.replaceWith(input);
    input.focus();
    input.select();
  }, 'num val');
  button.setAttribute('aria-label', label);
  return button;
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
  const output = unit === 'kg'
    ? directNumber(value, min, Math.min(max, 500), true, title, (next, direct) => {
      value = next;
      minus.disabled = value <= min;
      plus.disabled = value >= max;
      onChange(next, direct);
    })
    : element('output', String(value), 'num val');
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

  const bands = settingsSection('バンド');
  bands.append(action('＋ バンド', () => editBand()));
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
      backup.append(link);
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
  const saveButton = element('button', '保存', 'go');
  saveButton.type = 'submit';
  form.append(saveButton);
  const link = element('a', 'トークンの作り方');
  link.href = 'https://github.com/settings/personal-access-tokens/new';
  link.className = 'settings-item';
  link.style.minHeight = '48px';
  link.style.color = 'var(--shu-ai)';
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
    element('p', '対象はデータ用リポジトリ1つ、権限は Contents の Read and Write だけ', 'dim'),
    buttons,
    status
  );
}

function editExercise(existing, navigate = true) {
  if (navigate) {
    go('exercise-editor', { id: existing?.id });
    return;
  }
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
      if (!existing && screen.addToMenu) {
        const exerciseIds = [...menuExercises(state, menu, localDate(new Date())), draft.id];
        if (!saveMenu({ kind: 'custom', exerciseIds })) return;
      }
      if (existing) Object.assign(existing, draft);
      else state.exercises.push(draft);
      save();
      back();
    }, 'go');
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
    if (existing) {
      const controls = element('div', '', 'actions');
      const index = state.exercises.indexOf(existing);
      for (const [offset, text] of [[-1, '↑'], [1, '↓']]) {
        const button = action(text, () => {
          moveItem(state.exercises, index, offset);
          save();
          draw();
        });
        button.disabled = index + offset < 0 || index + offset >= state.exercises.length;
        button.setAttribute('aria-label', `${existing.name}を${offset < 0 ? '上' : '下'}へ`);
        controls.append(button);
      }
      form.append(controls);
    }
    dock.prepend(saveButton);
    if (existing) {
      dock.insertBefore(action('削除', async () => {
        if (!await confirmDialog('この種目を削除します。よろしいですか？')) return;
        // 過去の記録から種目を参照できるよう、削除もアーカイブとして保存する。
        existing.archived = true;
        save();
        back();
      }, 'danger'), dock.lastElementChild);
    }
  }

  draw();
}

function editBand(existing, navigate = true) {
  if (navigate) {
    go('band-editor', { id: existing?.id });
    return;
  }
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
    back();
  }, 'go');
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
      back();
    }, 'danger'), dock.lastElementChild);
  }
}

function editTemplate(existing, navigate = true) {
  if (navigate) {
    go('template-editor', { id: existing?.id });
    return;
  }
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
      back();
    }, 'go');
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

function toast(text, undo) {
  clearTimeout(toastTimeout);
  toastElement.replaceChildren(document.createTextNode(text));
  if (undo) {
    toastElement.append(action('元に戻す', () => {
      clearTimeout(toastTimeout);
      toastElement.hidden = true;
      undo();
    }, 'pill'));
  }
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
    trackSheet(dialog);
    dialog.addEventListener('close', () => {
      const confirmed = dialog.returnValue === 'confirm';
      // 確認シートの履歴を戻してから、保存後の画面遷移を行う。
      if (window.history.state?.sheet) {
        window.addEventListener('popstate', () => resolve(confirmed), { once: true });
      } else {
        resolve(confirmed);
      }
    }, { once: true });
    dialog.showModal();
  });
}

loadTraining();
render();
if (github.dirty) pushData();
fetchFeedback();

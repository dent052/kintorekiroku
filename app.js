import {
  localDate, parseImport, value, recent, totalDays, feed, mergeFeed,
  firstSet, line, lineResult, menuExercises, toBase64Utf8, consultText, parsePosts
} from './logic.js';

/** @typedef {import('./logic.js').Data} Data */

const app = document.querySelector('.app');
const view = document.querySelector('.see');
const dock = document.querySelector('.press');
const toastElement = document.querySelector('#toast');
const dialog = document.querySelector('#confirm-dialog');
let currentMode = 'today';
let settingsReturn = 'today';
let menu;
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
menu = loadMenu();

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
    if (currentMode === 'today') renderToday();
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

function go(mode) {
  if (mode === 'settings' && currentMode !== 'settings') settingsReturn = currentMode;
  currentMode = mode;
  render();
}

let swipeStart = null;
app.addEventListener('touchstart', event => {
  const touch = event.touches[0];
  swipeStart = event.touches.length === 1 &&
    !event.target.closest('input, textarea, select, .ruler, .chips')
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
  if (currentMode === 'today' && dx < 0) go('growth');
  else if (currentMode === 'growth' && dx > 0) go('today');
  else return;
  view.classList.remove('slide-next', 'slide-prev');
  void view.offsetWidth;
  view.classList.add(dx < 0 ? 'slide-next' : 'slide-prev');
}, { passive: true });

function render() {
  app.dataset.mode = currentMode;
  view.className = currentMode === 'settings' ? 'see slab' : 'see';
  view.replaceChildren();
  view.scrollTop = 0;
  dock.className = 'press';
  dock.replaceChildren();
  if (currentMode === 'today') renderToday();
  else if (currentMode === 'growth') renderGrowth();
  else if (currentMode === 'settings') renderSettings();
  else renderTrain();
}

function pager() {
  const nav = element('nav', '', 'pager');
  nav.setAttribute('aria-label', 'ページ');
  for (const [mode, text] of [['today', '今日'], ['growth', '成長']]) {
    const button = action(text, () => go(mode));
    button.dataset.page = mode;
    if (mode === currentMode) button.setAttribute('aria-current', 'page');
    nav.append(button);
  }
  dock.append(nav);
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
    const labels = {
      reply: '返信', weekly: '週次', finding: '発見', reading: '読み物',
      clear: '突破', pr: '自己ベスト', load: '負荷アップ', stage: '段階アップ', near: '節目'
    };
    post.append(element('p', coach ? 'コーチ' : '記録', 'k'));
    const body = element('p', '', full ? '' : 'preview');
    body.append(element('b', labels[item.kind]), document.createTextNode(item.text));
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

  if (!state.exercises.length) {
    view.append(element('p', 'まず種目を登録しましょう', 'lines'));
    dock.append(action('種目を追加', () => {
      go('settings');
      editExercise();
    }, 'go'));
  } else {
    const lines = element('div', '', 'lines');
    lines.append(element('p', '今日のライン ・ ' + menuName(), 'k'));
    for (const id of menuExercises(state, menu, today)) {
      const ex = state.exercises.find(item => item.id === id);
      const target = line(state, id, today);
      const [previous] = recent(state, id, today, 1);
      const first = previous && firstSet(state, ex, previous);
      const result = first && lineResult(line(state, id, previous.date), value(ex, first));
      let detail = first ? '前回 ' + value(ex, first) + (ex.type === 'time' ? '秒' : '') : '初回';
      if (result?.kind === 'clear') detail += ' ・ 突破';
      if (result?.kind === 'short') detail += ' ・ あと' + result.diff;
      if (ex.type === 'band') {
        const band = state.bands.find(item => item.id === first?.bandId) ??
          [...state.bands].sort((a, b) => a.order - b.order)[0];
        if (band) detail = band.name + ' ・ ' + detail;
      }
      const row = element('div', '', 'ln');
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
      row.append(name, number);
      lines.append(row);
    }
    view.append(lines);
    dock.append(action('始める', () => startWorkout(false), 'go'));
    const sub = element('div', '', 'sub');
    sub.append(action('メニュー変更', changeMenu), action('軽めの日', () => startWorkout(true)),
      action('休む', recordRest), action('体重', recordBody));
    dock.append(sub);
  }

  const { items, seen } = homeFeed();
  if (items.length) {
    const news = element('div', '', 'feed');
    news.append(element('p', '新着 ' + items.filter(item => !seen.includes(item.id)).length, 'k'));
    const displayed = items.slice(0, 2);
    appendFeed(news, displayed);
    view.append(news);
    markSeen(displayed);
  }
  pager();
  fetchFeedback();
}

function homeSheet(title) {
  const sheet = element('dialog', '', 'sheet');
  sheet.setAttribute('aria-label', title);
  sheet.append(element('h2', title));
  const content = element('div', '', 'stack');
  const actions = element('div', '', 'dialog-actions sub');
  actions.append(action('閉じる', () => sheet.close()));
  sheet.append(content, actions);
  sheet.addEventListener('close', () => sheet.remove(), { once: true });
  document.body.append(sheet);
  sheet.showModal();
  return { sheet, content };
}

function changeMenu(onSelect) {
  const { sheet, content } = homeSheet('メニュー変更');
  function choose(next) {
    try {
      localStorage.setItem('kintore:menu', JSON.stringify(next));
    } catch {
      toast('保存できませんでした。容量を確認してください');
      return;
    }
    menu = next;
    sheet.close();
    render();
    if (typeof onSelect === 'function') onSelect();
  }
  for (const template of state.templates) {
    content.append(action(template.name, () => choose({ kind: 'template', templateId: template.id })));
  }
  content.append(action('前回と同じ', () => choose({ kind: 'same' })));
  content.append(action('種目を選ぶ', () => {
    content.replaceChildren();
    const selected = menu.kind === 'custom'
      ? [...menu.exerciseIds] : menuExercises(state, menu, localDate(new Date()));
    const chips = element('div', '', 'chips wrap');
    for (const ex of state.exercises.filter(item => !item.archived)) {
      const button = action(ex.name, () => {
        const index = selected.indexOf(ex.id);
        if (index < 0) selected.push(ex.id);
        else selected.splice(index, 1);
        button.classList.toggle('on', selected.includes(ex.id));
        button.setAttribute('aria-pressed', String(selected.includes(ex.id)));
        done.disabled = !selected.length;
      }, 'chip' + (selected.includes(ex.id) ? ' on' : ''));
      button.setAttribute('aria-pressed', String(selected.includes(ex.id)));
      chips.append(button);
    }
    const done = action('決定', () => choose({ kind: 'custom', exerciseIds: selected }), 'go');
    done.disabled = !selected.length;
    content.append(chips, done);
  }));
}

let training = null;
function startWorkout(light) {
  const ids = menuExercises(state, menu, localDate(new Date()));
  if (!ids.length) {
    changeMenu(() => startWorkout(light));
    return;
  }
  training = { exerciseIds: ids, light };
  go('train');
}

function renderTrain() {
  view.append(element('h1', training?.light ? '軽めの日' : 'トレーニング', 'exname'));
  const sub = element('div', '', 'sub');
  sub.append(action('戻る', () => go('today')));
  dock.append(sub);
}

function renderGrowth() {
  view.append(element('h1', '成長', 'exname'));
  const chips = element('div', '', 'chips');
  const recorded = new Set(state.sessions.flatMap(session => session.sets.map(set => set.exerciseId)));
  for (const ex of state.exercises.filter(item => recorded.has(item.id))) {
    chips.append(element('span', ex.name));
  }
  if (state.body.length) chips.append(element('span', '体重'));
  if (chips.childElementCount) dock.append(chips);
  const sub = element('div', '', 'sub');
  sub.append(action('記録を見る・直す', () => {}), action('新着', () => {
    const { items } = homeFeed();
    const { content } = homeSheet('新着');
    appendFeed(content, [...items].sort((a, b) => b.at.localeCompare(a.at)), true);
    markSeen(items);
  }), action('設定', () => go('settings')));
  dock.append(sub);
  pager();
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
  dock.className = 'press';
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

  dock.className = 'press';
  const adds = element('div', '', 'row3');
  adds.append(action('＋ 種目', () => editExercise()), action('＋ バンド', () => editBand()),
    action('＋ テンプレ', () => editTemplate()));
  const links = element('div', '', 'sub');
  links.append(action('戻る', () => go(settingsReturn)));
  dock.append(links, adds);
  const exercises = settingsSection('種目');
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

render();
if (github.dirty) pushData();
fetchFeedback();

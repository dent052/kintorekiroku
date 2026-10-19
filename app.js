import {
  localDate, parseImport, value, recent, advice, prefill, rows,
  prKind, sessionEvents, weekStats
} from './logic.js';

/** @typedef {import('./logic.js').Data} Data */

const view = document.querySelector('#view');
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
    settings: { weeklyGoal: 3, restSec: 90 }
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

function scheduleSync() {
  // shortcut: 単一端末前提で常に上書き。複数端末で使うなら updatedAt 比較を追加
}

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

function renderHome() {
  view.innerHTML = '<h1>ホーム</h1>';
}

let workout = null;
let summaryId = null;
let wakeLock = null;
let endAt = null;
let timerInterval;
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
    cards: exerciseIds
      .filter(id => state.exercises.some(ex => ex.id === id))
      .map(id => workoutCard(id, light ? 1 : template?.sets)),
    sessionId: null,
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
  view.replaceChildren(element('h1', '種目を追加'));
  const section = settingsSection('種目');
  for (const ex of state.exercises) {
    if (ex.archived) continue;
    section.append(action(ex.name, () => {
      workout.cards.push(workoutCard(ex.id));
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

function completeRow(row) {
  if (row.done) return;
  const today = localDate(new Date());
  let session = state.sessions.find(item => item.date === today);
  if (!session) {
    session = {
      id: uid('s'), date: today, light: workout.light,
      note: workout.note, sets: []
    };
    state.sessions.push(session);
  } else {
    session.light = session.light && workout.light;
    session.note = workout.note;
  }
  workout.sessionId = session.id;
  row.kind = prKind(state, row.set, session.id);
  session.sets.push({ ...row.set });
  row.done = true;
  save();
  if (row.kind) navigator.vibrate?.(80);
  startTimer(state.settings.restSec);
  render();
}

function renderTrain() {
  if (!workout) {
    if (summaryId) renderSummary();
    else renderStartChoices();
    return;
  }
  view.replaceChildren(element('h1', 'トレーニング'));
  for (const card of workout.cards) {
    const ex = state.exercises.find(item => item.id === card.exerciseId);
    const section = element('section', '', 'ex stack');
    const head = element('div', '', 'head');
    head.append(element('span', ex.name, 'name'));
    const previous = recent(state, ex.id, localDate(new Date()), 1)[0];
    if (previous) {
      head.append(element('span', `前回 ${previousText(ex, previous)}`, 'dim'));
    }
    section.append(head);
    const tip = advice(state, ex.id, localDate(new Date()));
    if (tip) section.append(element('span', tip.text, 'advice'));
    card.rows.forEach((row, index) => {
      const group = element('div', '', 'stack');
      const update = (key, next) => {
        if (row.done) return;
        row.set[key] = next;
        render();
      };
      if (ex.type === 'band') {
        const chips = element('div', '', 'chips');
        const bands = [...state.bands].sort((a, b) => a.order - b.order);
        if (!bands.some(band => band.id === row.set.bandId)) {
          chips.append(element('span', 'なし', 'chip on'));
        }
        for (const band of bands) {
          const selected = row.set.bandId === band.id;
          const button = action(band.name, () => update('bandId', band.id),
            `chip${selected ? ' on' : ''}`);
          button.disabled = row.done;
          button.setAttribute('aria-pressed', String(selected));
          chips.append(button);
        }
        group.append(chips);
      }
      if (ex.type === 'weight') {
        const weight = stepper('重り', row.set.kg ?? 0, 0, Infinity, 0.5,
          next => update('kg', next), 'kg');
        for (const button of weight.querySelectorAll('button')) {
          button.disabled = row.done || button.disabled;
        }
        group.append(weight);
      }
      const time = ex.type === 'time';
      const control = stepper(`${ex.name} ${index + 1}セット`,
        value(ex, row.set), 0, Infinity, time ? 5 : 1,
        next => update(time ? 'sec' : 'reps', next), time ? '秒' : '回');
      const counter = control.querySelector('.stepper');
      for (const button of counter.querySelectorAll('button')) {
        button.disabled = row.done || button.disabled;
      }
      counter.className = 'set';
      counter.prepend(element('span', String(index + 1), 'k num'));
      const complete = action(row.done ? '済' : '完了',
        () => completeRow(row), `ok${row.done ? ' d' : ''}`);
      complete.disabled = row.done;
      counter.append(complete);
      group.append(counter);
      if (row.kind) {
        group.append(element('p',
          row.kind === 'pr' ? '自己ベスト！' : '負荷アップ！', 'pr'));
      }
      section.append(group);
    });
    section.append(action('セットを追加', () => {
      const last = card.rows[card.rows.length - 1];
      card.rows.push({ set: { ...last.set }, done: false, kind: null });
      render();
    }));
    if (ex.nextId && state.exercises.some(item => item.id === ex.nextId)) {
      section.append(action('次の段階へ切り替え', () => {
        const index = workout.cards.indexOf(card);
        workout.cards[index] = workoutCard(ex.nextId);
        render();
      }));
    }
    view.append(section);
  }
  const bottom = element('div', '', 'workout-actions stack');
  const label = element('label', '', 'stack');
  const note = element('textarea');
  note.value = workout.note;
  note.addEventListener('change', () => {
    workout.note = note.value;
    const session = state.sessions.find(item =>
      item.id === workout.sessionId || item.date === localDate(new Date()));
    if (session) {
      session.note = workout.note;
      save();
    }
  });
  label.append(element('span', 'メモ'), note);
  bottom.append(
    action('種目を追加', pickWorkoutExercise),
    label,
    action('終了', finishWorkout, 'primary')
  );
  view.append(bottom);
}

function finishWorkout() {
  const session = state.sessions.find(item => item.id === workout.sessionId);
  if (session) {
    session.note = workout.note;
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
  const heading = `${month}月${day}日（${'日月火水木金土'[date.getDay()]}）のトレーニング`;
  const section = element('div', '', 'summary stack');
  section.append(element('p', heading, 'dim'));
  const total = totalReps(session);
  const amount = element('p');
  amount.append(element('span', String(total), 'num big'), element('span', ' 回', 'dim'));
  section.append(amount);
  const previous = state.sessions
    .filter(item => item.date < session.date)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  let totalText = '合計回数';
  // Only show growth: a negative diff on a short day reads as blame (spec anti-goal).
  const diff = previous ? total - totalReps(previous) : 0;
  if (diff > 0) totalText += `　前回より +${diff}`;
  section.append(element('p', totalText, 'dim'));
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
  const stats = weekStats(state, localDate(new Date()));
  section.append(element('p',
    `今週 ${stats.days}/${stats.goal}日${stats.achieved ? ' 達成。' : ''}`, 'dim'));
  const home = action('ホームへ', () => {
    summaryId = null;
    go('home');
  }, 'primary');
  view.replaceChildren(section, home);
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
  const adjust = offset => {
    endAt = Math.max(Date.now(), endAt + offset * 1000);
    tick();
  };
  timerElement.replaceChildren(
    action('−15', () => adjust(-15), 'pm'),
    display,
    action('+15', () => adjust(15), 'pm'),
    action('スキップ', stopTimer, 'skip')
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

function renderHistory() {
  view.innerHTML = '<h1>履歴</h1>';
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
    stepper('週の目標日数', state.settings.weeklyGoal, 1, 7, 1, value => {
      state.settings.weeklyGoal = value;
      save();
      render();
    }, '日'),
    stepper('休憩秒数', state.settings.restSec, 30, 300, 15, value => {
      state.settings.restSec = value;
      save();
      render();
    }, '秒')
  );

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
}

function editExercise(existing) {
  const draft = existing ? { ...existing } : {
    id: uid('e'),
    name: '',
    type: 'reps',
    part: '胸',
    min: 8,
    max: 15,
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
      const wasTime = draft.type === 'time';
      if (type === 'time' && !wasTime && draft.min === 8 && draft.max === 15) {
        draft.min = 20;
        draft.max = 60;
      } else if (type !== 'time' && wasTime && draft.min === 20 && draft.max === 60) {
        draft.min = 8;
        draft.max = 15;
      }
      draft.type = type;
      const limit = type === 'time' ? 600 : 100;
      draft.max = Math.min(draft.max, limit);
      draft.min = Math.min(draft.min, draft.max);
      draw();
    });
    choices(form, '部位', parts.map(part => [part, part]), draft.part, part => {
      draft.part = part;
      draw();
    });
    const time = draft.type === 'time';
    const step = time ? 5 : 1;
    const unit = time ? '秒' : '回';
    form.append(
      stepper('目標 min', draft.min, 1, draft.max, step, value => {
        draft.min = value;
        draw();
      }, unit),
      stepper('目標 max', draft.max, draft.min, time ? 600 : 100, step, value => {
        draft.max = value;
        draw();
      }, unit)
    );
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
    form.append(label, saveButton);
    if (existing && !existing.archived) {
      form.append(action('アーカイブ', () => {
        existing.archived = true;
        save();
        render();
      }, 'danger'));
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
  form.append(saveButton);
  const used = existing && state.sessions.some(session =>
    session.sets.some(set => set.bandId === existing.id));
  if (existing && !used) {
    form.append(action('削除', () => {
      state.bands = state.bands.filter(band => band.id !== existing.id);
      state.bands.sort((a, b) => a.order - b.order);
      state.bands.forEach((band, i) => { band.order = i + 1; });
      save();
      render();
    }, 'danger'));
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
      }),
      saveButton
    );
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

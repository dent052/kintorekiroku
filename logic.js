/**
 * @typedef {Object} Exercise
 * @property {string} id
 * @property {string} name
 * @property {'reps'|'band'|'time'|'weight'} type
 * @property {'胸'|'背中'|'脚'|'肩'|'腕'|'体幹'|'全身'} part
 * @property {string|null} nextId
 * @property {boolean} archived
 *
 * @typedef {{id: string, name: string, order: number, note: string}} Band
 * @typedef {{id: string, name: string, exerciseIds: string[], sets: number}} Template
 * @typedef {{exerciseId: string, reps: number|null, sec: number|null, kg: number|null, bandId: string|null}} Set
 * @typedef {{id: string, date: string, light: boolean, note: string, sets: Set[]}} Session
 * @typedef {{date: string, reason: '風邪'|'疲れ'|'予定'|'その他'}} Skip
 * @typedef {{date: string, kg: number, waist: number|null}} Body
 * @typedef {{restSec: number}} Settings
 * @typedef {{version: 1, updatedAt: string, exercises: Exercise[], bands: Band[], templates: Template[], sessions: Session[], skips: Skip[], body: Body[], settings: Settings}} Data
 */

/** @param {Date} d */
export function localDate(d) {
  const year = String(d.getFullYear()).padStart(4, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** @param {Exercise} ex @param {Set} set */
export function value(ex, set) {
  return ex.type === 'time' ? set.sec : set.reps;
}

/** @param {Data} data @param {Exercise} ex @param {Set} set */
export function load(data, ex, set) {
  if (ex.type === 'band') {
    return data.bands.find(band => band.id === set.bandId)?.order ?? 0;
  }
  return ex.type === 'weight' ? set.kg ?? 0 : 0;
}

/** @param {Data} data @returns {Session[]} */
export function recent(data, exerciseId, today, n) {
  return data.sessions
    .filter(session =>
      session.date < today &&
      session.light === false &&
      session.sets.some(set => set.exerciseId === exerciseId)
    )
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, n);
}

/** @param {Data} data @param {Exercise} ex @param {Session} session */
export function top(data, ex, session) {
  const sets = session.sets.filter(set => set.exerciseId === ex.id);
  const maxLoad = Math.max(...sets.map(set => load(data, ex, set)));
  return {
    load: maxLoad,
    value: Math.max(...sets
      .filter(set => load(data, ex, set) === maxLoad)
      .map(set => value(ex, set)))
  };
}

function nextBand(data, currentLoad) {
  return data.bands
    .filter(band => band.order > currentLoad)
    .sort((a, b) => a.order - b.order)[0];
}

/** @param {Data} data @param {Exercise} ex @param {Session} session */
export function firstSet(data, ex, session) {
  return session.sets.find(set => set.exerciseId === ex.id);
}

/** @param {Data} data */
export function history(data, exerciseId, today) {
  const ex = data.exercises.find(ex => ex.id === exerciseId);
  const sets = recent(data, exerciseId, today, Infinity)
    .map(session => firstSet(data, ex, session));
  const currentLoad = sets.length ? load(data, ex, sets[0]) : 0;
  return {
    load: currentLoad,
    values: sets.filter(set => load(data, ex, set) === currentLoad)
      .slice(0, 3).map(set => value(ex, set))
  };
}

/** @param {Data} data */
export function line(data, exerciseId, today) {
  const ex = data.exercises.find(ex => ex.id === exerciseId);
  const h = history(data, exerciseId, today);
  if (h.values.length === 0) return { kind: 'base' };

  const next = data.exercises.find(entry => entry.id === ex.nextId);
  const band = ex.type === 'band' ? nextBand(data, h.load) : undefined;
  if (h.values[0] >= (ex.type === 'time' ? 60 : 20)) {
    if (next) return { kind: 'up', next: next.name };
    if (band) return { kind: 'up', next: band.name };
    if (ex.type === 'weight') return { kind: 'up', next: `${h.load + 1}kg` };
  }

  const sorted = [...h.values].sort((a, b) => a - b);
  const target = sorted[Math.floor(sorted.length / 2)] + (ex.type === 'time' ? 5 : 1);
  const values = recent(data, exerciseId, today, Infinity)
    .map(session => firstSet(data, ex, session))
    .filter(set => load(data, ex, set) === h.load)
    .slice(0, 6).map(set => value(ex, set));
  if (values.length === 6 &&
      Math.max(...values.slice(0, 3)) <= Math.max(...values.slice(3))) {
    return { kind: 'flat', value: target };
  }
  if (h.values.length === 3 && h.values[0] < h.values[1] && h.values[1] < h.values[2]) {
    return { kind: 'down', value: target };
  }
  return { kind: 'line', value: target };
}

export function lineResult(l, firstValue) {
  if (l.kind === 'base') return { kind: 'base' };
  if (l.kind === 'up') return { kind: 'newload' };
  return firstValue >= l.value
    ? { kind: 'clear' }
    : { kind: 'short', diff: l.value - firstValue };
}

/** @param {Data} data @param {Set} set */
export function firstSetResult(data, exerciseId, date, set) {
  const ex = data.exercises.find(ex => ex.id === exerciseId);
  const target = line(data, exerciseId, date);
  const h = history(data, exerciseId, date);
  if (h.values.length && load(data, ex, set) !== h.load) return { kind: 'newload' };
  if (target.kind === 'up') {
    return { kind: 'previous', diff: value(ex, set) - h.values[0], next: target.next };
  }
  return lineResult(target, value(ex, set));
}

/** @param {Exercise} ex */
export function lineText(l, ex) {
  if (l.kind === 'base') return '初回。この1セットが基準になる';
  if (l.kind === 'up') return `${ex.type === 'time' ? '60秒' : '20回'}を超えた。次は${l.next}で。`;
  if (l.kind === 'flat') return '3回、横ばい。負荷を変えるか、1日休むタイミング';
  if (l.kind === 'down') return '下がり続けている。今日は軽めでいい';
  return `ライン ${l.value}${ex.type === 'time' ? '秒' : ''}`;
}

/** @param {Data} data @returns {Set[]} */
export function prefill(data, exerciseId, today) {
  const ex = data.exercises.find(ex => ex.id === exerciseId);
  const [session] = recent(data, exerciseId, today, 1);
  if (!session) {
    return [{
      exerciseId,
      reps: ex.type === 'time' ? null : 10,
      sec: ex.type === 'time' ? 30 : null,
      kg: ex.type === 'weight' ? 5 : null,
      bandId: ex.type === 'band'
        ? [...data.bands].sort((a, b) => a.order - b.order)[0]?.id ?? null
        : null
    }];
  }

  const sets = session.sets
    .filter(set => set.exerciseId === exerciseId)
    .map(set => ({ ...set }));
  return sets;
}

/** @param {Set[]} prefilled @returns {Set[]} */
export function rows(prefilled, count) {
  return Array.from({ length: count }, (_, i) => ({
    ...prefilled[Math.min(i, prefilled.length - 1)]
  }));
}

/** @param {Data} data @param {Set} set */
export function prKind(data, set, sessionId) {
  const ex = data.exercises.find(ex => ex.id === set.exerciseId);
  const previous = data.sessions
    .filter(session => session.id !== sessionId)
    .flatMap(session => session.sets)
    .filter(entry => entry.exerciseId === set.exerciseId);
  if (previous.length === 0) return null;

  const currentLoad = load(data, ex, set);
  if (previous.every(entry => load(data, ex, entry) < currentLoad)) return 'load';
  const sameLoad = previous.filter(entry => load(data, ex, entry) === currentLoad);
  if (sameLoad.length > 0 && sameLoad.every(entry => value(ex, entry) < value(ex, set))) {
    return 'pr';
  }
  return null;
}

/** @param {Data} data */
export function isStageUp(data, exerciseId, sessionId) {
  const session = data.sessions.find(session => session.id === sessionId);
  return data.exercises.some(ex => ex.nextId === exerciseId) &&
    !data.sessions.some(previous =>
      previous.date < session.date &&
      previous.sets.some(set => set.exerciseId === exerciseId)
    );
}

/** @param {Data} data */
export function sessionEvents(data, sessionId) {
  const session = data.sessions.find(session => session.id === sessionId);
  const exerciseIds = [...new Set(session.sets.map(set => set.exerciseId))];
  const events = [];
  for (const exerciseId of exerciseIds) {
    const ex = data.exercises.find(ex => ex.id === exerciseId);
    if (isStageUp(data, exerciseId, sessionId)) {
      events.push({ exerciseId, kind: 'stage', text: `${ex.name} に進んだ` });
      continue;
    }

    const sets = session.sets.filter(set => set.exerciseId === exerciseId);
    const kinds = sets.map(set => prKind(data, set, sessionId));
    if (kinds.includes('load')) {
      const previous = data.sessions
        .filter(previous => previous.id !== sessionId)
        .flatMap(previous => previous.sets)
        .filter(set => set.exerciseId === exerciseId);
      const oldLoad = Math.max(...previous.map(set => load(data, ex, set)));
      const newLoad = Math.max(...sets.map(set => load(data, ex, set)));
      const bandName = order => data.bands.find(band => band.order === order)?.name ?? 'なし';
      const change = ex.type === 'band'
        ? `${bandName(oldLoad)}→${bandName(newLoad)}`
        : `${oldLoad}→${newLoad}kg`;
      events.push({ exerciseId, kind: 'load', text: `${ex.name} ${change}` });
    } else if (kinds.includes('pr')) {
      const best = Math.max(...sets
        .filter((set, i) => kinds[i] === 'pr')
        .map(set => value(ex, set)));
      events.push({
        exerciseId,
        kind: 'pr',
        text: `${ex.name} 自己ベスト ${best}${ex.type === 'time' ? '秒' : '回'}`
      });
    }
  }
  return events;
}

/** @param {Data} data @returns {Object<string, number>} */
export function totals(data) {
  const result = {};
  for (const session of data.sessions) {
    for (const set of session.sets) {
      const ex = data.exercises.find(ex => ex.id === set.exerciseId);
      result[ex.id] = (result[ex.id] ?? 0) + value(ex, set);
    }
  }
  return result;
}

function dateOffset(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  return localDate(new Date(year, month - 1, day + days, 12));
}

/** @param {string} date */
export function weekStart(date) {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(year, month - 1, day, 12).getDay();
  return dateOffset(date, -((weekday + 6) % 7));
}

function inRange(entries, start, end) {
  return entries.filter(entry => entry.date >= start && entry.date <= end);
}

function marksInRange(data, start, end) {
  const marks = {};
  for (const skip of inRange(data.skips, start, end)) {
    marks[skip.date] = 'rest';
  }
  for (const session of inRange(data.sessions, start, end)) {
    if (marks[session.date] !== 'done') {
      marks[session.date] = session.light ? 'light' : 'done';
    }
  }
  return marks;
}

/** @param {Data} data @param {string} today */
export function weekStats(data, today) {
  const start = weekStart(today);
  const end = dateOffset(start, 6);
  const sessions = inRange(data.sessions, start, end);
  const days = new Set(sessions.map(session => session.date)).size;

  const partSets = {};
  for (const ex of data.exercises) {
    const count = sessions.reduce((sum, session) =>
      sum + session.sets.filter(set => set.exerciseId === ex.id).length, 0);
    if (count > 0) partSets[ex.part] = (partSets[ex.part] ?? 0) + count;
  }
  return {
    days, partSets,
    marks: marksInRange(data, start, end)
  };
}

/** @param {Data} data @param {string} today */
export function calendar(data, today, weeks = 12) {
  const start = weekStart(today);
  return marksInRange(data, dateOffset(start, -7 * (weeks - 1)), dateOffset(start, 6));
}

function average(entries, key) {
  const values = entries.filter(entry => entry[key] !== null);
  return values.length === 0
    ? null
    : values.reduce((sum, entry) => sum + entry[key], 0) / values.length;
}

/** @param {Body[]} body @param {string} date @param {'kg'|'waist'} key */
export function bodyAvg7(body, date, key) {
  return average(inRange(body, dateOffset(date, -6), date), key);
}

/** @param {Data} data */
export function totalDays(data) {
  return new Set(data.sessions.map(session => session.date)).size;
}

/** @param {Data} data @param {string} today */
export function feed(data, today) {
  const current = { ...data, sessions: data.sessions.filter(session => session.date <= today) };
  const [session] = [...current.sessions].sort((a, b) => b.date.localeCompare(a.date));
  if (!session) return [];

  const items = [];
  const events = sessionEvents(current, session.id);
  const sums = totals(current);
  for (const ex of data.exercises) {
    const first = firstSet(current, ex, session);
    if (first) {
      const l = line(current, ex.id, session.date);
      if (firstSetResult(current, ex.id, session.date, first).kind === 'clear') {
        items.push({
          id: `clear:${ex.id}:${session.date}`, at: session.date,
          kind: 'clear', text: `${ex.name} ライン${l.value}を突破`
        });
      }
    }
    const event = events.find(event => event.exerciseId === ex.id);
    if (event) {
      items.push({
        id: `${event.kind}:${ex.id}:${session.date}`,
        at: session.date, kind: event.kind, text: event.text
      });
    }

    const sum = sums[ex.id] ?? 0;
    const milestone = sum < 100 ? 100 : sum < 500 ? 500 : (Math.floor(sum / 1000) + 1) * 1000;
    if (milestone - sum <= milestone * 0.1) {
      const unit = ex.type === 'time' ? '秒' : '回';
      items.push({
        id: `near:${ex.id}:${milestone}`, at: session.date, kind: 'near',
        text: `累計${ex.name} ${milestone}${unit}まで あと${milestone - sum}${unit}`
      });
    }
  }

  const kinds = ['clear', 'pr', 'load', 'stage', 'near'];
  return kinds.flatMap(kind => {
    const item = items.find(item => item.kind === kind);
    return item ? [item] : [];
  }).sort((a, b) => b.at.localeCompare(a.at));
}

export function mergeFeed(own, posts, seen) {
  const unreadReply = item => item.kind === 'reply' && !seen.includes(item.id);
  return [...own.map(item => ({ ...item, at: item.at.slice(0, 10) })), ...posts]
    .sort((a, b) => Number(unreadReply(b)) - Number(unreadReply(a)) ||
      b.at.localeCompare(a.at));
}

/** @param {Data} data @param {string} today */
export function consultText(data, today) {
  const start = dateOffset(today, -27);
  const sorted = entries => inRange(entries, start, today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const shortDate = date => date.slice(5).split('-').map(Number).join('/');
  const sections = [
    '自宅で自重とバンド中心に筋トレしています。以下の記録を見て、①伸びている点 ②停滞・偏り ③来週の具体的なメニュー提案 を短く教えてください。'
  ];
  const sessions = sorted(data.sessions);
  if (sessions.length > 0) {
    const lines = ['【記録】'];
    for (const session of sessions) {
      lines.push(`${shortDate(session.date)}${session.light ? ' 軽め' : ''}`);
      const ids = [...new Set(session.sets.map(set => set.exerciseId))];
      for (const id of ids) {
        const ex = data.exercises.find(ex => ex.id === id);
        const sets = session.sets.filter(set => set.exerciseId === id);
        const groups = [];
        for (const set of sets) {
          const prefix = ex.type === 'band'
            ? data.bands.find(band => band.id === set.bandId)?.name ?? 'なし'
            : ex.type === 'weight' ? `${set.kg ?? 0}kg` : '';
          const previous = groups[groups.length - 1];
          if (previous && previous.prefix === prefix) {
            previous.values.push(value(ex, set));
          } else {
            groups.push({ prefix, values: [value(ex, set)] });
          }
        }
        const values = groups.map(group =>
          `${group.prefix ? `${group.prefix} ` : ''}${group.values.join('・')}`).join(' / ');
        lines.push(`  ${ex.name}: ${values}${ex.type === 'time' ? '秒' : '回'}`);
      }
      if (session.note) lines.push(`  メモ: ${session.note}`);
    }
    sections.push(lines.join('\n'));
  }

  const skips = sorted(data.skips);
  if (skips.length > 0) {
    sections.push(['【休み】', ...skips.map(skip =>
      `${shortDate(skip.date)} ${skip.reason}`)].join('\n'));
  }

  const body = sorted(data.body);
  if (body.length > 0) {
    sections.push(['【体】', ...body.map(entry =>
      `${shortDate(entry.date)} ${entry.kg.toFixed(1)}kg${entry.waist === null ? '' : ` ウエスト${entry.waist.toFixed(1)}cm`}`
    )].join('\n'));
  }

  sections.push('【負荷アップの目安】\n1セット目が20回（時間は60秒）を超えたら負荷を上げる');
  return sections.join('\n\n');
}

/** @param {string} text @returns {Data} */
export function parseImport(text) {
  try {
    const result = JSON.parse(text);
    if (
      result === null ||
      result.version !== 1 ||
      !['exercises', 'bands', 'templates', 'sessions', 'skips', 'body']
        .every(key => Array.isArray(result[key])) ||
      result.settings === null ||
      typeof result.settings !== 'object' ||
      Array.isArray(result.settings)
    ) {
      throw new Error();
    }
    return result;
  } catch {
    throw new Error('読み込めないファイルです');
  }
}

/** @param {string} s */
export function toBase64Utf8(s) {
  const bytes = new TextEncoder().encode(s);
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
  }
  return btoa(chunks.join(''));
}

/** @param {string} text */
export function parsePosts(text) {
  let posts;
  try {
    posts = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(posts)) return [];
  const kinds = ['reply', 'weekly', 'finding', 'reading'];
  return posts
    .filter(post => typeof post?.id === 'string' && typeof post.text === 'string' &&
      typeof post.at === 'string' && kinds.includes(post.kind))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 200);
}

/** @param {Data} data */
export function lineHistory(data, exerciseId) {
  const ex = data.exercises.find(ex => ex.id === exerciseId);
  const sessions = data.sessions.filter(session =>
    session.light === false && session.sets.some(set => set.exerciseId === exerciseId));
  const dates = [...new Set(sessions.map(session => session.date))].sort();
  return dates.flatMap(date => {
    const l = line(data, exerciseId, date);
    if (l.value === undefined) return [];
    const session = sessions.find(session => session.date === date);
    return [{ date, value: l.value, load: load(data, ex, firstSet(data, ex, session)) }];
  });
}

/** @param {Data} data */
export function setHistory(data, exerciseId) {
  const ex = data.exercises.find(ex => ex.id === exerciseId);
  const days = new Map();
  for (const session of data.sessions) {
    const sets = session.sets.filter(set => set.exerciseId === exerciseId);
    if (!sets.length) continue;
    if (!days.has(session.date)) days.set(session.date, []);
    days.get(session.date).push(...sets);
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, sets]) => ({
    date,
    value: value(ex, sets[0]),
    load: load(data, ex, sets[0]),
    others: sets.slice(1).map(set => value(ex, set))
  }));
}

/** @param {Data} data */
export function clearCount(data, exerciseId) {
  const ex = data.exercises.find(ex => ex.id === exerciseId);
  return data.sessions.filter(session => {
    if (session.light !== false) return false;
    const first = firstSet(data, ex, session);
    return first && firstSetResult(data, exerciseId, session.date, first).kind === 'clear';
  }).length;
}

/** @param {Data} data @param {string} today */
export function weekHeat(data, today) {
  const start = weekStart(today);
  return Array.from({ length: 12 }, (_, i) => {
    const monday = dateOffset(start, (i - 11) * 7);
    return new Set(inRange(data.sessions, monday, dateOffset(monday, 6))
      .map(session => session.date)).size;
  });
}

/** @param {Data} data @param {string} today */
export function menuExercises(data, menu, today) {
  let ids;
  if (menu?.kind === 'custom') {
    ids = menu.exerciseIds;
  } else if (menu?.kind === 'template') {
    ids = data.templates.find(template => template.id === menu.templateId)?.exerciseIds;
  }
  if (ids === undefined) {
    const [session] = data.sessions
      .filter(session => session.light === false && session.date < today)
      .sort((a, b) => b.date.localeCompare(a.date));
    ids = [...new Set(session?.sets.map(set => set.exerciseId) ?? [])];
  }
  return ids.filter(id => data.exercises.some(ex => ex.id === id));
}

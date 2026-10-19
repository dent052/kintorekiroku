/**
 * @typedef {Object} Exercise
 * @property {string} id
 * @property {string} name
 * @property {'reps'|'band'|'time'|'weight'} type
 * @property {'胸'|'背中'|'脚'|'肩'|'腕'|'体幹'|'全身'} part
 * @property {number} min
 * @property {number} max
 * @property {string|null} nextId
 * @property {boolean} archived
 *
 * @typedef {{id: string, name: string, order: number, note: string}} Band
 * @typedef {{id: string, name: string, exerciseIds: string[], sets: number}} Template
 * @typedef {{exerciseId: string, reps: number|null, sec: number|null, kg: number|null, bandId: string|null}} Set
 * @typedef {{id: string, date: string, light: boolean, note: string, sets: Set[]}} Session
 * @typedef {{date: string, reason: '風邪'|'疲れ'|'予定'|'その他'}} Skip
 * @typedef {{date: string, kg: number, waist: number|null}} Body
 * @typedef {{weeklyGoal: number, restSec: number}} Settings
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

/** @param {Data} data */
export function advice(data, exerciseId, today) {
  const sessions = recent(data, exerciseId, today, 3);
  if (sessions.length === 0) return null;

  const ex = data.exercises.find(ex => ex.id === exerciseId);
  if (sessions.length === 3) {
    const [s1, s2, s3] = sessions.map(session => top(data, ex, session));
    if (
      s1.load === s2.load &&
      s2.load === s3.load &&
      s3.value > s2.value &&
      s2.value > s1.value
    ) {
      return {
        kind: 'rest',
        text: '2回続けて下がっています。今日は軽めか休養を'
      };
    }
  }

  const sets = sessions[0].sets.filter(set => set.exerciseId === exerciseId);
  if (sets.every(set => value(ex, set) >= ex.max)) {
    if (ex.nextId !== null) {
      const next = data.exercises.find(exercise => exercise.id === ex.nextId);
      return { kind: 'next', text: `次の段階「${next.name}」へ` };
    }
    if (ex.type === 'band') {
      const band = nextBand(data, top(data, ex, sessions[0]).load);
      if (band) return { kind: 'band', text: `バンドを「${band.name}」に` };
    }
    if (ex.type === 'weight') return { kind: 'weight', text: '+1kg に' };
    return { kind: 'set', text: 'セットを1つ増やす' };
  }

  if (sets.some(set => value(ex, set) < ex.min)) {
    return {
      kind: 'keep',
      text: `今の負荷のまま、${ex.min}${ex.type === 'time' ? '秒' : '回'}を目指す`
    };
  }
  return {
    kind: 'plus',
    text: ex.type === 'time' ? '各セット+5秒を目標' : '各セット+1回を目標'
  };
}

/** @param {Data} data @returns {Set[]} */
export function prefill(data, exerciseId, today) {
  const ex = data.exercises.find(ex => ex.id === exerciseId);
  const [session] = recent(data, exerciseId, today, 1);
  if (!session) {
    return [{
      exerciseId,
      reps: ex.type === 'time' ? null : ex.min,
      sec: ex.type === 'time' ? ex.min : null,
      kg: ex.type === 'weight' ? 5 : null,
      bandId: ex.type === 'band'
        ? [...data.bands].sort((a, b) => a.order - b.order)[0]?.id ?? null
        : null
    }];
  }

  const sets = session.sets
    .filter(set => set.exerciseId === exerciseId)
    .map(set => ({ ...set }));
  const { kind } = advice(data, exerciseId, today);
  if (kind === 'band') {
    const band = nextBand(data, top(data, ex, session).load);
    return sets.map(set => ({ ...set, bandId: band.id }));
  }
  if (kind === 'weight') {
    const kg = top(data, ex, session).load + 1;
    return sets.map(set => ({ ...set, kg }));
  }
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
  const goal = data.settings.weeklyGoal;
  const days = new Set(sessions.map(session => session.date)).size;
  const achieved = days >= goal;
  let streak = achieved ? 1 : 0;

  for (let week = dateOffset(start, -7); ; week = dateOffset(week, -7)) {
    const last = dateOffset(week, 6);
    const count = new Set(inRange(data.sessions, week, last)
      .map(session => session.date)).size;
    const restWeek = inRange(data.skips, week, last)
      .some(skip => skip.reason === '風邪');
    if (count < goal && !restWeek) break;
    streak++;
  }

  const partSets = {};
  for (const ex of data.exercises) {
    const count = sessions.reduce((sum, session) =>
      sum + session.sets.filter(set => set.exerciseId === ex.id).length, 0);
    if (count > 0) partSets[ex.part] = (partSets[ex.part] ?? 0) + count;
  }
  return {
    days, goal, achieved, streak, partSets,
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

/** @param {Data} data @param {string} today */
export function compare(data, today) {
  const a = inRange(data.sessions, dateOffset(today, -6), today);
  const b = inRange(data.sessions, dateOffset(today, -34), dateOffset(today, -28));
  if (b.length === 0) return null;

  const items = [];
  for (const ex of data.exercises) {
    const aSets = a.flatMap(session => session.sets)
      .filter(set => set.exerciseId === ex.id);
    const bSets = b.flatMap(session => session.sets)
      .filter(set => set.exerciseId === ex.id);
    if (aSets.length === 0 || bSets.length === 0) continue;
    const current = top(data, ex, { sets: aSets });
    const previous = top(data, ex, { sets: bSets });
    if (current.load > previous.load) {
      const bandName = order => data.bands.find(band => band.order === order)?.name ?? 'なし';
      const change = ex.type === 'band'
        ? `${bandName(previous.load)}→${bandName(current.load)}`
        : `${previous.load}→${current.load}kg`;
      items.push({
        exerciseId: ex.id, kind: 'load', text: `${ex.name} ${change}`,
        increase: current.load - previous.load
      });
    } else if (
      current.load === previous.load &&
      previous.value !== 0 &&
      current.value > previous.value
    ) {
      items.push({
        exerciseId: ex.id,
        kind: 'value',
        text: `${ex.name} 最高 ${previous.value}→${current.value}${ex.type === 'time' ? '秒' : '回'}`,
        increase: (current.value - previous.value) / previous.value
      });
    }
  }
  items.sort((a, b) =>
    (a.kind === b.kind ? b.increase - a.increase : a.kind === 'load' ? -1 : 1));

  const sumReps = sessions => sessions.reduce((sum, session) =>
    sum + session.sets.reduce((total, set) => {
      const ex = data.exercises.find(ex => ex.id === set.exerciseId);
      return total + (ex.type === 'time' ? 0 : set.reps);
    }, 0), 0);
  const oldTotal = sumReps(b);
  const difference = key => {
    const current = bodyAvg7(data.body, today, key);
    const previous = bodyAvg7(data.body, dateOffset(today, -28), key);
    return current === null || previous === null
      ? null
      : Math.round((current - previous) * 10) / 10;
  };
  return {
    items: items.slice(0, 3).map(({ exerciseId, text, kind }) => ({ exerciseId, text, kind })),
    totalPct: oldTotal === 0 ? null : Math.round((sumReps(a) - oldTotal) / oldTotal * 100),
    bodyKg: difference('kg'),
    waist: difference('waist')
  };
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

  const ids = new Set(sessions.flatMap(session => session.sets.map(set => set.exerciseId)));
  const exercises = data.exercises.filter(ex => !ex.archived && ids.has(ex.id));
  if (exercises.length > 0) {
    sections.push(['【目標範囲】', ...exercises.map(ex =>
      `${ex.name} ${ex.min}〜${ex.max}${ex.type === 'time' ? '秒' : '回'}`
    )].join('\n'));
  }
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

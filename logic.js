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

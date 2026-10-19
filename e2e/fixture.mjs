// Shared fixture: 6 weeks of history ending yesterday
export function fixture(today = new Date()) {
  const d = n => { const x = new Date(today); x.setDate(x.getDate() - n); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; };
  const s = (o) => ({ exerciseId: 'e1', reps: null, sec: null, kg: null, bandId: null, ...o });
  const sessions = [];
  for (let w = 6; w >= 1; w--) for (const off of [0, 2, 4]) {
    const n = w * 7 - off; if (n < 1) continue;
    const base = 18 - w;
    sessions.push({ id: 's' + n, date: d(n), light: false, note: n === 1 ? '少し疲れた' : '', sets: [
      s({ reps: base }), s({ reps: base - 1 }), s({ reps: base - 2 }),
      s({ exerciseId: 'e2', reps: 15, bandId: w > 2 ? 'r' : 'k' }), s({ exerciseId: 'e2', reps: 15, bandId: w > 2 ? 'r' : 'k' }),
      s({ exerciseId: 'e3', sec: 30 + (6 - w) * 5 }) ] });
  }
  return { version: 1, updatedAt: '', settings: { weeklyGoal: 3, restSec: 90 },
    exercises: [
      { id: 'e1', name: '腕立て伏せ', type: 'reps', part: '胸', min: 8, max: 15, nextId: 'e4', archived: false },
      { id: 'e2', name: 'バンドロウ', type: 'band', part: '背中', min: 8, max: 15, nextId: null, archived: false },
      { id: 'e3', name: 'プランク', type: 'time', part: '体幹', min: 20, max: 60, nextId: null, archived: false },
      { id: 'e4', name: '足上げ腕立て', type: 'reps', part: '胸', min: 8, max: 15, nextId: null, archived: false }],
    bands: [{ id: 'y', name: '黄', order: 1, note: '' }, { id: 'r', name: '赤', order: 2, note: '' }, { id: 'k', name: '黒', order: 3, note: '' }],
    templates: [{ id: 't1', name: '胸と背中', exerciseIds: ['e1', 'e2', 'e3'], sets: 3 }],
    sessions, skips: [{ date: d(10), reason: '風邪' }],
    body: Array.from({ length: 40 }, (_, i) => ({ date: d(40 - i), kg: 69 - i * 0.03 + (i % 3) * 0.2, waist: i % 7 === 0 ? 82 - i * 0.03 : null })) };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  localDate, value, load, recent, top, advice, prefill, rows,
  prKind, isStageUp, sessionEvents, totals,
  weekStart, weekStats, calendar, compare, bodyAvg7, consultText,
  parseImport, toBase64Utf8
} from './logic.js';

const ex = (o) => ({ id: 'e1', name: '腕立て', type: 'reps', part: '胸', min: 8, max: 15, nextId: null, archived: false, ...o });
const set = (o) => ({ exerciseId: 'e1', reps: null, sec: null, kg: null, bandId: null, ...o });
const ses = (date, sets, o) => ({ id: 's' + date, date, light: false, note: '', sets, ...o });
const data = (o) => ({ version: 1, updatedAt: '', exercises: [ex()], bands: [], templates: [], sessions: [], skips: [], body: [], settings: { weeklyGoal: 3, restSec: 90 }, ...o });
const bands = [{ id: 'y', name: '黄', order: 1, note: '' }, { id: 'r', name: '赤', order: 2, note: '' }, { id: 'k', name: '黒', order: 3, note: '' }];

const today = '2026-10-20';

test('localDate uses local calendar fields and pads month and day', () => {
  assert.equal(localDate(new Date(2026, 9, 20, 1, 30)), '2026-10-20');
  assert.equal(localDate(new Date(2026, 0, 2, 23, 30)), '2026-01-02');
});

test('value selects seconds only for time exercises', () => {
  const entry = set({ reps: 12, sec: 30 });
  for (const type of ['reps', 'band', 'weight']) {
    assert.equal(value(ex({ type }), entry), 12);
  }
  assert.equal(value(ex({ type: 'time' }), entry), 30);
});

test('load selects band order or kg and otherwise returns zero', () => {
  const d = data({ bands });
  const entry = set({ bandId: 'r', kg: 6.5 });
  assert.equal(load(d, ex({ type: 'band' }), entry), 2);
  assert.equal(load(d, ex({ type: 'band' }), set()), 0);
  assert.equal(load(d, ex({ type: 'weight' }), entry), 6.5);
  assert.equal(load(d, ex({ type: 'weight' }), set()), 0);
  assert.equal(load(d, ex(), entry), 0);
  assert.equal(load(d, ex({ type: 'time' }), entry), 0);
});

test('recent filters exercise, today, future and light sessions before sorting', () => {
  const old = ses('2026-10-15', [set({ reps: 10 })]);
  const latest = ses('2026-10-19', [set({ reps: 12 })]);
  const middle = ses('2026-10-17', [set({ reps: 11 })]);
  const d = data({
    sessions: [
      old,
      ses(today, [set({ reps: 15 })]),
      latest,
      ses('2026-10-18', [set({ reps: 15 })], { light: true }),
      middle,
      ses('2026-10-16', [set({ exerciseId: 'e2', reps: 10 })]),
      ses('2026-10-21', [set({ reps: 15 })])
    ]
  });
  const before = structuredClone(d);
  assert.deepEqual(recent(d, 'e1', today, 2), [latest, middle]);
  assert.deepEqual(recent(d, 'e1', today, 10), [latest, middle, old]);
  assert.deepEqual(recent(d, 'missing', today, 1), []);
  assert.deepEqual(recent(d, 'e1', today, 0), []);
  assert.deepEqual(d, before);
});

test('top chooses maximum value among the strongest load only', () => {
  const d = data({ bands });
  const session = ses('2026-10-19', [
    set({ bandId: 'y', reps: 30 }),
    set({ bandId: 'r', reps: 10 }),
    set({ bandId: 'r', reps: 12 }),
    set({ exerciseId: 'e2', bandId: 'k', reps: 40 })
  ]);
  assert.deepEqual(top(d, ex({ type: 'band' }), session), { load: 2, value: 12 });
  assert.deepEqual(top(d, ex(), session), { load: 0, value: 30 });
  assert.deepEqual(top(d, ex({ type: 'weight' }), ses('2026-10-19', [
    set({ kg: 5, reps: 20 }),
    set({ kg: 6, reps: 9 }),
    set({ kg: 6, reps: 11 })
  ])), { load: 6, value: 11 });
  assert.deepEqual(top(d, ex({ type: 'time' }), ses('2026-10-19', [
    set({ sec: 25 }), set({ sec: 35 })
  ])), { load: 0, value: 35 });
});

test('advice returns plus and keep with exact repetition texts', () => {
  for (const [reps, expected] of [
    [[12, 10, 9], { kind: 'plus', text: '各セット+1回を目標' }],
    [[9, 7], { kind: 'keep', text: '今の負荷のまま、8回を目指す' }],
    [[15, 8], { kind: 'plus', text: '各セット+1回を目標' }]
  ]) {
    const d = data({
      sessions: [ses('2026-10-19', reps.map(reps => set({ reps })))]
    });
    assert.deepEqual(advice(d, 'e1', today), expected);
  }
});

test('time advice uses seconds and a five-second increment', () => {
  for (const [seconds, expected] of [
    [[25, 19], { kind: 'keep', text: '今の負荷のまま、20秒を目指す' }],
    [[30, 20], { kind: 'plus', text: '各セット+5秒を目標' }],
    [[60, 65], { kind: 'set', text: 'セットを1つ増やす' }]
  ]) {
    const d = data({
      exercises: [ex({ type: 'time', min: 20, max: 60 })],
      sessions: [ses('2026-10-19', seconds.map(sec => set({ sec })))]
    });
    assert.deepEqual(advice(d, 'e1', today), expected);
  }
});

test('next advice takes priority over load increases and resolves archived targets', () => {
  for (const type of ['reps', 'band', 'weight']) {
    const d = data({
      exercises: [
        ex({ type, nextId: 'e2' }),
        ex({ id: 'e2', name: '足上げ腕立て', archived: true })
      ],
      bands,
      sessions: [ses('2026-10-19', [
        set({ reps: 15, bandId: type === 'band' ? 'r' : null, kg: type === 'weight' ? 6 : null })
      ])]
    });
    assert.deepEqual(advice(d, 'e1', today), {
      kind: 'next', text: '次の段階「足上げ腕立て」へ'
    });
    assert.deepEqual(prefill(d, 'e1', today), d.sessions[0].sets);
  }
});

test('level-up chooses the next band by order or adds a set at the strongest band', () => {
  for (const [bandId, expected] of [
    ['r', { kind: 'band', text: 'バンドを「黒」に' }],
    ['k', { kind: 'set', text: 'セットを1つ増やす' }]
  ]) {
    const d = data({
      exercises: [ex({ type: 'band' })],
      bands: [bands[2], bands[0], bands[1]],
      sessions: [ses('2026-10-19', [
        set({ reps: 15, bandId }), set({ reps: 16, bandId })
      ])]
    });
    assert.deepEqual(advice(d, 'e1', today), expected);
  }
  assert.deepEqual(advice(data({
    sessions: [ses('2026-10-19', [set({ reps: 15 })])]
  }), 'e1', today), { kind: 'set', text: 'セットを1つ増やす' });
});

test('weight level-up has the exact text and prefills one kg above the maximum', () => {
  const d = data({
    exercises: [ex({ type: 'weight' })],
    sessions: [ses('2026-10-19', [
      set({ reps: 15, kg: 5 }), set({ reps: 16, kg: 6 })
    ])]
  });
  const before = structuredClone(d);
  assert.deepEqual(advice(d, 'e1', today), { kind: 'weight', text: '+1kg に' });
  assert.deepEqual(prefill(d, 'e1', today), [
    set({ reps: 15, kg: 7 }), set({ reps: 16, kg: 7 })
  ]);
  assert.deepEqual(d, before);
});

test('mixed-band level-up checks every set and upgrades from the strongest band', () => {
  const d = data({
    exercises: [ex({ type: 'band' })],
    bands: [bands[2], bands[0], bands[1]],
    sessions: [ses('2026-10-19', [
      set({ reps: 16, bandId: 'y' }),
      set({ reps: 15, bandId: 'r' })
    ])]
  });
  const before = structuredClone(d);
  assert.deepEqual(advice(d, 'e1', today), {
    kind: 'band', text: 'バンドを「黒」に'
  });
  assert.deepEqual(prefill(d, 'e1', today), [
    set({ reps: 16, bandId: 'k' }), set({ reps: 15, bandId: 'k' })
  ]);
  assert.deepEqual(d, before);

  d.sessions[0].sets[0].reps = 14;
  assert.deepEqual(advice(d, 'e1', today), {
    kind: 'plus', text: '各セット+1回を目標'
  });
  assert.deepEqual(prefill(d, 'e1', today), d.sessions[0].sets);
});

test('mixed-weight sets below max prevent a load increase and retain their own kg', () => {
  const d = data({
    exercises: [ex({ type: 'weight' })],
    sessions: [ses('2026-10-19', [
      set({ reps: 14, kg: 5 }), set({ reps: 15, kg: 6 })
    ])]
  });
  assert.deepEqual(advice(d, 'e1', today), {
    kind: 'plus', text: '各セット+1回を目標'
  });
  assert.deepEqual(prefill(d, 'e1', today), d.sessions[0].sets);
});

test('rest requires three strictly declining tops at the same load', () => {
  const d = data({
    exercises: [ex({ type: 'band' })],
    bands,
    sessions: [
      ses('2026-10-17', [set({ reps: 14, bandId: 'r' })]),
      ses('2026-10-19', [set({ reps: 10, bandId: 'r' })]),
      ses('2026-10-18', [set({ reps: 12, bandId: 'r' })])
    ]
  });
  assert.deepEqual(advice(d, 'e1', today), {
    kind: 'rest', text: '2回続けて下がっています。今日は軽めか休養を'
  });
  assert.deepEqual(prefill(d, 'e1', today), d.sessions[1].sets);

  d.sessions[1].sets[0].bandId = 'k';
  assert.equal(advice(d, 'e1', today).kind, 'plus');
  d.sessions[1].sets[0].bandId = 'r';
  d.sessions[1].sets[0].reps = 12;
  assert.equal(advice(d, 'e1', today).kind, 'plus');
  d.sessions.pop();
  assert.equal(advice(d, 'e1', today).kind, 'plus');
});

test('rest takes priority over level-up', () => {
  const d = data({
    sessions: [
      ses('2026-10-17', [set({ reps: 18 })]),
      ses('2026-10-18', [set({ reps: 17 })]),
      ses('2026-10-19', [set({ reps: 16 })])
    ]
  });
  assert.deepEqual(advice(d, 'e1', today), {
    kind: 'rest', text: '2回続けて下がっています。今日は軽めか休養を'
  });
});

test('advice and prefill ignore today and light sessions', () => {
  const previous = set({ reps: 9 });
  const d = data({
    sessions: [
      ses('2026-10-17', [previous]),
      ses('2026-10-19', [set({ reps: 15 })], { light: true }),
      ses(today, [set({ reps: 15 })])
    ]
  });
  assert.deepEqual(advice(d, 'e1', today), {
    kind: 'plus', text: '各セット+1回を目標'
  });
  assert.deepEqual(prefill(d, 'e1', today), [previous]);
  assert.notStrictEqual(prefill(d, 'e1', today)[0], previous);
});

test('no eligible history gives null advice and type-specific initial values', () => {
  for (const [exercise, registeredBands, expected] of [
    [ex(), bands, set({ reps: 8 })],
    [ex({ type: 'band' }), [bands[2], bands[0], bands[1]], set({ reps: 8, bandId: 'y' })],
    [ex({ type: 'band' }), [], set({ reps: 8 })],
    [ex({ type: 'weight' }), bands, set({ reps: 8, kg: 5 })],
    [ex({ type: 'time', min: 20, max: 60 }), bands, set({ sec: 20 })]
  ]) {
    const d = data({ exercises: [exercise], bands: registeredBands });
    const before = structuredClone(d);
    assert.equal(advice(d, 'e1', today), null);
    assert.deepEqual(prefill(d, 'e1', today), [expected]);
    assert.deepEqual(d, before);
  }
  const d = data({
    sessions: [
      ses(today, [set({ reps: 15 })]),
      ses('2026-10-19', [set({ reps: 15 })], { light: true })
    ]
  });
  assert.equal(advice(d, 'e1', today), null);
  assert.deepEqual(prefill(d, 'e1', today), [set({ reps: 8 })]);
});

test('prefill filters other exercises and returns independent copies', () => {
  const a = set({ reps: 12 });
  const b = set({ reps: 10 });
  const d = data({
    sessions: [ses('2026-10-19', [
      a, set({ exerciseId: 'e2', reps: 20 }), b
    ])]
  });
  const result = prefill(d, 'e1', today);
  assert.deepEqual(result, [a, b]);
  assert.notStrictEqual(result[0], a);
  assert.notStrictEqual(result[1], b);
  result[0].reps = 1;
  assert.equal(a.reps, 12);
});

test('rows repeats the last prefilled set using independent copies', () => {
  const a = set({ reps: 12 });
  const b = set({ reps: 10 });
  const result = rows([a, b], 3);
  assert.deepEqual(result, [a, b, b]);
  assert.notStrictEqual(result[0], a);
  assert.notStrictEqual(result[1], b);
  assert.notStrictEqual(result[2], b);
  assert.notStrictEqual(result[1], result[2]);
  result[2].reps = 1;
  assert.equal(result[1].reps, 10);
  assert.equal(b.reps, 10);
  assert.deepEqual(rows([a, b], 1), [a]);
  assert.deepEqual(rows([a, b], 0), []);
});

test('prKind ignores the current session and returns null for a first exercise', () => {
  const entry = set({ reps: 18 });
  const d = data({ sessions: [ses(today, [entry])] });
  assert.equal(prKind(d, entry, 's' + today), null);
});

test('prKind requires a strictly higher value at the same load', () => {
  const d = data({
    exercises: [ex({ type: 'band' })],
    bands,
    sessions: [ses('2026-10-19', [
      set({ reps: 12, bandId: 'r' }),
      set({ reps: 30, bandId: 'y' })
    ])]
  });
  assert.equal(prKind(d, set({ reps: 13, bandId: 'r' }), 'current'), 'pr');
  assert.equal(prKind(d, set({ reps: 12, bandId: 'r' }), 'current'), null);
  assert.equal(prKind(d, set({ reps: 11, bandId: 'r' }), 'current'), null);
  assert.equal(prKind(d, set({ reps: 40 }), 'current'), null);
  assert.equal(prKind(d, set({ reps: 1, bandId: 'k' }), 'current'), 'load');
});

test('prKind includes light sessions and all dates but not other exercises', () => {
  const d = data({
    sessions: [
      ses('2026-10-21', [set({ reps: 18 })], { light: true }),
      ses(today, [set({ reps: 100 })]),
      ses('2026-10-19', [set({ exerciseId: 'e2', reps: 100 })])
    ]
  });
  assert.equal(prKind(d, set({ reps: 18 }), 's' + today), null);
  assert.equal(prKind(d, set({ reps: 19 }), 's' + today), 'pr');
});

test('prKind uses seconds for time and kg for weight', () => {
  const timed = data({
    exercises: [ex({ type: 'time' })],
    sessions: [ses('2026-10-19', [set({ sec: 30 })])]
  });
  assert.equal(prKind(timed, set({ sec: 35 }), 'current'), 'pr');
  assert.equal(prKind(timed, set({ sec: 30 }), 'current'), null);
  const weighted = data({
    exercises: [ex({ type: 'weight' })],
    sessions: [ses('2026-10-19', [set({ reps: 12, kg: 5 })])]
  });
  assert.equal(prKind(weighted, set({ reps: 1, kg: 6 }), 'current'), 'load');
  assert.equal(prKind(weighted, set({ reps: 13, kg: 5 }), 'current'), 'pr');
});

test('isStageUp requires a predecessor and no earlier record of the target', () => {
  const target = set({ exerciseId: 'e2', reps: 10 });
  const d = data({
    exercises: [
      ex({ nextId: 'e2', archived: true }),
      ex({ id: 'e2', name: '足上げ腕立て' })
    ],
    sessions: [
      ses('2026-10-21', [target]),
      ses(today, [target], { light: true })
    ]
  });
  assert.equal(isStageUp(d, 'e2', 's' + today), true);
  assert.equal(isStageUp(d, 'e2', 's2026-10-21'), false);
  assert.equal(isStageUp(d, 'e1', 's' + today), false);
});

test('sessionEvents selects the largest qualifying PR value once per exercise', () => {
  const d = data({
    sessions: [
      ses('2026-10-19', [set({ reps: 12 })]),
      ses(today, [set({ reps: 13 }), set({ reps: 18 }), set({ reps: 16 })])
    ]
  });
  const before = structuredClone(d);
  assert.deepEqual(sessionEvents(d, 's' + today), [
    { exerciseId: 'e1', kind: 'pr', text: '腕立て 自己ベスト 18回' }
  ]);
  assert.deepEqual(d, before);
});

test('sessionEvents gives stage priority over PR and load', () => {
  for (const type of ['reps', 'band']) {
    const d = data({
      exercises: [
        ex({ nextId: 'e2' }),
        ex({ id: 'e2', name: '足上げ腕立て', type })
      ],
      bands,
      sessions: [
        ses('2026-10-21', [set({ exerciseId: 'e2', reps: 12, bandId: 'r' })]),
        ses(today, [set({ exerciseId: 'e2', reps: 18, bandId: 'k' })])
      ]
    });
    assert.deepEqual(sessionEvents(d, 's' + today), [
      { exerciseId: 'e2', kind: 'stage', text: '足上げ腕立て に進んだ' }
    ]);
  }
});

test('sessionEvents load text uses both session maxima and outranks PR', () => {
  const d = data({
    exercises: [ex({ type: 'band', name: 'バンドロウ' })],
    bands,
    sessions: [
      ses('2026-10-21', [
        set({ reps: 30, bandId: 'y' }), set({ reps: 10, bandId: 'r' })
      ], { light: true }),
      ses(today, [
        set({ reps: 40, bandId: 'y' }),
        set({ reps: 15, bandId: 'r' }),
        set({ reps: 5, bandId: 'k' })
      ])
    ]
  });
  assert.deepEqual(sessionEvents(d, 's' + today), [
    { exerciseId: 'e1', kind: 'load', text: 'バンドロウ 赤→黒' }
  ]);
});

test('sessionEvents PR text excludes higher values that do not qualify', () => {
  const d = data({
    exercises: [ex({ type: 'band' })],
    bands,
    sessions: [
      ses('2026-10-19', [
        set({ reps: 30, bandId: 'y' }), set({ reps: 10, bandId: 'r' })
      ]),
      ses(today, [
        set({ reps: 25, bandId: 'y' }), set({ reps: 12, bandId: 'r' })
      ])
    ]
  });
  assert.deepEqual(sessionEvents(d, 's' + today), [
    { exerciseId: 'e1', kind: 'pr', text: '腕立て 自己ベスト 12回' }
  ]);
});

test('sessionEvents displays absent and unknown bands as なし', () => {
  for (const bandId of [null, 'missing']) {
    const d = data({
      exercises: [ex({ type: 'band', name: 'バンドロウ' })],
      bands,
      sessions: [
        ses('2026-10-19', [set({ reps: 12, bandId })]),
        ses(today, [set({ reps: 5, bandId: 'y' })])
      ]
    });
    assert.deepEqual(sessionEvents(d, 's' + today), [
      { exerciseId: 'e1', kind: 'load', text: 'バンドロウ なし→黄' }
    ]);
  }
});

test('sessionEvents formats weight maxima including null kg as zero', () => {
  for (const [oldKg, expected] of [
    [null, '腕立て 0→6.5kg'], [5, '腕立て 5→6.5kg']
  ]) {
    const d = data({
      exercises: [ex({ type: 'weight' })],
      sessions: [
        ses('2026-10-19', [set({ reps: 12, kg: oldKg })]),
        ses(today, [set({ reps: 5, kg: 6 }), set({ reps: 4, kg: 6.5 })])
      ]
    });
    assert.deepEqual(sessionEvents(d, 's' + today), [
      { exerciseId: 'e1', kind: 'load', text: expected }
    ]);
  }
});

test('sessionEvents emits seconds and omits exercises without an event', () => {
  const d = data({
    exercises: [ex({ type: 'time' }), ex({ id: 'e2' })],
    sessions: [
      ses('2026-10-19', [set({ sec: 30 })]),
      ses(today, [set({ sec: 35 }), set({ exerciseId: 'e2', reps: 10 })])
    ]
  });
  assert.deepEqual(sessionEvents(d, 's' + today), [
    { exerciseId: 'e1', kind: 'pr', text: '腕立て 自己ベスト 35秒' }
  ]);
  assert.deepEqual(sessionEvents(data({ sessions: [ses(today, [set({ reps: 10 })])] }), 's' + today), []);
});

test('totals includes archived exercises, light sessions, every load and seconds', () => {
  const d = data({
    exercises: [
      ex({ archived: true }),
      ex({ id: 'e2', type: 'time' }),
      ex({ id: 'e3', type: 'band' }),
      ex({ id: 'e4', type: 'weight' })
    ],
    bands,
    sessions: [
      ses('2026-10-19', [
        set({ reps: 10 }), set({ exerciseId: 'e2', sec: 30 }),
        set({ exerciseId: 'e3', reps: 8, bandId: 'r' }),
        set({ exerciseId: 'e4', reps: 7, kg: 5 })
      ]),
      ses(today, [
        set({ reps: 12 }), set({ reps: 8 }),
        set({ exerciseId: 'e2', sec: 40 }),
        set({ exerciseId: 'e3', reps: 9, bandId: 'k' }),
        set({ exerciseId: 'e4', reps: 6, kg: 6 })
      ], { light: true })
    ]
  });
  const before = structuredClone(d);
  assert.deepEqual(totals(d), { e1: 30, e2: 70, e3: 17, e4: 13 });
  assert.deepEqual(totals(data()), {});
  assert.deepEqual(d, before);
});

test('weekStart returns Monday across weekdays and year boundaries', () => {
  for (const date of ['2026-10-22', '2026-10-19', '2026-10-25']) {
    assert.equal(weekStart(date), '2026-10-19');
  }
  assert.equal(weekStart('2027-01-01'), '2026-12-28');
});

test('weekStats preserves streak through illness but not fatigue', () => {
  const d = data({
    sessions: ['2026-10-12', '2026-10-14', '2026-10-16', '2026-10-05']
      .map(date => ses(date, [set({ reps: 10 })])),
    skips: [{ date: '2026-10-06', reason: '風邪' }]
  });
  assert.deepEqual(weekStats(d, today), {
    days: 0, goal: 3, achieved: false, streak: 2, partSets: {}, marks: {}
  });
  d.skips[0].reason = '疲れ';
  assert.equal(weekStats(d, today).streak, 1);
});

test('weekStats counts light days, archived parts and the full current week', () => {
  const d = data({
    exercises: [ex({ archived: true }), ex({ id: 'e2', part: '背中' })],
    sessions: [
      ses('2026-10-18', [set({ reps: 10 })]),
      ses('2026-10-19', [set({ reps: 10 }), set({ reps: 9 })]),
      ses(today, [set({ exerciseId: 'e2', reps: 8 })], { light: true }),
      ses('2026-10-25', [set({ reps: 11 })], { light: true }),
      ses('2026-10-26', [set({ reps: 12 })])
    ],
    skips: [{ date: today, reason: '風邪' }, { date: '2026-10-21', reason: '予定' }]
  });
  const before = structuredClone(d);
  assert.deepEqual(weekStats(d, today), {
    days: 3, goal: 3, achieved: true, streak: 1,
    partSets: { 胸: 3, 背中: 1 },
    marks: {
      '2026-10-19': 'done', '2026-10-20': 'light',
      '2026-10-21': 'rest', '2026-10-25': 'light'
    }
  });
  assert.deepEqual(d, before);
});

test('calendar includes twelve full weeks and gives sessions priority over skips', () => {
  const d = data({
    sessions: [
      ses('2026-08-02', [set({ reps: 1 })]),
      ses('2026-08-03', [set({ reps: 1 })], { light: true }),
      ses('2026-10-25', [set({ reps: 1 })]),
      ses('2026-10-25', [set({ reps: 1 })], { id: 'other', light: true }),
      ses('2026-10-26', [set({ reps: 1 })])
    ],
    skips: [
      { date: '2026-08-03', reason: '疲れ' },
      { date: '2026-10-19', reason: 'その他' }
    ]
  });
  assert.deepEqual(calendar(d, today), {
    '2026-08-03': 'light', '2026-10-19': 'rest', '2026-10-25': 'done'
  });
  assert.deepEqual(calendar(d, today, 1), {
    '2026-10-19': 'rest', '2026-10-25': 'done'
  });
});

test('bodyAvg7 uses inclusive seven-day bounds and ignores null waist', () => {
  const body = [
    { date: '2026-10-13', kg: 100, waist: 100 },
    { date: '2026-10-14', kg: 68, waist: 80 },
    { date: today, kg: 69, waist: null },
    { date: '2026-10-21', kg: 100, waist: 100 }
  ];
  assert.equal(bodyAvg7(body, today, 'kg'), 68.5);
  assert.equal(bodyAvg7(body, today, 'waist'), 80);
  assert.equal(bodyAvg7([], today, 'kg'), null);
  assert.equal(bodyAvg7([{ date: today, kg: 68, waist: null }], today, 'waist'), null);
});

test('compare returns null when the old period has no sessions', () => {
  assert.equal(compare(data(), today), null);
  assert.equal(compare(data({
    sessions: [
      ses('2026-09-15', [set({ reps: 10 })]),
      ses('2026-09-23', [set({ reps: 10 })]),
      ses(today, [set({ reps: 12 })])
    ]
  }), today), null);
});

test('compare includes light and archived records and uses the strongest load', () => {
  const d = data({
    exercises: [
      ex({ type: 'band', archived: true }),
      ex({ id: 'e2', type: 'time', name: 'プランク' })
    ],
    bands,
    sessions: [
      ses('2026-09-16', [
        set({ bandId: 'r', reps: 12 }), set({ exerciseId: 'e2', sec: 30 })
      ]),
      ses('2026-09-22', [set({ bandId: 'y', reps: 100 })]),
      ses('2026-10-14', [
        set({ bandId: 'r', reps: 100 }), set({ exerciseId: 'e2', sec: 45 })
      ]),
      ses(today, [set({ bandId: 'k', reps: 10 })], { light: true }),
      ses('2026-10-21', [set({ bandId: 'k', reps: 999 })])
    ],
    body: [
      { date: '2026-09-16', kg: 69, waist: 81 },
      { date: '2026-09-22', kg: 69.2, waist: null },
      { date: '2026-10-14', kg: 68, waist: 80.5 },
      { date: today, kg: 68.1, waist: 80 }
    ]
  });
  const before = structuredClone(d);
  assert.deepEqual(compare(d, today), {
    items: [
      { exerciseId: 'e1', kind: 'load', text: '腕立て 赤→黒' },
      { exerciseId: 'e2', kind: 'value', text: 'プランク 最高 30→45秒' }
    ],
    totalPct: -2, bodyKg: -1, waist: -0.7
  });
  assert.deepEqual(d, before);
});

test('compare sorts load increases then value rates with stable exercise ties and a three-item limit', () => {
  const exercises = [
    ex({ id: 'v1' }), ex({ id: 'w1', type: 'weight' }),
    ex({ id: 'w2', type: 'weight' }), ex({ id: 'w3', type: 'weight' }),
    ex({ id: 'v2' })
  ];
  const d = data({
    exercises,
    sessions: [
      ses('2026-09-22', exercises.map(ex => set({ exerciseId: ex.id, reps: 10, kg: 5 }))),
      ses(today, [
        set({ exerciseId: 'w3', reps: 1, kg: 6 }),
        set({ exerciseId: 'w2', reps: 1, kg: 7 }),
        set({ exerciseId: 'w1', reps: 1, kg: 6 }),
        set({ exerciseId: 'v2', reps: 30 }),
        set({ exerciseId: 'v1', reps: 20 })
      ])
    ]
  });
  assert.deepEqual(compare(d, today).items.map(item => item.exerciseId), ['w2', 'w1', 'w3']);
  d.exercises = exercises.filter(ex => ex.type !== 'weight');
  d.sessions.forEach(session => {
    session.sets = session.sets.filter(set => ['v1', 'v2'].includes(set.exerciseId));
  });
  assert.deepEqual(compare(d, today).items.map(item => item.exerciseId), ['v2', 'v1']);
  d.sessions[1].sets[0].reps = 20;
  assert.deepEqual(compare(d, today).items.map(item => item.exerciseId), ['v1', 'v2']);
});

test('compare omits decreases, unchanged values and zero baselines', () => {
  const exercises = [
    ex(), ex({ id: 'e2', type: 'weight' }), ex({ id: 'e3' }), ex({ id: 'e4' })
  ];
  const d = data({
    exercises,
    sessions: [
      ses('2026-09-22', [
        set({ reps: 12 }), set({ exerciseId: 'e2', reps: 10, kg: 6 }),
        set({ exerciseId: 'e3', reps: 0 }), set({ exerciseId: 'e4', reps: 10 })
      ]),
      ses(today, [
        set({ reps: 10 }), set({ exerciseId: 'e2', reps: 20, kg: 5 }),
        set({ exerciseId: 'e3', reps: 10 }), set({ exerciseId: 'e4', reps: 10 })
      ])
    ]
  });
  assert.deepEqual(compare(d, today).items, []);
  assert.equal(compare(d, today).bodyKg, null);
  assert.equal(compare(d, today).waist, null);
  assert.deepEqual(compare(data({
    sessions: [ses('2026-09-22', [set({ reps: 0 })])]
  }), today), { items: [], totalPct: null, bodyKg: null, waist: null });
});

test('compare displays missing bands and null kg in load changes', () => {
  for (const bandId of [null, 'missing']) {
    const d = data({
      exercises: [ex({ type: 'band' })],
      bands,
      sessions: [
        ses('2026-09-22', [set({ reps: 12, bandId })]),
        ses(today, [set({ reps: 5, bandId: 'y' })])
      ]
    });
    assert.equal(compare(d, today).items[0].text, '腕立て なし→黄');
  }
  const d = data({
    exercises: [ex({ type: 'weight' })],
    sessions: [
      ses('2026-09-22', [set({ reps: 12 })]),
      ses(today, [set({ reps: 5, kg: 6 })])
    ]
  });
  assert.equal(compare(d, today).items[0].text, '腕立て 0→6kg');
});

test('consultText uses the specified sections, grouping, dates and target ordering', () => {
  const d = data({
    exercises: [
      ex({ name: '腕立て伏せ' }),
      ex({ id: 'e2', type: 'time', name: 'プランク', min: 20, max: 60 }),
      ex({ id: 'e3', type: 'band', name: 'バンドロウ', archived: true }),
      ex({ id: 'e4', name: '未記録' })
    ],
    bands,
    sessions: [
      ses('2026-10-16', [set({ exerciseId: 'e2', sec: 40 }), set({ exerciseId: 'e2', sec: 35 })]),
      ses('2026-10-13', [
        set({ reps: 15 }), set({ reps: 15 }), set({ reps: 14 }),
        set({ exerciseId: 'e3', bandId: 'r', reps: 15 }),
        set({ exerciseId: 'e3', bandId: 'r', reps: 15 }),
        set({ exerciseId: 'e3', bandId: 'k', reps: 10 })
      ], { light: true, note: '少し疲れていた' })
    ],
    skips: [{ date: '2026-10-14', reason: '風邪' }],
    body: [
      { date: '2026-10-16', kg: 68, waist: null },
      { date: '2026-10-13', kg: 68.2, waist: 80.5 }
    ]
  });
  const before = structuredClone(d);
  assert.equal(consultText(d, today), [
    '自宅で自重とバンド中心に筋トレしています。以下の記録を見て、①伸びている点 ②停滞・偏り ③来週の具体的なメニュー提案 を短く教えてください。',
    '',
    '【記録】',
    '10/13 軽め',
    '  腕立て伏せ: 15・15・14回',
    '  バンドロウ: 赤 15・15 / 黒 10回',
    '  メモ: 少し疲れていた',
    '10/16',
    '  プランク: 40・35秒',
    '',
    '【休み】',
    '10/14 風邪',
    '',
    '【体】',
    '10/13 68.2kg ウエスト80.5cm',
    '10/16 68.0kg',
    '',
    '【目標範囲】',
    '腕立て伏せ 8〜15回',
    'プランク 20〜60秒'
  ].join('\n'));
  assert.deepEqual(d, before);
});

test('consultText includes exactly the last 28 days and omits empty sections', () => {
  const d = data({
    sessions: [
      ses('2026-09-22', [set({ reps: 999 })]),
      ses('2026-09-23', [set({ reps: 8 })]),
      ses(today, [set({ reps: 10 })]),
      ses('2026-10-21', [set({ reps: 999 })])
    ],
    skips: [{ date: '2026-09-22', reason: '風邪' }],
    body: [{ date: '2026-10-21', kg: 70, waist: null }]
  });
  const text = consultText(d, today);
  assert.ok(text.startsWith('自宅で自重とバンド中心に筋トレしています。'));
  assert.ok(text.includes('9/23\n  腕立て: 8回'));
  assert.ok(text.includes('10/20\n  腕立て: 10回'));
  assert.ok(!text.includes('999'));
  assert.ok(!text.includes('【休み】'));
  assert.ok(!text.includes('【体】'));
  assert.equal(consultText(data(), today),
    '自宅で自重とバンド中心に筋トレしています。以下の記録を見て、①伸びている点 ②停滞・偏り ③来週の具体的なメニュー提案 を短く教えてください。');
});

test('consultText keeps exercise set order and consecutive load groups with missing-load prefixes', () => {
  const d = data({
    exercises: [
      ex({ type: 'band' }), ex({ id: 'e2', type: 'weight', name: '重り' })
    ],
    bands,
    sessions: [ses(today, [
      set({ exerciseId: 'e2', kg: null, reps: 8 }),
      set({ reps: 9, bandId: null }),
      set({ exerciseId: 'e2', kg: 6, reps: 10 }),
      set({ exerciseId: 'e2', kg: 6, reps: 10 }),
      set({ exerciseId: 'e2', kg: null, reps: 7 }),
      set({ reps: 8, bandId: 'missing' }),
      set({ reps: 7, bandId: 'r' }),
      set({ reps: 6, bandId: null })
    ])]
  });
  const text = consultText(d, today);
  assert.ok(text.includes(
    '  重り: 0kg 8 / 6kg 10・10 / 0kg 7回\n  腕立て: なし 9・8 / 赤 7 / なし 6回'
  ));
  assert.ok(text.endsWith('【目標範囲】\n腕立て 8〜15回\n重り 8〜15回'));
});

test('parseImport rejects malformed JSON and invalid top-level shapes without changing current data', () => {
  const current = data();
  const before = structuredClone(current);
  for (const text of ['{}', 'not json', 'null', '[]', '1']) {
    assert.throws(() => parseImport(text), { message: '読み込めないファイルです' });
  }
  for (const key of ['exercises', 'bands', 'templates', 'sessions', 'skips', 'body']) {
    const invalid = data({ [key]: {} });
    assert.throws(() => parseImport(JSON.stringify(invalid)), {
      message: '読み込めないファイルです'
    });
  }
  for (const settings of [null, [], 'settings', 1]) {
    assert.throws(() => parseImport(JSON.stringify(data({ settings }))), {
      message: '読み込めないファイルです'
    });
  }
  assert.throws(() => parseImport(JSON.stringify(data({ version: 2 }))), {
    message: '読み込めないファイルです'
  });
  assert.deepEqual(parseImport(JSON.stringify(current)), current);
  assert.deepEqual(current, before);
});

test('toBase64Utf8 encodes Japanese and large UTF-8 payloads without argument-limit errors', () => {
  for (const text of ['', '腕立て', '筋トレ💪', '腕'.repeat(3_000_000)]) {
    assert.equal(toBase64Utf8(text), Buffer.from(text).toString('base64'));
  }
});

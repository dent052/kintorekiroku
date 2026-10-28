import test from 'node:test';
import assert from 'node:assert/strict';
import {
  localDate, value, load, recent, top, firstSet, history, line, lineResult, lineText, prefill, rows,
  prKind, isStageUp, sessionEvents, totals,
  weekStart, weekStats, calendar, totalDays, feed, mergeFeed, bodyAvg7, consultText,
  parseImport, toBase64Utf8, parsePosts, lineHistory, clearCount, weekHeat, menuExercises,
  firstSetResult, setHistory, personalBest, unreadPosts, coachTimeline, coachTimeLabel, coachWaitingNote,
  recordDelta, loadUpPoints, monthCalendar, moveBand, removeBand, carryLoad
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
    days: 3,
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

test('consultText uses the specified sections, grouping, dates and load guidance', () => {
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
    '【負荷アップの目安】',
    '1セット目が20回（時間は60秒）を超えたら負荷を上げる'
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
    '自宅で自重とバンド中心に筋トレしています。以下の記録を見て、①伸びている点 ②停滞・偏り ③来週の具体的なメニュー提案 を短く教えてください。\n\n【負荷アップの目安】\n1セット目が20回（時間は60秒）を超えたら負荷を上げる');
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
  assert.ok(text.endsWith('【負荷アップの目安】\n1セット目が20回（時間は60秒）を超えたら負荷を上げる'));
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

const withHistory = (values, exercise = ex(), entry = {}) => data({
  exercises: [exercise],
  bands,
  sessions: values.map((v, i) => ses('2026-10-' + String(19 - i).padStart(2, '0'), [
    set({ reps: exercise.type === 'time' ? null : v, sec: exercise.type === 'time' ? v : null, ...entry })
  ]))
});

test('firstSet returns the first matching set or undefined', () => {
  const a = set({ reps: 12 });
  assert.strictEqual(firstSet(data(), ex(), ses(today, [
    set({ exerciseId: 'e2', reps: 30 }), a, set({ reps: 20 })
  ])), a);
  assert.equal(firstSet(data(), ex(), ses(today, [])), undefined);
});

test('history selects first sets at the current load, excluding today and light sessions', () => {
  const d = withHistory([12, 99, 13, 14, 15], ex({ type: 'band' }), { bandId: 'k' });
  d.sessions[1].sets[0].bandId = 'r';
  d.sessions[0].sets.push(set({ reps: 100, bandId: 'r' }));
  d.sessions.push(ses(today, [set({ reps: 90, bandId: 'r' })]));
  d.sessions.push(ses('2026-10-19', [set({ reps: 90, bandId: 'r' })], { light: true }));
  const before = structuredClone(d);
  assert.deepEqual(history(d, 'e1', today), { load: 3, values: [12, 13, 14] });
  assert.deepEqual(history(data(), 'e1', today), { load: 0, values: [] });
  assert.deepEqual(d, before);
});

test('line uses the upper median and the correct step', () => {
  for (const [values, expected] of [
    [[], { kind: 'base' }],
    [[15, 14, 16], { kind: 'line', value: 16 }],
    [[12, 15], { kind: 'line', value: 16 }],
    [[12], { kind: 'line', value: 13 }],
    [[12, 13, 14], { kind: 'down', value: 14 }],
    [[15, 15, 14, 15, 14, 13], { kind: 'flat', value: 16 }]
  ]) {
    assert.deepEqual(line(withHistory(values), 'e1', today), expected);
  }
  assert.deepEqual(line(withHistory([40], ex({ type: 'time' })), 'e1', today),
    { kind: 'line', value: 45 });
});

test('line load-up uses the first set, thresholds and next-stage priority', () => {
  const d = withHistory([20], ex({ type: 'band' }), { bandId: 'r' });
  assert.deepEqual(line(d, 'e1', today), { kind: 'up', next: '黒' });
  d.exercises[0].nextId = 'e4';
  d.exercises.push(ex({ id: 'e4', name: '足上げ腕立て', archived: true }));
  d.sessions[0].sets[0].reps = 22;
  assert.deepEqual(line(d, 'e1', today), { kind: 'up', next: '足上げ腕立て' });
  assert.deepEqual(prefill(d, 'e1', today), d.sessions[0].sets);
  assert.deepEqual(line(withHistory([20], ex({ type: 'weight' }), { kg: 5 }), 'e1', today),
    { kind: 'up', next: '6kg' });
  const timed = withHistory([60], ex({ type: 'time', nextId: 'e4' }));
  timed.exercises.push(ex({ id: 'e4', name: '次' }));
  assert.deepEqual(line(timed, 'e1', today), { kind: 'up', next: '次' });
  assert.deepEqual(line(withHistory([20]), 'e1', today), { kind: 'line', value: 21 });
  d.exercises[0].nextId = null;
  d.sessions[0].sets[0].reps = 19;
  d.sessions[0].sets.push(set({ reps: 99, bandId: 'k' }));
  assert.deepEqual(line(d, 'e1', today), { kind: 'line', value: 20 });
});

test('flat requires six first sets at the same load and takes priority over down', () => {
  const d = withHistory([12, 13, 14, 15, 14, 13], ex({ type: 'band' }), { bandId: 'k' });
  assert.deepEqual(line(d, 'e1', today), { kind: 'flat', value: 14 });
  d.sessions[5].sets[0].bandId = 'r';
  assert.deepEqual(line(d, 'e1', today), { kind: 'down', value: 14 });
  assert.deepEqual(line(withHistory([16, 15, 14, 15, 14, 13]), 'e1', today),
    { kind: 'line', value: 16 });
});

test('lineResult compares only numeric lines', () => {
  assert.deepEqual(lineResult({ kind: 'base' }, 12), { kind: 'base' });
  assert.deepEqual(lineResult({ kind: 'up', next: '黒' }, 12), { kind: 'newload' });
  for (const kind of ['line', 'flat', 'down']) {
    assert.deepEqual(lineResult({ kind, value: 16 }, 16), { kind: 'clear' });
    assert.deepEqual(lineResult({ kind, value: 16 }, 18), { kind: 'clear' });
    assert.deepEqual(lineResult({ kind, value: 16 }, 15), { kind: 'short', diff: 1 });
  }
});

test('lineText uses the specified pre-set strings', () => {
  assert.equal(lineText({ kind: 'base' }, ex()), '初回。この1セットが基準になる');
  assert.equal(lineText({ kind: 'line', value: 16 }, ex()), 'ライン 16');
  assert.equal(lineText({ kind: 'line', value: 45 }, ex({ type: 'time' })), 'ライン 45秒');
  assert.equal(lineText({ kind: 'up', next: '黒' }, ex()), '20回を超えた。次は黒で。');
  assert.equal(lineText({ kind: 'up', next: '次' }, ex({ type: 'time' })), '60秒を超えた。次は次で。');
  assert.equal(lineText({ kind: 'flat', value: 16 }, ex()), '3回、横ばい。負荷を変えるか、1日休むタイミング');
  assert.equal(lineText({ kind: 'down', value: 14 }, ex()), '下がり続けている。今日は軽めでいい');
});

test('prefill uses fixed defaults without eligible history', () => {
  for (const [exercise, expected] of [
    [ex(), set({ reps: 10 })],
    [ex({ type: 'time' }), set({ sec: 30 })],
    [ex({ type: 'weight' }), set({ reps: 10, kg: 5 })],
    [ex({ type: 'band' }), set({ reps: 10, bandId: 'y' })]
  ]) {
    const d = data({ exercises: [exercise], bands: [bands[2], bands[0], bands[1]],
      sessions: [ses(today, [set({ reps: 99 })]), ses('2026-10-19', [set({ reps: 99 })], { light: true })] });
    assert.deepEqual(prefill(d, 'e1', today), [expected]);
    assert.deepEqual(line(d, 'e1', today), { kind: 'base' });
  }
  assert.deepEqual(prefill(data({ exercises: [ex({ type: 'band' })] }), 'e1', today),
    [set({ reps: 10 })]);
});

test('prefill keeps every previous set unchanged even when the line suggests a load increase', () => {
  for (const type of ['band', 'weight']) {
    const d = withHistory([20], ex({ type }), { bandId: type === 'band' ? 'r' : null, kg: type === 'weight' ? 5 : null });
    d.sessions[0].sets.push(set({ reps: 8, bandId: type === 'band' ? 'y' : null, kg: type === 'weight' ? 10 : null }));
    const before = structuredClone(d);
    const result = prefill(d, 'e1', today);
    assert.deepEqual(result.map(s => type === 'band' ? s.bandId : s.kg),
      type === 'band' ? ['r', 'y'] : [5, 10]);
    assert.deepEqual(result.map(s => s.reps), [20, 8]);
    assert.deepEqual(result, before.sessions[0].sets);
    assert.notStrictEqual(result[0], d.sessions[0].sets[0]);
    result[0].reps = 1;
    assert.deepEqual(d, before);
    d.sessions[0].sets[0].reps = 19;
    assert.deepEqual(prefill(d, 'e1', today), d.sessions[0].sets);
  }
});

test('totalDays counts distinct dates including light sessions', () => {
  assert.equal(totalDays(data()), 0);
  assert.equal(totalDays(data({ sessions: [
    ses(today, []), ses(today, [], { id: 'other' }),
    ses('2026-10-19', [], { light: true })
  ] })), 2);
});

test('old min, max and weeklyGoal fields do not affect lines, prefill, stats or feed', () => {
  const d = withHistory([15, 14, 16], ex({ name: '腕立て伏せ', min: 8, max: 15 }));
  d.settings.weeklyGoal = 3;
  d.sessions.push(ses(today, [set({ reps: 16 })]));
  assert.deepEqual(line(d, 'e1', today), { kind: 'line', value: 16 });
  assert.deepEqual(prefill(d, 'e1', today), [set({ reps: 15 })]);
  assert.deepEqual(weekStats(d, today), {
    days: 2, partSets: { 胸: 2 }, marks: { '2026-10-19': 'done', '2026-10-20': 'done' }
  });
  assert.deepEqual(feed(d, today), [
    { id: 'clear:e1:2026-10-20', at: today, kind: 'clear', text: '腕立て伏せ ライン16を突破' }
  ]);
  const before = [line(d, 'e1', today), prefill(d, 'e1', today), weekStats(d, today), feed(d, today)];
  delete d.exercises[0].min;
  delete d.exercises[0].max;
  delete d.settings.weeklyGoal;
  assert.deepEqual([line(d, 'e1', today), prefill(d, 'e1', today), weekStats(d, today), feed(d, today)], before);
});

test('feed uses the latest session through today and one item of each kind in exercise order', () => {
  const d = data({
    exercises: [ex({ name: '腕立て伏せ' }), ex({ id: 'e2' })],
    sessions: [
      ses('2026-10-19', [set({ exerciseId: 'e2', reps: 14 }), set({ reps: 15 })]),
      ses(today, [set({ exerciseId: 'e2', reps: 16 }), set({ reps: 16 })]),
      ses('2026-10-21', [set({ reps: 99 })])
    ]
  });
  const before = structuredClone(d);
  assert.deepEqual(feed(d, today), [
    { id: 'clear:e1:2026-10-20', at: today, kind: 'clear', text: '腕立て伏せ ライン16を突破' },
    { id: 'pr:e1:2026-10-20', at: today, kind: 'pr', text: '腕立て伏せ 自己ベスト 16回' }
  ]);
  assert.equal(new Set(feed(d, today).map(item => item.kind)).size, feed(d, today).length);
  assert.deepEqual(d, before);
  assert.deepEqual(feed(data(), today), []);
});

test('feed does not compare a first set at a different load', () => {
  const d = withHistory([15], ex({ type: 'band' }), { bandId: 'k' });
  d.sessions.push(ses(today, [set({ reps: 16, bandId: 'r' })]));
  assert.ok(!feed(d, today).some(item => item.kind === 'clear'));
});

test('feed includes load and stage events in the specified kind order', () => {
  const d = data({
    exercises: [
      ex({ type: 'band' }), ex({ id: 'e2', nextId: 'e3' }),
      ex({ id: 'e3', name: '足上げ腕立て' })
    ],
    bands,
    sessions: [
      ses('2026-10-19', [set({ reps: 15, bandId: 'r' })]),
      ses(today, [set({ reps: 10, bandId: 'k' }), set({ exerciseId: 'e3', reps: 12 })])
    ]
  });
  assert.deepEqual(feed(d, today), [
    { id: 'load:e1:2026-10-20', at: today, kind: 'load', text: '腕立て 赤→黒' },
    { id: 'stage:e3:2026-10-20', at: today, kind: 'stage', text: '足上げ腕立て に進んだ' }
  ]);
});

test('feed near uses the next milestone, its unit and the inclusive ten-percent boundary', () => {
  for (const [sum, milestone, diff] of [[90, 100, 10], [95, 100, 5], [450, 500, 50], [900, 1000, 100], [1800, 2000, 200]]) {
    const d = data({ exercises: [ex({ name: '腕立て伏せ' })],
      sessions: [ses(today, [set({ reps: sum })])] });
    assert.deepEqual(feed(d, today), [{
      id: 'near:e1:' + milestone, at: today, kind: 'near',
      text: '累計腕立て伏せ ' + milestone + '回まで あと' + diff + '回'
    }]);
  }
  for (const sum of [89, 100, 500, 1000]) {
    assert.deepEqual(feed(data({ sessions: [ses(today, [set({ reps: sum })])] }), today), []);
  }
  const timed = data({ exercises: [ex({ type: 'time', name: 'プランク' })],
    sessions: [ses(today, [set({ sec: 95 })], { light: true })] });
  assert.equal(feed(timed, today)[0].text, '累計プランク 100秒まで あと5秒');
});

test('mergeFeed pins only unread replies then orders dates without truncating posts or items', () => {
  const own = [{ id: 'clear:e1:2026-10-20', at: today, kind: 'clear', text: '記録' }];
  const posts = [
    { id: 'reply', at: '2026-10-18T07:30:00+09:00', kind: 'reply', quote: 'メモ', text: '返信' },
    { id: 'reading', at: '2026-10-20T07:30:00+09:00', kind: 'reading', text: '本文', source: { title: '資料', url: 'https://example.com' } },
    { id: 'weekly', at: '2026-10-19T07:30:00+09:00', kind: 'weekly', text: '週次' }
  ];
  const before = structuredClone([own, posts]);
  assert.deepEqual(mergeFeed(own, posts, []).map(item => item.id),
    ['reply', 'reading', 'clear:e1:2026-10-20', 'weekly']);
  assert.deepEqual(mergeFeed(own, posts, ['reply']).map(item => item.id),
    ['reading', 'clear:e1:2026-10-20', 'weekly', 'reply']);
  assert.deepEqual(mergeFeed([], [], []), []);
  assert.deepEqual([own, posts], before);
});

test('parsePosts keeps valid posts newest first and rejects bad input', () => {
  const ok = (id, at, kind = 'reading') => ({ id, at, kind, text: 't' });
  assert.deepEqual(parsePosts('{"id":"x"}'), []);
  assert.deepEqual(parsePosts('not json'), []);
  const posts = parsePosts(JSON.stringify([
    ok('a', '2026-10-18T07:30:00+09:00'),
    { at: '2026-10-19T07:30:00+09:00', kind: 'reply', text: 'no id' },
    ok('b', '2026-10-20T07:30:00+09:00', 'reply'),
    ok('c', '2026-10-19T07:30:00+09:00', 'tweet'),
    null
  ]));
  assert.deepEqual(posts.map(post => post.id), ['b', 'a']);
  assert.equal(parsePosts(JSON.stringify(Array.from({ length: 250 }, (_, i) =>
    ok(`p${i}`, `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}`)))).length, 200);
});

test('lineHistory returns distinct dates ascending, excluding light days and missing line values', () => {
  const d = data({
    exercises: [ex({ type: 'band' })],
    bands,
    sessions: [
      ses('2026-10-19', [set({ reps: 14, bandId: 'k' })]),
      ses('2026-10-15', [set({ reps: 20, bandId: 'r' })]),
      ses('2026-10-17', [set({ reps: 99, bandId: 'r' })], { light: true }),
      ses('2026-10-16', [set({ reps: 12, bandId: 'k' })]),
      ses('2026-10-14', [set({ reps: 15, bandId: 'r' })]),
      ses('2026-10-18', [
        set({ exerciseId: 'e2', reps: 99 }),
        set({ reps: 13, bandId: 'k' }), set({ reps: 99, bandId: 'r' })
      ]),
      ses('2026-10-18', [set({ reps: 13, bandId: 'k' })], { id: 'duplicate' }),
      ses('2026-10-20', [set({ exerciseId: 'e2', reps: 99 })])
    ]
  });
  const before = structuredClone(d);
  assert.deepEqual(lineHistory(d, 'e1'), [
    { date: '2026-10-15', value: 16, load: 2 },
    { date: '2026-10-18', value: 13, load: 3 },
    { date: '2026-10-19', value: 14, load: 3 }
  ]);
  assert.deepEqual(lineHistory(data(), 'e1'), []);
  assert.deepEqual(d, before);
});

test('lineHistory uses seconds, kg and numeric flat and down lines', () => {
  const timed = data({
    exercises: [ex({ type: 'time' })],
    sessions: [
      ses('2026-10-18', [set({ sec: 30 })]),
      ses('2026-10-19', [set({ sec: 35 })])
    ]
  });
  assert.deepEqual(lineHistory(timed, 'e1'), [
    { date: '2026-10-19', value: 35, load: 0 }
  ]);
  const weighted = data({
    exercises: [ex({ type: 'weight' })],
    sessions: [
      ses('2026-10-18', [set({ reps: 10, kg: 5 })]),
      ses('2026-10-19', [set({ reps: 11, kg: 6 }), set({ reps: 99, kg: 9 })])
    ]
  });
  assert.deepEqual(lineHistory(weighted, 'e1'), [
    { date: '2026-10-19', value: 11, load: 6 }
  ]);
  for (const values of [[12, 13, 14], [12, 13, 14, 15, 14, 13]]) {
    const d = withHistory(values);
    d.sessions.push(ses(today, [set({ reps: 14 })]));
    assert.deepEqual(lineHistory(d, 'e1').at(-1), { date: today, value: 14, load: 0 });
  }
});

test('clearCount compares only first sets and excludes light, base and newload results', () => {
  const d = data({
    exercises: [ex({ type: 'band' })],
    bands,
    sessions: [
      ses('2026-10-19', [set({ reps: 14, bandId: 'k' })]),
      ses('2026-10-18', [set({ reps: 13, bandId: 'k' })]),
      ses('2026-10-17', [set({ reps: 99, bandId: 'k' })], { light: true }),
      ses('2026-10-16', [set({ reps: 12, bandId: 'k' })]),
      ses('2026-10-15', [set({ reps: 20, bandId: 'r' })]),
      ses('2026-10-14', [set({ reps: 15, bandId: 'r' })]),
      ses(today, [set({ reps: 12, bandId: 'k' }), set({ reps: 99, bandId: 'k' })]),
      ses('2026-10-21', [set({ exerciseId: 'e2', reps: 99 })])
    ]
  });
  const before = structuredClone(d);
  assert.equal(clearCount(d, 'e1'), 3);
  assert.equal(clearCount(data(), 'e1'), 0);
  assert.deepEqual(d, before);
});

test('clearCount includes clear flat and down lines and uses seconds for time', () => {
  for (const values of [[12, 13, 14], [12, 13, 14, 15, 14, 13]]) {
    const d = withHistory(values);
    const before = clearCount(d, 'e1');
    d.sessions.push(ses(today, [set({ reps: 14 })]));
    assert.equal(clearCount(d, 'e1'), before + 1);
  }
  const d = data({
    exercises: [ex({ type: 'time' })],
    sessions: [
      ses('2026-10-17', [set({ sec: 30 })]),
      ses('2026-10-18', [set({ sec: 34 }), set({ sec: 99 })]),
      ses('2026-10-19', [set({ sec: 39 })])
    ]
  });
  assert.equal(clearCount(d, 'e1'), 1);
});

test('weekHeat counts distinct session days including light within twelve full Monday weeks', () => {
  const d = data({
    sessions: [
      ses('2026-08-02', [set({ reps: 1 })]),
      ses('2026-08-03', [set({ reps: 1 })], { light: true }),
      ses('2026-08-09', [set({ reps: 1 })]),
      ses('2026-08-10', [set({ reps: 1 })]),
      ses('2026-10-18', [set({ reps: 1 })]),
      ses('2026-10-19', [set({ reps: 1 })]),
      ses('2026-10-19', [set({ reps: 1 })], { id: 'duplicate' }),
      ses(today, [set({ reps: 1 })], { light: true }),
      ses('2026-10-25', [set({ reps: 1 })]),
      ses('2026-10-26', [set({ reps: 1 })])
    ],
    skips: [{ date: '2026-08-04', reason: '疲れ' }]
  });
  const before = structuredClone(d);
  assert.deepEqual(weekHeat(d, today), [2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 3]);
  assert.deepEqual(weekHeat(data(), today), Array(12).fill(0));
  assert.deepEqual(d, before);
});

test('weekHeat handles the year boundary with Monday as the first day', () => {
  const d = data({ sessions: [
    ses('2026-12-27', [set({ reps: 1 })]),
    ses('2026-12-28', [set({ reps: 1 })]),
    ses('2027-01-03', [set({ reps: 1 })]),
    ses('2027-01-04', [set({ reps: 1 })])
  ] });
  assert.deepEqual(weekHeat(d, '2027-01-01'), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2]);
});

test('menuExercises same uses the latest earlier non-light session in distinct set order', () => {
  const d = data({
    exercises: [ex(), ex({ id: 'e2', archived: true })],
    sessions: [
      ses('2026-10-17', [set({ reps: 10 })]),
      ses(today, [set({ reps: 10 })]),
      ses('2026-10-18', [
        set({ exerciseId: 'e2', reps: 10 }), set({ exerciseId: 'missing', reps: 10 }),
        set({ reps: 10 }), set({ exerciseId: 'e2', reps: 9 })
      ]),
      ses('2026-10-19', [set({ reps: 10 })], { light: true }),
      ses('2026-10-21', [set({ reps: 10 })])
    ]
  });
  const before = structuredClone(d);
  for (const menu of [{ kind: 'same' }, undefined, null, {}, { kind: 'unknown' },
    { kind: 'template', templateId: 'missing' }]) {
    assert.deepEqual(menuExercises(d, menu, today), ['e2', 'e1']);
  }
  assert.deepEqual(d, before);
});

test('menuExercises template and custom keep selection order and only existing ids', () => {
  const d = data({
    exercises: [ex(), ex({ id: 'e2' })],
    templates: [
      { id: 't1', name: '背中', exerciseIds: ['e2', 'missing', 'e1'], sets: 3 },
      { id: 'empty', name: '空', exerciseIds: [], sets: 3 }
    ],
    sessions: [ses('2026-10-19', [set({ reps: 10 })])]
  });
  const menu = { kind: 'custom', exerciseIds: ['e2', 'missing', 'e1'] };
  const before = structuredClone([d, menu]);
  assert.deepEqual(menuExercises(d, { kind: 'template', templateId: 't1' }, today), ['e2', 'e1']);
  assert.deepEqual(menuExercises(d, menu, today), ['e2', 'e1']);
  assert.deepEqual(menuExercises(d, { kind: 'template', templateId: 'empty' }, today), []);
  assert.deepEqual(menuExercises(d, { kind: 'custom', exerciseIds: [] }, today), []);
  assert.deepEqual([d, menu], before);
});

test('menuExercises returns empty when no selected or previous exercises exist', () => {
  const d = data({ exercises: [] });
  for (const menu of [undefined, { kind: 'same' },
    { kind: 'template', templateId: 'missing' }, { kind: 'custom', exerciseIds: [] }]) {
    assert.deepEqual(menuExercises(d, menu, today), []);
  }
  assert.deepEqual(menuExercises(data({ sessions: [
    ses(today, [set({ reps: 10 })]),
    ses('2026-10-19', [set({ reps: 10 })], { light: true })
  ] }), { kind: 'same' }, today), []);
});

test('firstSetResult compares completed first sets only at the line load', () => {
  for (const [type, previous, changed] of [
    ['band', { bandId: 'r' }, { bandId: 'k' }],
    ['weight', { kg: 5 }, { kg: 6 }]
  ]) {
    const d = withHistory([15], ex({ type }), previous);
    const before = structuredClone(d);
    assert.deepEqual(firstSetResult(d, 'e1', today, set({ reps: 16, ...previous })),
      { kind: 'clear' });
    assert.deepEqual(firstSetResult(d, 'e1', today, set({ reps: 14, ...previous })),
      { kind: 'short', diff: 2 });
    assert.deepEqual(firstSetResult(d, 'e1', today, set({ reps: 99, ...changed })),
      { kind: 'newload' });
    assert.deepEqual(d, before);
  }
});

test('firstSetResult reports factual differences for up at the same load', () => {
  for (const [type, previous, threshold, next] of [
    ['band', { bandId: 'r' }, 20, '黒'],
    ['weight', { kg: 5 }, 20, '6kg'],
    ['time', {}, 60, '次']
  ]) {
    const d = withHistory([threshold], ex({ type, nextId: type === 'time' ? 'e2' : null }), previous);
    if (type === 'time') d.exercises.push(ex({ id: 'e2', name: '次' }));
    const before = structuredClone(d);
    for (const diff of [-2, 0, 3]) {
      const entry = set({ ...previous, [type === 'time' ? 'sec' : 'reps']: threshold + diff });
      assert.deepEqual(firstSetResult(d, 'e1', today, entry),
        { kind: 'previous', diff, next });
    }
    if (type !== 'time') {
      assert.deepEqual(firstSetResult(d, 'e1', today,
        set({ reps: threshold + 3, bandId: 'k', kg: 6 })), { kind: 'newload' });
    }
    assert.deepEqual(d, before);
  }
});

test('firstSetResult keeps first-ever sets as a baseline and compares seconds', () => {
  const d = data({ exercises: [ex({ type: 'band' })], bands });
  assert.deepEqual(firstSetResult(d, 'e1', today, set({ reps: 10, bandId: 'y' })),
    { kind: 'base' });
  const timed = withHistory([30], ex({ type: 'time' }));
  assert.deepEqual(firstSetResult(timed, 'e1', today, set({ sec: 35 })), { kind: 'clear' });
  assert.deepEqual(firstSetResult(timed, 'e1', today, set({ sec: 34 })),
    { kind: 'short', diff: 1 });
});

test('clearCount and feed exclude changed loads and same-load up comparisons', () => {
  for (const reps of [15, 20]) {
    for (const bandId of ['r', 'k']) {
      const d = withHistory([reps], ex({ type: 'band' }), { bandId: 'r' });
      d.sessions.push(ses(today, [set({ reps: 22, bandId })]));
      const expected = reps === 15 && bandId === 'r';
      assert.equal(clearCount(d, 'e1'), expected ? 1 : 0);
      assert.equal(feed(d, today).some(item => item.kind === 'clear'), expected);
    }
  }
});

test('setHistory groups actual sets by day, including light days and all later sets', () => {
  const d = data({ exercises: [ex({ type: 'band' })], bands, sessions: [
    ses('2026-10-19', [set({ reps: 12, bandId: 'k' }), set({ reps: 9, bandId: 'r' })]),
    ses('2026-10-17', [set({ exerciseId: 'e2', reps: 99 }),
      set({ reps: 20, bandId: 'r' }), set({ reps: 16, bandId: 'r' })]),
    ses('2026-10-18', [set({ reps: 8, bandId: 'r' })], { light: true }),
    ses('2026-10-19', [set({ reps: 7, bandId: 'k' })], { id: 'later' }),
    ses(today, [set({ exerciseId: 'e2', reps: 99 })])
  ] });
  const before = structuredClone(d);
  assert.deepEqual(setHistory(d, 'e1'), [
    { date: '2026-10-17', value: 20, load: 2, others: [16] },
    { date: '2026-10-18', value: 8, load: 2, others: [] },
    { date: '2026-10-19', value: 12, load: 3, others: [9, 7] }
  ]);
  assert.deepEqual(setHistory(data(), 'e1'), []);
  assert.deepEqual(d, before);
});

test('setHistory uses seconds and preserves weight loads and zero values', () => {
  for (const type of ['time', 'weight']) {
    const d = data({ exercises: [ex({ type })], sessions: [
      ses(today, [set({ reps: 0, sec: 0, kg: 12.5 }),
        set({ reps: 8, sec: 25, kg: 5 })], { light: true })
    ] });
    assert.deepEqual(setHistory(d, 'e1'), [
      { date: today, value: 0, load: type === 'weight' ? 12.5 : 0,
        others: [type === 'time' ? 25 : 8] }
    ]);
  }
});

test('personalBest requires a strictly higher actual value at the same load', () => {
  const d = data({
    exercises: [ex({ type: 'band' })], bands,
    sessions: [ses('2026-10-19', [
      set({ reps: 12, bandId: 'r' }), set({ reps: 18, bandId: 'r' }),
      set({ reps: 40, bandId: 'y' }), set({ exerciseId: 'e2', reps: 100, bandId: 'r' })
    ])]
  });
  const before = structuredClone(d);
  assert.equal(personalBest(d, set({ reps: 19, bandId: 'r' }), today), 18);
  assert.equal(personalBest(d, set({ reps: 18, bandId: 'r' }), today), null);
  assert.equal(personalBest(d, set({ reps: 17, bandId: 'r' }), today), null);
  assert.equal(personalBest(d, set({ reps: 50, bandId: 'k' }), today), null);
  assert.deepEqual(d, before);
});

test('personalBest includes light history and earlier sets today but excludes future records', () => {
  const d = data({ sessions: [
    ses('2026-10-19', [set({ reps: 18 })], { light: true }),
    ses(today, [set({ reps: 19 }), set({ reps: 17 })]),
    ses('2026-10-21', [set({ reps: 100 })])
  ] });
  const before = structuredClone(d);
  assert.equal(personalBest(d, set({ reps: 19 }), today), null);
  assert.equal(personalBest(d, set({ reps: 20 }), today), 19);
  assert.deepEqual(d, before);
});

test('personalBest uses seconds and compares weights independently', () => {
  const timed = data({ exercises: [ex({ type: 'time' })],
    sessions: [ses('2026-10-19', [set({ sec: 30 }), set({ sec: 45 })])] });
  assert.equal(personalBest(timed, set({ sec: 45 }), today), null);
  assert.equal(personalBest(timed, set({ sec: 46 }), today), 45);
  const weighted = data({ exercises: [ex({ type: 'weight' })],
    sessions: [ses('2026-10-19', [
      set({ reps: 12, kg: 5 }), set({ reps: 30, kg: 6 })
    ])] });
  assert.equal(personalBest(weighted, set({ reps: 13, kg: 5 }), today), 12);
  assert.equal(personalBest(weighted, set({ reps: 31, kg: 7 }), today), null);
  assert.equal(personalBest(weighted, set({ reps: 12, kg: 5 }), today), null);
});

test('personalBest has no first-ever result and preserves a previous maximum of zero', () => {
  assert.equal(personalBest(data(), set({ reps: 10 }), today), null);
  const d = data({ sessions: [ses(today, [set({ reps: 0 })])] });
  assert.equal(personalBest(d, set({ reps: 0 }), today), null);
  assert.equal(personalBest(d, set({ reps: 1 }), today), 0);
});

test('unreadPosts counts only unseen coach posts without changing inputs', () => {
  const posts = ['reply', 'weekly', 'finding', 'reading', 'clear', 'pr', 'message', 'memo']
    .map(kind => ({ id: kind, at: today, kind, text: kind }));
  const seen = ['reply', 'clear', 'unrelated'];
  const before = structuredClone([posts, seen]);
  assert.deepEqual(unreadPosts(posts, seen).map(post => post.id),
    ['weekly', 'finding', 'reading']);
  assert.deepEqual(unreadPosts(posts, []).map(post => post.id),
    ['reply', 'weekly', 'finding', 'reading']);
  assert.deepEqual(unreadPosts(posts, posts.map(post => post.id)), []);
  assert.deepEqual(unreadPosts([], []), []);
  assert.deepEqual([posts, seen], before);
});

test('coachTimeline orders actual instants and date-only memos without pinning replies', () => {
  const reply = { id: 'reply', at: new Date(2026, 9, 20, 23).toISOString(), kind: 'reply',
    text: '返信', quote: 'メモ', ref: ['s2026-10-20'] };
  const reading = { id: 'reading', at: new Date(2026, 9, 20, 22, 23).toISOString(), kind: 'reading',
    text: '読み物', source: { title: '資料', url: 'https://example.com/form' } };
  const message = { id: 'message', at: new Date(2026, 9, 21, 0, 1).toISOString(), text: '相談' };
  const d = data({
    messages: [message],
    sessions: [
      ses('2026-10-21', [], { toCoach: true, note: '送ったメモ' }),
      ses('2026-10-22', [], { toCoach: false, note: '自分だけのメモ' }),
      ses('2026-10-23', [], { note: '送っていない' }),
      ses('2026-10-24', [], { toCoach: true, note: ' \n ' })
    ]
  });
  const posts = [reading, reply,
    { id: 'clear', at: '2026-10-25', kind: 'clear', text: '突破' }];
  const before = structuredClone([d, posts]);
  const timeline = coachTimeline(d, posts);
  assert.deepEqual(timeline.map(item => item.id),
    ['message', 's2026-10-21', 'reply', 'reading']);
  assert.deepEqual(timeline[0], { ...message, kind: 'message' });
  assert.deepEqual(timeline[1],
    { id: 's2026-10-21', at: '2026-10-21', text: '送ったメモ', kind: 'memo' });
  assert.deepEqual(timeline.slice(2), [reply, reading]);
  assert.deepEqual([d, posts], before);
});

test('coachTimeline compares timezone offsets as instants rather than strings', () => {
  const posts = [
    { id: 'reading', at: '2026-10-21T07:23:00+09:00', kind: 'reading', text: '読み物' },
    { id: 'reply', at: '2026-10-20T23:00:00Z', kind: 'reply', text: '返信' }
  ];
  assert.deepEqual(coachTimeline(data(), posts).map(item => item.id), ['reply', 'reading']);
});

test('date-only timeline entries and waiting comparisons use local midnight', () => {
  const d = data({
    messages: [{ id: 'm', at: new Date(2026, 9, 21, 6).toISOString(), text: '相談' }],
    sessions: [ses('2026-10-21', [], { toCoach: true, note: 'メモ' })]
  });
  const post = { id: 'p', at: new Date(2026, 9, 21, 7, 23).toISOString(),
    kind: 'reply', text: '返信' };
  const timeline = coachTimeline(d, [post]);
  assert.deepEqual(timeline.map(item => item.id), ['p', 'm', 's2026-10-21']);
  assert.equal(coachWaitingNote(timeline, new Date(2026, 9, 21, 12)), null);
  const midnightPost = coachTimeline(d, [{ ...post, at: '2026-10-21' }]);
  assert.equal(midnightPost[0].id, 'm');
  assert.deepEqual(coachWaitingNote(midnightPost, new Date(2026, 9, 21, 12)), {
    id: 'm', text: '返事は明日の朝 7:22 ごろ届きます'
  });
});

test('coachTimeline treats missing and non-array messages as empty', () => {
  assert.deepEqual(coachTimeline(data(), []), []);
  for (const messages of [undefined, null, {}, '', 1]) {
    const d = data({ messages, sessions: [
      ses(today, [], { toCoach: true, note: 'メモ' })
    ] });
    assert.deepEqual(coachTimeline(d, []), [
      { id: 's' + today, at: today, text: 'メモ', kind: 'memo' }
    ]);
  }
});

test('coachTimeLabel distinguishes just now, clock times and date-only values', () => {
  const now = new Date(2026, 9, 21, 7, 23, 30);
  assert.equal(coachTimeLabel(new Date(now.getTime() - 59999).toISOString(), now), 'いま');
  assert.equal(coachTimeLabel(new Date(now.getTime() - 60000).toISOString(), now), '今日 7:22');
  assert.equal(coachTimeLabel(now.toISOString(), now), 'いま');
  assert.equal(coachTimeLabel(new Date(2026, 9, 21, 7, 24).toISOString(), now), '今日 7:24');
  assert.equal(coachTimeLabel(new Date(2026, 9, 20, 21, 30).toISOString(), now), '昨日 21:30');
  assert.equal(coachTimeLabel(new Date(2026, 9, 19, 21, 30).toISOString(), now), '10月19日');
  assert.equal(coachTimeLabel('2026-10-21', now), '今日');
  assert.equal(coachTimeLabel('2026-10-20', now), '昨日');
  assert.equal(coachTimeLabel('2026-10-19', now), '10月19日');
  assert.equal(coachTimeLabel('2026-10-21', new Date(2026, 9, 21, 0, 0, 30)), '今日');
});

test('coachTimeLabel uses local calendar days across midnight and year boundaries', () => {
  const now = new Date(2027, 0, 1, 0, 0, 30);
  assert.equal(coachTimeLabel(new Date(2026, 11, 31, 23, 59, 45).toISOString(), now), 'いま');
  assert.equal(coachTimeLabel(new Date(2026, 11, 31, 21, 30).toISOString(), now), '昨日 21:30');
  assert.equal(coachTimeLabel('2026-12-31', now), '昨日');
  assert.equal(coachTimeLabel('2026-12-30', now), '12月30日');
});

test('coachWaitingNote attaches to the latest own entry and requires a strictly newer coach post', () => {
  const now = new Date(2026, 9, 21, 12);
  const d = data({
    messages: [
      { id: 'old', at: '2026-10-19T12:00:00Z', text: '前の相談' },
      { id: 'latest', at: '2026-10-21T09:00:00Z', text: '新しい相談' }
    ],
    sessions: [ses('2026-10-20', [], { toCoach: true, note: 'メモ' })]
  });
  const sameTime = { id: 'post', at: '2026-10-21T09:00:00Z', kind: 'reply', text: '返信' };
  const timeline = coachTimeline(d, [sameTime]);
  const before = structuredClone(timeline);
  assert.deepEqual(coachWaitingNote(timeline, now), {
    id: 'latest', text: '返事は明日の朝 7:22 ごろ届きます'
  });
  assert.deepEqual(timeline, before);
  for (const kind of ['reply', 'weekly', 'finding', 'reading']) {
    assert.equal(coachWaitingNote(coachTimeline(d, [
      { ...sameTime, kind, at: '2026-10-21T18:00:01+09:00' }
    ]), now), null);
  }
  assert.equal(coachWaitingNote([], now), null);
  assert.equal(coachWaitingNote(coachTimeline(data(), [sameTime]), now), null);
});

test('coachWaitingNote uses the next 7:22 run regardless of when the own item was written', () => {
  for (const at of [
    new Date(2026, 9, 21, 6).toISOString(),
    new Date(2026, 9, 20, 23).toISOString(),
    new Date(2026, 9, 19, 12).toISOString()
  ]) {
    const timeline = coachTimeline(data({ messages: [{ id: 'm', at, text: '相談' }] }), []);
    for (const now of [new Date(2026, 9, 21, 6), new Date(2026, 9, 21, 7, 21, 59)]) {
      assert.deepEqual(coachWaitingNote(timeline, now), {
        id: 'm', text: '返事は今日の朝 7:22 ごろ届きます'
      });
    }
    for (const now of [new Date(2026, 9, 21, 7, 22), new Date(2026, 9, 21, 12)]) {
      assert.deepEqual(coachWaitingNote(timeline, now), {
        id: 'm', text: '返事は明日の朝 7:22 ごろ届きます'
      });
    }
    assert.deepEqual(coachWaitingNote(timeline, new Date(2026, 9, 22, 6)), {
      id: 'm', text: '返事は今日の朝 7:22 ごろ届きます'
    });
  }
  const memo = coachTimeline(data({ sessions: [
    ses('2026-10-20', [], { toCoach: true, note: '昨日のメモ' })
  ] }), []);
  assert.deepEqual(coachWaitingNote(memo, new Date(2026, 9, 21, 6)), {
    id: 's2026-10-20', text: '返事は今日の朝 7:22 ごろ届きます'
  });
  assert.deepEqual(coachWaitingNote(memo, new Date(2026, 9, 21, 7, 22)), {
    id: 's2026-10-20', text: '返事は明日の朝 7:22 ごろ届きます'
  });
});

test('parseImport accepts old data and normalizes only present non-array messages', () => {
  const old = data();
  const imported = parseImport(JSON.stringify(old));
  assert.deepEqual(imported, old);
  assert.deepEqual(coachTimeline(imported, []), []);
  for (const messages of [null, {}, '', 1, false]) {
    assert.deepEqual(parseImport(JSON.stringify(data({ messages }))).messages, []);
  }
  const messages = [{ id: 'm', at: '2026-10-21T12:00:00Z', text: '相談' }];
  assert.deepEqual(parseImport(JSON.stringify(data({ messages }))).messages, messages);
  assert.deepEqual(parseImport(JSON.stringify(data({ messages: [] }))).messages, []);
});

test('recordDelta returns null without an earlier entry at the latest load', () => {
  assert.equal(recordDelta([]), null);
  assert.equal(recordDelta([{ load: 5, value: 12 }]), null);
  assert.equal(recordDelta([
    { load: 5, value: 12 }, { load: 6, value: 8 }
  ]), null);
});

test('recordDelta compares the latest value with the nearest previous same-load value', () => {
  const entries = [
    { load: 5, value: 20 },
    { load: 5, value: 10 },
    { load: 6, value: 30 },
    { load: 5, value: 12 }
  ];
  const before = structuredClone(entries);
  assert.equal(recordDelta(entries), 2);
  assert.deepEqual(entries, before);
  assert.equal(recordDelta([
    { load: 0, value: 30 }, { load: 0, value: 25 }
  ]), -5);
  assert.equal(recordDelta([
    { load: 5, value: 0 }, { load: 5, value: 0 }
  ]), 0);
});

test('loadUpPoints labels decimal weight increases from the preceding recorded day only', () => {
  const d = data({ exercises: [ex({ type: 'weight' })], sessions: [
    ses('2026-10-06', [set({ kg: 6.5, reps: 8 })]),
    ses('2026-10-02', [set({ kg: 5.5, reps: 10 })]),
    ses('2026-10-01', [set({ kg: 5, reps: 12 }), set({ kg: 20, reps: 5 })]),
    ses('2026-10-05', [set({ kg: 5.5, reps: 9 })], { light: true }),
    ses('2026-10-03', [set({ kg: 5.5, reps: 11 })]),
    ses('2026-10-04', [set({ kg: 5, reps: 12 })])
  ] });
  const before = structuredClone(d);
  assert.deepEqual(loadUpPoints(d, 'e1'), [
    { date: '2026-10-02', label: '+0.5kg' },
    { date: '2026-10-05', label: '+0.5kg' },
    { date: '2026-10-06', label: '+1kg' }
  ]);
  assert.deepEqual(d, before);
  assert.deepEqual(loadUpPoints(data({ exercises: [ex({ type: 'weight' })], sessions: [
    ses('2026-10-01', [set({ kg: 0.1, reps: 10 })]),
    ses('2026-10-02', [set({ kg: 0.3, reps: 10 })])
  ] }), 'e1'), [{ date: '2026-10-02', label: '+0.2kg' }]);
});

test('loadUpPoints uses the increased band name and omits unchanged or decreased loads', () => {
  const d = data({ exercises: [ex({ type: 'band' })], bands: [...bands].reverse(), sessions: [
    ses('2026-10-01', [set({ bandId: 'y', reps: 12 })]),
    ses('2026-10-02', [set({ bandId: 'k', reps: 8 })]),
    ses('2026-10-03', [set({ bandId: 'k', reps: 9 })]),
    ses('2026-10-04', [set({ bandId: 'y', reps: 15 })]),
    ses('2026-10-05', [set({ bandId: 'r', reps: 10 })])
  ] });
  assert.deepEqual(loadUpPoints(d, 'e1'), [
    { date: '2026-10-02', label: '黒' },
    { date: '2026-10-05', label: '赤' }
  ]);
});

test('loadUpPoints returns no markers for empty, single-day, reps or time history', () => {
  assert.deepEqual(loadUpPoints(data(), 'e1'), []);
  for (const type of ['weight', 'band', 'reps', 'time']) {
    const d = data({ exercises: [ex({ type })], bands, sessions: [
      ses('2026-10-01', [set({ kg: 5, bandId: 'y', reps: 10, sec: 30 })])
    ] });
    assert.deepEqual(loadUpPoints(d, 'e1'), []);
    if (type === 'reps' || type === 'time') {
      d.sessions.push(ses('2026-10-02', [
        set({ kg: 10, bandId: 'k', reps: 15, sec: 40 })
      ]));
      assert.deepEqual(loadUpPoints(d, 'e1'), []);
    }
  }
});

test('monthCalendar offsets the first day from Monday through Sunday', () => {
  for (const [date, offset] of [
    ['2026-06-15', 0], ['2026-09-15', 1], ['2026-04-15', 2],
    ['2026-10-15', 3], ['2026-05-15', 4], ['2026-08-15', 5],
    ['2026-02-15', 6]
  ]) {
    const result = monthCalendar(data(), date);
    assert.equal(result.offset, offset, date);
    assert.equal(result.year, 2026);
    assert.equal(result.month, Number(date.slice(5, 7)));
    assert.equal(result.done, 0);
    assert.equal(result.rest, 0);
  }
});

test('monthCalendar counts distinct set days before rest and excludes other months and empty sessions', () => {
  const d = data({ sessions: [
    ses('2026-10-01', [set({ reps: 10 })], { light: true }),
    ses('2026-10-01', [set({ reps: 8 })], { id: 'second' }),
    ses('2026-10-31', [set({ reps: 12 })]),
    ses('2026-10-02', []),
    ses('2026-10-03', []),
    ses('2026-09-30', [set({ reps: 10 })]),
    ses('2026-11-01', [set({ reps: 10 })])
  ], skips: [
    { date: '2026-10-01', reason: '疲れ' },
    { date: '2026-10-02', reason: '予定' },
    { date: '2026-10-02', reason: '疲れ' },
    { date: '2026-09-30', reason: '予定' },
    { date: '2026-11-01', reason: '予定' }
  ], body: [{ date: '2026-10-04', kg: 60, waist: null }] });
  const before = structuredClone(d);
  const result = monthCalendar(d, '2026-10-26');
  assert.equal(result.done, 2);
  assert.equal(result.rest, 1);
  assert.deepEqual(result.days.filter(day => day.mark), [
    { date: '2026-10-01', mark: 'd' },
    { date: '2026-10-02', mark: 'r' },
    { date: '2026-10-31', mark: 'd' }
  ]);
  assert.deepEqual(d, before);
});

test('monthCalendar includes today through the last day of 31, 30 and 28-day months and leap February', () => {
  for (const [date, length] of [
    ['2026-10-31', 31], ['2026-04-30', 30],
    ['2026-02-28', 28], ['2028-02-29', 29]
  ]) {
    const d = data({ sessions: [ses(date, [set({ reps: 10 })])] });
    const result = monthCalendar(d, date);
    assert.equal(result.days.length, length, date);
    assert.equal(result.year, Number(date.slice(0, 4)));
    assert.equal(result.month, Number(date.slice(5, 7)));
    assert.deepEqual(result.days.map(day => day.date),
      Array.from({ length }, (_, i) =>
        date.slice(0, 8) + String(i + 1).padStart(2, '0')));
    assert.deepEqual(result.days.at(-1), { date, mark: 'd' });
    assert.equal(result.days.filter(day => day.date === date).length, 1);
    assert.equal(result.done, 1);
    assert.equal(result.rest, 0);
  }
});

test('band order is an immutable strength: removing or moving bands never renumbers', () => {
  const band = ex({ type: 'band' });
  const d = data({
    exercises: [band], bands,
    sessions: [ses('2026-10-19', [set({ bandId: 'k', reps: 10 })])]
  });
  const loadBefore = load(d, band, d.sessions[0].sets[0]);
  const removed = removeBand(d.bands, 'y');
  assert.deepEqual(removed.map(b => [b.id, b.order]), [['r', 2], ['k', 3]]);
  const moved = moveBand(removed, 0, 1);
  assert.deepEqual(moved.map(b => [b.id, b.order]), [['k', 3], ['r', 2]]);
  assert.equal(load({ ...d, bands: moved }, band, d.sessions[0].sets[0]), loadBefore);
  assert.deepEqual(d.bands, bands);
  assert.equal(moveBand(bands, 0, -1), bands);
  assert.equal(moveBand(bands, 2, 1), bands);
});

test('menuExercises drops archived exercises from template and custom menus, but reproduces same menus as recorded', () => {
  const d = data({
    exercises: [ex(), ex({ id: 'e2', archived: true })],
    templates: [{ id: 't1', name: 'a', exerciseIds: ['e2', 'e1'], sets: 3 }],
    sessions: [ses('2026-10-19', [set({ exerciseId: 'e2', reps: 10 }), set({ reps: 10 })])]
  });
  assert.deepEqual(menuExercises(d, { kind: 'template', templateId: 't1' }, today), ['e1']);
  assert.deepEqual(menuExercises(d, { kind: 'custom', exerciseIds: ['e2', 'e1'] }, today), ['e1']);
  // same は前回記録の再現が仕様（リポジトリの確立仕様）。archived の除外は表示・開始側の activeMenuExercises が担う
  assert.deepEqual(menuExercises(d, { kind: 'same' }, today), ['e2', 'e1']);
});

test('parseImport normalizes elements so every screen can render', () => {
  const broken = data({
    exercises: [ex(), ex({ id: 'e2', type: 'mystery', part: 'x', archived: 'yes', nextId: 3 }),
      { id: 5 }, null, ex({ id: 'e1', name: 'dup' })],
    bands: [...bands, { id: 'bad' }, { id: 'n', name: 'n', order: 9, note: 1 }],
    templates: [{ id: 't', name: 't', exerciseIds: ['e1', 'zz'], sets: 'x' }, { name: 'no id' }],
    sessions: [
      { id: 'a', date: '2026-10-01', sets: [set({ reps: 5 }), set({ exerciseId: 'zz', reps: 5 }),
        set({ reps: 'x' }), null] },
      { id: 'b', date: 'oops', sets: [] },
      { id: 'c', date: '2026-10-02', light: false, note: '', sets: 'none' }
    ],
    skips: [{ date: '2026-10-03', reason: '??' }, { reason: '風邪' }],
    body: [{ date: '2026-10-03', kg: 60 }, { date: '2026-10-04', kg: 'x', waist: null }],
    settings: { restSec: 'x' },
    messages: [{ id: 'm', at: 'x', text: 'y' }, { id: 1 }]
  });
  const result = parseImport(JSON.stringify(broken));
  assert.deepEqual(result.exercises.map(e => [e.id, e.type, e.part, e.nextId, e.archived]),
    [['e1', 'reps', '胸', null, false], ['e2', 'reps', '全身', null, false]]);
  assert.deepEqual(result.bands.map(b => [b.id, b.note]), [['y', ''], ['r', ''], ['k', ''], ['n', '']]);
  assert.deepEqual(result.templates.map(t => [t.id, t.exerciseIds, t.sets]), [['t', ['e1'], 3]]);
  assert.deepEqual(result.sessions.map(s => [s.id, s.light, s.sets.length]), [['a', false, 1], ['c', false, 0]]);
  assert.deepEqual(result.skips, [{ date: '2026-10-03', reason: 'その他' }]);
  assert.deepEqual(result.body, [{ date: '2026-10-03', kg: 60, waist: null }]);
  assert.equal(result.settings.restSec, 90);
  assert.deepEqual(result.messages.map(m => m.id), ['m']);
});

test('carryLoad copies the changed load to later sets only', () => {
  const sets = [set({ kg: 5, bandId: 'y' }), set({ kg: 5, bandId: 'y' }), set({ kg: 5, bandId: 'y' })];
  sets[1].kg = 7;
  sets[1].bandId = 'r';
  carryLoad(ex({ type: 'weight' }), sets, 1);
  assert.deepEqual(sets.map(s => s.kg), [5, 7, 7]);
  assert.deepEqual(sets.map(s => s.bandId), ['y', 'r', 'y']);
  carryLoad(ex({ type: 'band' }), sets, 1);
  assert.deepEqual(sets.map(s => s.bandId), ['y', 'r', 'r']);
  carryLoad(ex(), sets, 0);
  assert.deepEqual(sets.map(s => s.kg), [5, 7, 7]);
});

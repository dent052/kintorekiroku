import test from 'node:test';
import assert from 'node:assert/strict';
import {
  localDate, value, load, recent, top, firstSet, history, line, lineResult, lineText, prefill, rows,
  prKind, isStageUp, sessionEvents, totals,
  weekStart, weekStats, calendar, totalDays, feed, mergeFeed, bodyAvg7, consultText,
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

test('prefill upgrades every set from the first-set load and otherwise keeps values', () => {
  for (const type of ['band', 'weight']) {
    const d = withHistory([20], ex({ type }), { bandId: type === 'band' ? 'r' : null, kg: type === 'weight' ? 5 : null });
    d.sessions[0].sets.push(set({ reps: 8, bandId: type === 'band' ? 'y' : null, kg: type === 'weight' ? 10 : null }));
    const before = structuredClone(d);
    const result = prefill(d, 'e1', today);
    assert.deepEqual(result.map(s => type === 'band' ? s.bandId : s.kg),
      type === 'band' ? ['k', 'k'] : [6, 6]);
    assert.deepEqual(result.map(s => s.reps), [20, 8]);
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

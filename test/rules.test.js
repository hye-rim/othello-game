'use strict';

// 오셀로 규칙·컴퓨터 시험 (Node 18 이상, 별도 설치 없이 node:test)
const test = require('node:test');
const assert = require('node:assert');
const R = require('../public/rules.js');
const { N, EMPTY, BLACK, WHITE } = R;

const rc = (r, c) => r * N + c;
function board(rows) {                      // 'B' 흑, 'W' 백, '.' 빈칸 8줄
  const b = new Int8Array(64);
  rows.forEach((row, r) => [...row].forEach((ch, c) => { b[rc(r, c)] = ch === 'B' ? BLACK : ch === 'W' ? WHITE : EMPTY; }));
  return b;
}
// 시드 있는 난수 (시험이 매번 같게)
function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

test('initial board has four center discs and black has four legal moves', () => {
  const b = R.newBoard();
  assert.deepStrictEqual(R.count(b), { black: 2, white: 2, empty: 60 });
  assert.strictEqual(b[rc(3, 3)], WHITE); assert.strictEqual(b[rc(4, 4)], WHITE);
  assert.strictEqual(b[rc(3, 4)], BLACK); assert.strictEqual(b[rc(4, 3)], BLACK);
  assert.deepStrictEqual(R.legalMoves(b, BLACK).map((m) => m.i).sort((a, c) => a - c), [rc(2, 3), rc(3, 2), rc(4, 5), rc(5, 4)]);
  assert.deepStrictEqual(R.legalMoves(b, WHITE).map((m) => m.i).sort((a, c) => a - c), [rc(2, 4), rc(3, 5), rc(4, 2), rc(5, 3)]);
});

test('flipping works in one direction and in all eight at once', () => {
  const b = R.newBoard();
  assert.deepStrictEqual(R.play(b, rc(2, 3), BLACK), [rc(3, 3)]);                 // 흑이 위에서 아래로 백 하나를 뒤집음
  assert.strictEqual(b[rc(3, 3)], BLACK); assert.strictEqual(b[rc(2, 3)], BLACK);
  assert.deepStrictEqual(R.count(b), { black: 4, white: 1, empty: 59 });
  // 가로·세로·대각선이 한꺼번에: 가운데 흑 돌 하나를 두고 사방에 백-흑 짝
  const m = board(['........', '.B.B.B..', '..WWW...', '.BW.WB..', '..WWW...', '.B.B.B..', '........', '........']);
  const flips = R.flipsAt(m, rc(3, 3), BLACK).sort((a, c) => a - c);
  assert.deepStrictEqual(flips, [rc(2, 2), rc(2, 3), rc(2, 4), rc(3, 2), rc(3, 4), rc(4, 2), rc(4, 3), rc(4, 4)].sort((a, c) => a - c), '8방향 모두 뒤집힘');
});

test('illegal squares: occupied, nothing to flip, broken lines', () => {
  const b = R.newBoard();
  assert.strictEqual(R.play(b, rc(3, 3), BLACK), null);                           // 찬 칸
  assert.strictEqual(R.play(b, rc(0, 0), BLACK), null);                           // 뒤집을 돌 없음
  const m = board(['WWW.....', '........', '........', '........', '........', '........', '........', '........']);
  assert.deepStrictEqual(R.flipsAt(m, rc(0, 3), BLACK), [], '끝에 내 돌이 없으면 안 뒤집힘');
  const m2 = board(['WW.B....', '........', '........', '........', '........', '........', '........', '........']);
  assert.deepStrictEqual(R.flipsAt(m2, rc(0, 2), BLACK), [], '사이에 빈칸이 끼면 안 뒤집힘 (오른쪽만 내 돌)');
  const m3 = board(['BWWW....', '........', '........', '........', '........', '........', '........', '........']);
  assert.deepStrictEqual(R.flipsAt(m3, rc(0, 4), BLACK).sort(), [1, 2, 3], '한 줄 전부 뒤집힘');
});

test('lines that run off the board edge do not flip', () => {
  const m = board(['.WWWWWWW', '........', '........', '........', '........', '........', '........', '........']);
  assert.deepStrictEqual(R.flipsAt(m, rc(0, 0), BLACK), []);                       // 오른쪽 끝에 내 돌이 없음
  const m2 = board(['WWWWWWW.', '........', '........', '........', '........', '........', '........', '........']);
  assert.deepStrictEqual(R.flipsAt(m2, rc(0, 7), BLACK), []);                      // 왼쪽 끝도 마찬가지 (줄이 끝나도 감겨 오지 않음)
});

test('pass when stuck, game over when both are stuck', () => {
  // 흑이 방금 둔 뒤 백이 둘 곳이 없고 흑은 둘 곳이 있는 판
  // 아래 줄 왼쪽 끝이 흑이라, 흑이 (7,7) 에 두면 백 줄을 뒤집을 수 있다. 백은 (7,7) 에 둬도 끼울 흑 돌이 없다
  const p1 = board(['BBBBBBBB', 'BBBBBBBB', 'BBBBBBBB', 'BBBBBBBB', 'BBBBBBBB', 'BBBBBBBB', 'BBBBBBBB', 'BWWWWWW.']);
  assert.strictEqual(R.hasMove(p1, WHITE), false);
  assert.strictEqual(R.hasMove(p1, BLACK), true);
  assert.deepStrictEqual(R.nextTurn(p1, BLACK), { turn: BLACK, passed: true, over: false }, '백이 못 두니 흑이 한 번 더');
  const dead = board(['BBBBBBBB', 'BBBBBBBB', 'BBBBBBBB', 'BBBBBBBB', 'BBBBBBBB', 'BBBBBBBB', 'BBBBBBBB', 'BBBBBBBW']);
  assert.strictEqual(R.nextTurn(dead, BLACK).over, true, '양쪽 다 못 두면 끝');
  assert.strictEqual(R.winnerOf(dead), BLACK);
  assert.strictEqual(R.winnerOf(R.newBoard()), EMPTY, '같으면 무승부');
});

test('random playouts keep disc counts consistent and end properly', () => {
  for (let s = 1; s <= 200; s++) {
    const rand = seeded(s * 7919), b = R.newBoard();
    let turn = BLACK, moves = 0, passes = 0;
    for (let guard = 0; guard < 200; guard++) {
      const lm = R.legalMoves(b, turn);
      assert.ok(lm.length > 0, '차례인 쪽은 둘 곳이 있어야 함');
      const m = lm[Math.floor(rand() * lm.length)];
      const flips = R.play(b, m.i, turn);
      assert.deepStrictEqual(flips.slice().sort(), m.flips.slice().sort());
      moves++;
      const c = R.count(b);
      assert.strictEqual(c.black + c.white, 4 + moves, '돌은 한 수에 하나씩 늘어난다');
      const nt = R.nextTurn(b, turn);
      if (nt.over) break;
      if (nt.passed) passes++;
      turn = nt.turn;
    }
    const c = R.count(b);
    assert.ok(c.empty === 0 || (!R.hasMove(b, BLACK) && !R.hasMove(b, WHITE)), '끝났으면 아무도 못 둔다');
    assert.ok(moves <= 60);
  }
});

test('computer always plays a legal move and returns -1 when stuck', () => {
  for (const level of ['easy', 'normal', 'hard']) {
    const rand = seeded(11);
    for (let g = 0; g < (level === 'hard' ? 2 : level === 'normal' ? 5 : 10); g++) {
      const b = R.newBoard(); let turn = BLACK;
      for (let k = 0; k < 120; k++) {
        const i = R.aiMove(b, turn, level, { rand, ms: 60, exactAt: 6 });
        if (i === -1) { assert.ok(!R.hasMove(b, turn)); const nt = R.nextTurn(b, R.other(turn)); if (nt.over) break; turn = R.other(turn); continue; }
        assert.ok(R.play(b, i, turn), `${level}: 합법적인 수`);
        const nt = R.nextTurn(b, turn); if (nt.over) break; turn = nt.turn;
      }
    }
  }
  assert.strictEqual(R.aiMove(board(['BBBBBBBB', 'BBBBBBBB', 'BBBBBBBB', 'BBBBBBBB', 'BBBBBBBB', 'BBBBBBBB', 'BBBBBBBB', 'BBBBBBBW']), WHITE, 'hard'), -1);
});

test('difficulty levels are really different: hard > normal > easy', () => {
  // 한 쪽이 이기면 1점, 무승부는 0.5점. 색을 바꿔 가며 여러 판
  const match = (a, b, games, opts) => {
    let score = 0;
    for (let g = 0; g < games; g++) {
      const rand = seeded(1000 + g), bd = R.newBoard(); let turn = BLACK;
      const aColor = g % 2 ? WHITE : BLACK;
      for (let k = 0; k < 120; k++) {
        const lvl = turn === aColor ? a : b;
        const i = R.aiMove(bd, turn, lvl, { rand, ms: opts.ms, exactAt: opts.exactAt });
        if (i >= 0) R.play(bd, i, turn);
        const nt = R.nextTurn(bd, turn); if (nt.over) break; turn = nt.turn;
      }
      const c = R.count(bd), w = c.black === c.white ? EMPTY : c.black > c.white ? BLACK : WHITE;
      score += w === EMPTY ? 0.5 : w === aColor ? 1 : 0;
    }
    return score / games;
  };
  const nvE = match('normal', 'easy', 12, { ms: 50, exactAt: 6 });
  const hvN = match('hard', 'normal', 4, { ms: 80, exactAt: 8 });
  assert.ok(nvE >= 0.7, `보통이 쉬움을 이김: ${nvE}`);
  assert.ok(hvN >= 0.5, `어려움이 보통을 이김: ${hvN}`);
});

test('hard level respects its time budget', () => {
  const b = R.newBoard(); R.play(b, rc(2, 3), BLACK);
  const t0 = Date.now(); const i = R.aiMove(b, WHITE, 'hard', { ms: 400 }); const dt = Date.now() - t0;
  assert.ok(R.legalMoves(b, WHITE).some((m) => m.i === i));
  assert.ok(dt < 1500, `시간 제한 준수: ${dt}ms`);
});

test('hard level still searches when the exact endgame search runs out of time', () => {
  // 빈칸이 많은 판에서 '끝까지 읽기'를 억지로 켜고 시간을 아주 짧게 주면 반드시 시간이 모자란다
  const b = R.newBoard(); let p = BLACK;
  const rand = (() => { let s = 7; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })();
  for (let k = 0; k < 12; k++) { const lm = R.legalMoves(b, p); if (!lm.length) break; R.play(b, lm[Math.floor(rand() * lm.length)].i, p); p = R.other(p); }
  const info = {};
  const i = R.aiMove(b, p, 'hard', { ms: 60, exactAt: 64, info });
  assert.ok(info.exactTimedOut, 'the exact search timed out');
  assert.ok(info.depth >= 2, `fell back to a real search (depth ${info.depth}), not just the square table`);
  assert.ok(R.legalMoves(b, p).some((m) => m.i === i));
  // 끝까지 읽기가 제시간에 끝나면 그 결과를 쓴다
  const end = board(['BBBBBBBB', 'BWWWWWWB', 'BWBBBBWB', 'BWBWWBWB', 'BWBWWBWB', 'BWBBBB.B', 'BWWWWW..', 'BBBBBB..']);
  const info2 = {};
  const j = R.aiMove(end, WHITE, 'hard', { ms: 300, info: info2 });
  assert.ok(!info2.exactTimedOut && info2.depth === R.count(end).empty);
  assert.ok(R.legalMoves(end, WHITE).some((m) => m.i === j));
});

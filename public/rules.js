'use strict';

// 오셀로: 판 규칙과 컴퓨터 상대. 브라우저와 서버(Node)가 같은 코드를 쓴다 (document 가 없으면 module.exports 로 내보낸다).
//
// - 8×8 판, 칸 번호 = 행 × 8 + 열. 처음엔 가운데에 흑·백 두 개씩 엇갈려 놓인다. 흑이 먼저 둔다
// - 내 돌을 놓아서 상대 돌이 내 돌 사이에 끼면(가로·세로·대각선) 그 돌을 모두 뒤집는다. 뒤집을 돌이 없는 자리에는 못 둔다
// - 둘 곳이 없으면 자동으로 차례가 넘어간다(패스). 둘 다 둘 곳이 없으면 끝, 돌이 더 많은 쪽이 승리
const N = 8, EMPTY = 0, BLACK = 1, WHITE = 2;
const other = (p) => 3 - p;
const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

function newBoard() {
  const b = new Int8Array(N * N);
  b[3 * N + 3] = WHITE; b[4 * N + 4] = WHITE;
  b[3 * N + 4] = BLACK; b[4 * N + 3] = BLACK;
  return b;
}

// i 에 p 의 돌을 놓았을 때 뒤집히는 돌들 (빈칸이 아니거나 하나도 못 뒤집으면 빈 배열)
function flipsAt(b, i, p) {
  if (b[i] !== EMPTY) return [];
  const r0 = (i / N) | 0, c0 = i % N, out = [];
  const o = other(p);
  for (const [dr, dc] of DIRS) {
    let r = r0 + dr, c = c0 + dc, run = [];
    while (r >= 0 && r < N && c >= 0 && c < N && b[r * N + c] === o) { run.push(r * N + c); r += dr; c += dc; }
    if (run.length && r >= 0 && r < N && c >= 0 && c < N && b[r * N + c] === p) out.push(...run);
  }
  return out;
}

// p 가 둘 수 있는 자리와 그때 뒤집히는 돌
function legalMoves(b, p) {
  const out = [];
  for (let i = 0; i < N * N; i++) {
    if (b[i] !== EMPTY) continue;
    const flips = flipsAt(b, i, p);
    if (flips.length) out.push({ i, flips });
  }
  return out;
}
function hasMove(b, p) {
  for (let i = 0; i < N * N; i++) if (b[i] === EMPTY && flipsAt(b, i, p).length) return true;
  return false;
}

// 실제로 둔다. 뒤집은 돌 목록을 돌려준다 (둘 수 없는 자리면 null)
function play(b, i, p) {
  const flips = flipsAt(b, i, p);
  if (!flips.length) return null;
  b[i] = p;
  for (const f of flips) b[f] = p;
  return flips;
}

function count(b) {
  let black = 0, white = 0;
  for (let i = 0; i < b.length; i++) { if (b[i] === BLACK) black++; else if (b[i] === WHITE) white++; }
  return { black, white, empty: N * N - black - white };
}

// 방금 just 가 둔 뒤 누구 차례인가. { turn, passed(상대가 둘 곳이 없어 넘어감), over }
function nextTurn(b, just) {
  const o = other(just);
  if (hasMove(b, o)) return { turn: o, passed: false, over: false };
  if (hasMove(b, just)) return { turn: just, passed: true, over: false };
  return { turn: o, passed: false, over: true };
}
function winnerOf(b) {
  const { black, white } = count(b);
  return black > white ? BLACK : white > black ? WHITE : EMPTY;
}

// ---------- 컴퓨터 ----------
// 자리 점수: 모서리는 지킬 수 있어서 크고, 모서리 바로 옆(특히 대각선)은 모서리를 내주기 쉬워서 나쁘다
const POS = [
  100, -20, 10, 5, 5, 10, -20, 100,
  -20, -50, -2, -2, -2, -2, -50, -20,
  10, -2, 1, 0, 0, 1, -2, 10,
  5, -2, 0, 0, 0, 0, -2, 5,
  5, -2, 0, 0, 0, 0, -2, 5,
  10, -2, 1, 0, 0, 1, -2, 10,
  -20, -50, -2, -2, -2, -2, -50, -20,
  100, -20, 10, 5, 5, 10, -20, 100,
];
const CORNERS = [0, 7, 56, 63];
// 모서리를 내 것으로 잡았으면 그 옆 칸의 감점은 없앤다
const NEAR = { 0: [1, 8, 9], 7: [6, 14, 15], 56: [48, 49, 57], 63: [54, 55, 62] };

function evaluate(b, p) {
  const o = other(p);
  let pos = 0, mine = 0, theirs = 0;
  for (let i = 0; i < N * N; i++) {
    const v = b[i];
    if (v === EMPTY) continue;
    let w = POS[i];
    if (w < 0) for (const c of CORNERS) if (NEAR[c].includes(i) && b[c] === v) { w = 2; break; }
    if (v === p) { pos += w; mine++; } else { pos -= w; theirs++; }
  }
  const empty = N * N - mine - theirs;
  // 둘 수 있는 곳이 많은 쪽이 유리하다 (움직임의 자유)
  const mob = legalMoves(b, p).length - legalMoves(b, o).length;
  // 끝이 가까울수록 돌의 수 자체가 중요해진다
  const disc = (mine - theirs) * (empty < 16 ? (16 - empty) * 1.5 : 0);
  return pos + mob * 7 + disc;
}

// 보통 난이도: 얕게 읽고(깊이), 비슷한 수 중에서 무작위로 고르고(tol), 가끔은 아무 수나 둔다(slip)
const NORMAL = { depth: 1, tol: 30, slip: 0.25 };
// 어려움: 세 수 앞까지 읽고 끝까지 계산은 하지 않는다 (시험에서는 깊이·끝까지 읽기를 직접 정해 쓸 수 있다)
const HARD = { depth: 3, exactAt: 0 };

class Timeout extends Error {}

// 알파-베타 탐색. 점수는 p 의 입장. 끝까지 두는 경우(exact)에는 돌 수 차이만 본다
function search(b, p, depth, alpha, beta, ctx, exact) {
  if (ctx.deadline && (++ctx.nodes & 1023) === 0 && Date.now() > ctx.deadline) throw new Timeout();
  const moves = legalMoves(b, p);
  if (!moves.length) {
    if (!hasMove(b, other(p))) {                      // 둘 다 못 두면 끝: 돌 수 차이
      const c = count(b);
      return (p === BLACK ? c.black - c.white : c.white - c.black) * 1000;
    }
    return -search(b, other(p), depth, -beta, -alpha, ctx, exact);   // 패스
  }
  if (depth <= 0 && !exact) return evaluate(b, p);
  moves.sort((x, y) => POS[y.i] - POS[x.i]);          // 좋아 보이는 자리부터 봐야 가지를 많이 쳐낸다
  let best = -Infinity;
  for (const m of moves) {
    const nb = b.slice();
    nb[m.i] = p; for (const f of m.flips) nb[f] = p;
    const s = -search(nb, other(p), depth - 1, -beta, -alpha, ctx, exact);
    if (s > best) best = s;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

// 한 수를 고른다. level: easy(아무 데나, 가끔 많이 뒤집는 곳) · normal(한 수 앞 + 비슷한 수 중 무작위 + 가끔 실수) · hard(세 수 앞까지 읽기)
function aiMove(b, p, level = 'normal', opts = {}) {
  const moves = legalMoves(b, p);
  if (!moves.length) return -1;
  if (moves.length === 1) return moves[0].i;
  const rand = opts.rand || Math.random;
  if (level === 'easy') {
    if (rand() < 0.35) return moves.reduce((a, m) => (m.flips.length > a.flips.length ? m : a)).i;
    return moves[Math.floor(rand() * moves.length)].i;
  }
  const scoreAll = (depth, ctx, exact) => moves.map((m) => {
    const nb = b.slice();
    nb[m.i] = p; for (const f of m.flips) nb[f] = p;
    return { i: m.i, s: -search(nb, other(p), depth - 1, -Infinity, Infinity, ctx, exact) };
  });
  const empty = count(b).empty;
  if (level === 'normal') {
    const depth = opts.nDepth || NORMAL.depth, tol = opts.nTol ?? NORMAL.tol, slip = opts.nSlip ?? NORMAL.slip;
    const r = scoreAll(depth, { nodes: 0, deadline: 0 }, false).sort((x, y) => y.s - x.s);
    // 가끔(slip) 아무 수나 둔다: 사람처럼 놓치는 수
    if (rand() < slip) return moves[Math.floor(rand() * moves.length)].i;
    const top = r.filter((x) => x.s >= r[0].s - tol);             // 비슷한 점수면 무작위로: 매번 똑같이 두지 않게
    return top[Math.floor(rand() * top.length)].i;
  }
  // hard: 시간 안에서 점점 깊이 (iterative deepening). 끝이 가까우면 끝까지
  const budget = opts.ms || 900;
  const start = Date.now();
  let bestI = moves.slice().sort((x, y) => POS[y.i] - POS[x.i])[0].i;
  const maxDepth = opts.depth || HARD.depth;
  const solve = empty <= (opts.exactAt ?? HARD.exactAt);
  const info = opts.info || {};                              // 시험용: 어디까지 읽었는지 남긴다
  info.exactTimedOut = false; info.depth = 0;
  try {
    if (solve) {
      const ctx = { nodes: 0, deadline: start + Math.max(budget, 1600) };
      const r = scoreAll(empty, ctx, true).sort((x, y) => y.s - x.s);
      info.depth = empty;
      return r[0].i;
    }
  } catch (e) { if (!(e instanceof Timeout)) throw e; info.exactTimedOut = true; }
  // 끝까지 읽기가 시간 안에 안 끝났으면, 깊이 탐색은 그때부터 새로 시간을 받는다
  // (예전엔 마감이 이미 지나 깊이 2도 못 하고 자리 점수만으로 둬서 끝판에 크게 무너졌다)
  const t1 = Date.now();
  for (let d = 2; d <= maxDepth; d++) {
    const ctx = { nodes: 0, deadline: d === 2 ? 0 : t1 + budget };   // 깊이 2는 가벼우니 마감 없이 항상 끝낸다
    try {
      const r = scoreAll(d, ctx, false).sort((x, y) => y.s - x.s);
      bestI = r[0].i; info.depth = d;
    } catch (e) { if (e instanceof Timeout) break; throw e; }
    if (Date.now() - t1 > budget * 0.6) break;
  }
  return bestI;
}

const RULES = { N, EMPTY, BLACK, WHITE, other, newBoard, flipsAt, legalMoves, hasMove, play, count, nextTurn, winnerOf, evaluate, aiMove };
if (typeof document === 'undefined' && typeof module !== 'undefined') module.exports = RULES;
else if (typeof window !== 'undefined') window.OTHELLO = RULES;

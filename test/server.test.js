'use strict';

// 서버 시험: 보안·안정성 회귀 + 오셀로 대국 흐름
// 실행: npm test  (Node 18 이상, 별도 설치 없이 node:test)
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const { WebSocket } = require('ws');
const R = require('../public/rules.js');

const PORT = 5900 + Math.floor(Math.random() * 300);
const get = (p) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'GET' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  req.on('error', reject); req.end();
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), TURN_MS: '1500' }, stdio: 'ignore' });
child.unref();
process.on('exit', () => child.kill());
const ready = (async () => {
  for (let i = 0; i < 80; i++) { try { await get('/'); return; } catch { await sleep(100); } }
  throw new Error('server did not start');
})();

const open = () => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
  const c = { ws, msgs: [], room: null, queued: false, errors: [], closed: null };
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(d); } catch { return; }
    c.msgs.push(m);
    if (m.t === 'room') c.room = m;
    if (m.t === 'queued') c.queued = true;
    if (m.t === 'error') c.errors.push(m.msg);
  });
  ws.on('close', (code) => { c.closed = code; });
  ws.on('error', () => {});
  ws.on('open', () => resolve(c));
  setTimeout(() => reject(new Error('websocket connect failed')), 3000);
});
const send = (c, t, p = {}) => c.ws.send(JSON.stringify({ t, ...p }));
const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(15); } return false; };

// 두 손님을 빠른 대전으로 맺어 준다
async function pair() {
  const a = await open(), b = await open();
  send(a, 'hello', { name: '가' }); send(b, 'hello', { name: '나' });
  send(a, 'quick'); await until(() => a.queued);
  send(b, 'quick');
  assert.ok(await until(() => a.room && b.room && a.room.state === 'playing' && b.room.state === 'playing'), 'both players enter a playing room');
  return [a, b];
}
// 스냅샷으로 판을 다시 만든다 (서버가 보낸 수순을 처음부터 두어 본다)
function boardOf(room) {
  const b = R.newBoard();
  for (const [i, col] of room.moves) assert.ok(R.play(b, i, col), 'server move list replays legally');
  return b;
}
const mine = (a, b) => (a.room.turn === a.room.you ? a : b);

test('malformed URLs get 400 and the server stays up', async () => {
  await ready;
  assert.strictEqual(await get('/%'), 400);
  assert.strictEqual(await get('/%00'), 400);
  assert.strictEqual(await get('/%E0%A4%A'), 400);
  assert.strictEqual(await get('/'), 200);
  assert.strictEqual(await get('/rules.js'), 200);
});

test('dotfiles and paths outside the public dir are not served', async () => {
  await ready;
  assert.strictEqual(await get('/.git/config'), 403);
  assert.strictEqual(await get('/.hidden'), 403);
  assert.ok([403, 404].includes(await get('/../server.js')));
});

test('oversized websocket message closes the connection (1009)', async () => {
  await ready;
  const c = await open();
  c.ws.send('x'.repeat(2 * 1024 * 1024));
  await sleep(500);
  assert.strictEqual(c.closed, 1009);
  assert.strictEqual(await get('/'), 200);
});

test('quick match starts a game with the standard opening position', async () => {
  await ready;
  const [a, b] = await pair();
  assert.strictEqual(a.room.code, b.room.code);
  assert.notStrictEqual(a.room.you, b.room.you);
  assert.strictEqual(a.room.turn, R.BLACK);
  assert.strictEqual(a.room.moves.length, 0);
  assert.deepStrictEqual(R.count(boardOf(a.room)), { black: 2, white: 2, empty: 60 });
  a.ws.close(); b.ws.close();
});

test('illegal moves, out-of-turn moves and garbage are ignored', async () => {
  await ready;
  const [a, b] = await pair();
  const black = a.room.you === R.BLACK ? a : b, white = black === a ? b : a;
  send(white, 'place', { i: 19 });                                  // 백 차례가 아님
  send(black, 'place', { i: 0 });                                   // 뒤집을 돌이 없는 자리
  send(black, 'place', { i: 27 });                                  // 이미 돌이 있는 칸
  send(black, 'place', { i: -3 }); send(black, 'place', { i: 99 }); send(black, 'place', { i: 'x' }); send(black, 'place', {});
  await sleep(300);
  assert.strictEqual(black.room.moves.length, 0, 'nothing was accepted');
  const legal = R.legalMoves(R.newBoard(), R.BLACK)[0].i;
  send(black, 'place', { i: legal });
  assert.ok(await until(() => white.room.moves.length === 1), 'a legal move is accepted');
  assert.strictEqual(white.room.turn, R.WHITE);
  a.ws.close(); b.ws.close();
});

test('a full game between two clients ends with the correct winner', async () => {
  await ready;
  let passes = 0;
  for (let g = 0; g < 3; g++) {
    const [a, b] = await pair();
    for (let guard = 0; guard < 150 && !(a.room.state === 'over' && b.room.state === 'over'); guard++) {
      const mover = mine(a, b);
      const board = boardOf(mover.room);
      const lm = R.legalMoves(board, mover.room.you);
      assert.ok(lm.length > 0, 'the player whose turn it is always has a legal move');
      const before = mover.room.moves.length;
      send(mover, 'place', { i: lm[Math.floor(Math.random() * lm.length)].i });
      assert.ok(await until(() => a.room.moves.length > before && b.room.moves.length > before || (a.room.state === 'over' && b.room.state === 'over')), 'move propagates to both');
    }
    assert.strictEqual(a.room.state, 'over'); assert.strictEqual(b.room.state, 'over');
    const final = boardOf(a.room), c = R.count(final);
    assert.strictEqual(a.room.winner, R.winnerOf(final), 'winner matches the disc count');
    assert.strictEqual(a.room.reason, 'count');
    assert.ok(c.empty === 0 || (!R.hasMove(final, R.BLACK) && !R.hasMove(final, R.WHITE)));
    passes += a.room.passSeq;
    a.ws.close(); b.ws.close();
  }
  assert.ok(passes >= 0);
});

test('a pass is announced when the next player cannot move', async () => {
  await ready;
  // 패스가 나올 때까지 몇 판을 둔다 (무작위 대국에서는 흔하다)
  let seen = 0;
  for (let g = 0; g < 8 && !seen; g++) {
    const [a, b] = await pair();
    for (let guard = 0; guard < 150 && a.room.state === 'playing'; guard++) {
      const mover = mine(a, b), before = mover.room.moves.length, passBefore = mover.room.passSeq;
      const lm = R.legalMoves(boardOf(mover.room), mover.room.you);
      send(mover, 'place', { i: lm[Math.floor(Math.random() * lm.length)].i });
      await until(() => a.room.moves.length > before || a.room.state === 'over');
      if (a.room.passSeq > passBefore) {
        seen++;
        assert.strictEqual(a.room.turn, mover.room.you, 'the same player moves again after a pass');
        assert.strictEqual(a.room.passedBy, R.other(mover.room.you));
        break;
      }
    }
    a.ws.close(); b.ws.close();
  }
  assert.ok(seen >= 1, 'a pass happened and was reported');
});

test('resigning ends the game and rematch swaps colors', async () => {
  await ready;
  const [a, b] = await pair();
  const colorA = a.room.you;
  send(a, 'resign');
  assert.ok(await until(() => b.room.state === 'over'));
  assert.strictEqual(b.room.reason, 'resign');
  assert.strictEqual(b.room.winner, b.room.you);
  send(a, 'rematch'); send(b, 'rematch');
  assert.ok(await until(() => a.room.state === 'playing' && a.room.moves.length === 0));
  assert.notStrictEqual(a.room.you, colorA, 'colors swap on a rematch');
  assert.deepStrictEqual(R.count(boardOf(a.room)), { black: 2, white: 2, empty: 60 }, 'the board is reset');
  a.ws.close(); b.ws.close();
});

test('running out of time loses the game', async () => {
  await ready;
  const [a, b] = await pair();
  assert.ok(await until(() => a.room.state === 'over', 4000), 'the timer fires');
  assert.strictEqual(a.room.reason, 'timeout');
  assert.strictEqual(a.room.winner, R.WHITE, 'black was on move, so white wins');
  a.ws.close(); b.ws.close();
});

test('private rooms: create, join by code, and a third player is turned away', async () => {
  await ready;
  const a = await open(), b = await open(), c = await open();
  send(a, 'create');
  assert.ok(await until(() => a.room && a.room.code));
  assert.strictEqual(a.room.state, 'waiting');
  send(b, 'join', { code: a.room.code.toLowerCase() });
  assert.ok(await until(() => a.room.state === 'playing' && b.room && b.room.state === 'playing'));
  send(c, 'join', { code: a.room.code });
  assert.ok(await until(() => c.errors.length > 0));
  assert.match(c.errors[0], /이미 두 사람/);
  a.ws.close(); b.ws.close(); c.ws.close();
});

// 같은 주소에서 코드를 일부러 많이 틀리므로 이 시험은 맨 뒤에 둔다 (뒤의 시험이 막히지 않게)
test('repeated wrong room codes get temporarily blocked', async () => {
  await ready;
  const c = await open();
  for (let i = 0; i < 10; i++) c.ws.send(JSON.stringify({ t: 'join', code: 'ZZZ' + 'ABCDEFGH'[i] }));
  await sleep(500);
  assert.ok(c.errors.some((x) => /그런 방이 없어요/.test(x)), 'first attempts are answered with room-not-found');
  assert.ok(c.errors.some((x) => /너무 많이 틀렸어요/.test(x)), 'many wrong codes get blocked');
  c.ws.close();
});

test('shutdown', () => { child.kill(); });

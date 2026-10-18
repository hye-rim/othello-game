'use strict';

// 오셀로: 화면·입력·온라인. 판 규칙과 컴퓨터는 rules.js (OTHELLO).
(() => {
const R = OTHELLO;
const { N, EMPTY, BLACK, WHITE, other } = R;

// ---------- 모양 ----------
const CELL = 64, MARGIN = 22;
const SIZE = MARGIN * 2 + CELL * N;           // 556
const DISC_R = CELL * 0.43;
const INK = '#2b1d52';
const FONT = '"Jua", "Apple SD Gothic Neo", sans-serif';
const FLIP_MS = 420;
const LEVELS = { easy: { name: '쉬움' }, normal: { name: '보통' }, hard: { name: '어려움' } };

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

function fit() {
  const hudH = 112;   // 위 상태줄 + 흑 VS 백 + 판 테두리·그림자
  const scale = Math.min((innerWidth - 28) / SIZE, (innerHeight - 24 - hudH) / SIZE);
  const css = Math.floor(SIZE * scale);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = canvas.style.height = css + 'px';
  canvas.width = canvas.height = Math.round(css * dpr);
  ctx.setTransform(canvas.width / SIZE, 0, 0, canvas.height / SIZE, 0, 0);
  $('col').style.width = Math.min(innerWidth - 16, Math.max(css, 300)) + 'px';
  draw();
}
addEventListener('resize', fit);

// ---------- 저장소 ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
const RECORD_KEY = 'othelloRecord';   // 컴퓨터 상대 { easy: {w, l, d}, normal: …, hard: … }
const WINS_KEY = 'othelloWins';       // 컴퓨터 상대 총 승수 (로비 카드에 표시)
const ONLINE_KEY = 'othelloOnline';   // 온라인 { w, l, d }
function loadJson(k) { try { return JSON.parse(store.get(k)) || {}; } catch (_) { return {}; } }
const myName = () => store.get('othelloName') || '';
const SESSION_KEY = 'othelloSession';
function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (_) { return null; } }
function saveSession(s) { try { s ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)) : sessionStorage.removeItem(SESSION_KEY); } catch (_) {} }

// ---------- 소리 ----------
let audio = null;
let muted = store.get('othelloMuted') === '1';
function tone(freq, dur, type = 'sine', vol = 0.12, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (_) {}
}
const seq = (notes, step, type, vol) => notes.forEach((f, i) => setTimeout(() => tone(f, 0.18, type, vol), i * step));
const sfx = {
  place: (n) => { tone(240, 0.07, 'triangle', 0.2, -80); for (let i = 0; i < Math.min(n, 4); i++) setTimeout(() => tone(520 + i * 50, 0.05, 'sine', 0.06), 60 + i * 55); },
  nope: () => tone(190, 0.1, 'square', 0.05, -50),
  pass: () => seq([440, 330], 120, 'triangle', 0.08),
  undo: () => tone(500, 0.08, 'sine', 0.08, -200),
  tick: () => tone(880, 0.04, 'square', 0.04),
  found: () => seq([660, 880], 110, 'sine', 0.08),
  win: () => seq([523, 659, 784, 1047], 120, 'square', 0.06),
  lose: () => seq([392, 330, 262, 196], 180, 'triangle', 0.1),
};

// ---------- 게임 상태 ----------
// 두 모드가 판·차례를 같은 변수로 공유한다. 온라인은 서버가 보내준 값으로 덮어쓴다.
let mode = null;           // null(메뉴) | ai | online
let board = R.newBoard();
let turn = BLACK;
let over = false;
let lastMove = -1;         // 마지막으로 둔 칸
let hover = -1, cursor = -1;
let note = null;           // 캔버스 위에 잠깐 띄우는 안내 { text, until }
let anims = new Map();     // 칸 -> { from, to, start } 뒤집히는 중인 돌
let placedAt = new Map();  // 칸 -> 놓은 시각 (처음 놓일 때 커지는 효과)
let showHints = store.get('othelloHints') !== '0';

// 컴퓨터 대전
let level = store.get('othelloLevel') || 'normal';
let humanColor = Number(store.get('othelloColor')) || BLACK;
let thinking = false, aiTimer = null;
let history = [];          // 무르기용: 둔 사람이 두기 전의 { board, turn, last }

// 온라인
let room = null, screen = '', turnEnd = 0, netDown = false, resultSeen = '', recorded = '';
let passSeen = 0;

const myColor = () => (mode === 'ai' ? humanColor : room ? room.you : EMPTY);
function canPlay() {
  if (over || !mode) return false;
  if (mode === 'ai') return !thinking && turn === humanColor;
  return !!room && room.state === 'playing' && turn === room.you && !netDown;
}
const legalSet = () => new Set(R.legalMoves(board, turn).map((m) => m.i));

function resetBoard() {
  board = R.newBoard(); turn = BLACK; over = false; lastMove = -1; hover = cursor = -1;
  anims = new Map(); placedAt = new Map(); note = null; history = [];
}
function showNote(text, ms = 1600) { note = { text, until: performance.now() + ms }; scheduleDraw(); }

// ---------- 두기 (컴퓨터·온라인 공통의 화면 효과) ----------
function animateMove(i, color, flips) {
  const now = performance.now();
  placedAt.set(i, now);
  const r0 = (i / N) | 0, c0 = i % N;
  for (const f of flips) {
    const d = Math.max(Math.abs(((f / N) | 0) - r0), Math.abs((f % N) - c0));
    anims.set(f, { from: other(color), to: color, start: now + d * 70 });
  }
  lastMove = i;
  scheduleDraw();
}

// ---------- 컴퓨터 대전 ----------
function newAiGame() {
  leaveOnline();
  clearTimeout(aiTimer);
  mode = 'ai'; thinking = false;
  resetBoard();
  hideOverlay(); updateHud(); draw();
  maybeAi();
}

function placeAi(i) {
  if (over || board[i] !== EMPTY) return false;
  const mover = turn;
  const snap = { board: board.slice(), turn, last: lastMove };
  const flips = R.play(board, i, mover);
  if (!flips) return false;
  history.push(snap);
  animateMove(i, mover, flips);
  sfx.place(flips.length);
  advanceAi(mover);
  return true;
}
function advanceAi(mover) {
  const nt = R.nextTurn(board, mover);
  if (nt.over) { turn = nt.turn; finishAi(); }
  else {
    if (nt.passed) {
      const skipped = other(mover);
      showNote(skipped === humanColor ? '둘 곳이 없어 패스했어요' : '컴퓨터가 둘 곳이 없어 패스!', 2000);
      sfx.pass();
    }
    turn = nt.turn;
  }
  updateHud(); draw();
}

function finishAi() {
  over = true;
  const c = R.count(board), w = R.winnerOf(board);
  let title = '무승부';
  const rec = loadJson(RECORD_KEY);
  const r = rec[level] || { w: 0, l: 0, d: 0 };
  if (w === EMPTY) r.d = (r.d || 0) + 1;
  else if (w === humanColor) { r.w++; store.set(WINS_KEY, String((Number(store.get(WINS_KEY)) || 0) + 1)); title = '🎉 승리!'; sfx.win(); }
  else { r.l++; title = '😵 패배'; sfx.lose(); }
  rec[level] = r;
  store.set(RECORD_KEY, JSON.stringify(rec));
  const sub = `흑 ${c.black} : 백 ${c.white} · ${LEVELS[level].name} ${r.w}승 ${r.l}패${r.d ? ` ${r.d}무` : ''}`;
  setTimeout(() => {
    if (!over || mode !== 'ai') return;   // 그 사이 무르기
    showOverlay(`
      <h2>${title}</h2>
      <p>${sub}</p>
      <div class="row"><button class="main" data-act="aiStart">한 판 더</button></div>
      <div class="row">
        <button class="sub" data-act="close">판 보기</button>
        <button class="sub" data-act="undo">무르기</button>
        <button class="sub" data-act="home">메뉴</button>
      </div>`);
  }, 1100);
}

function maybeAi() {
  if (mode !== 'ai' || over || turn === humanColor) return;
  thinking = true;
  updateHud();
  const mover = turn;
  aiTimer = setTimeout(() => {
    const t0 = performance.now();
    const i = R.aiMove(board, mover, level, { ms: 900 });
    const wait = Math.max(0, 480 - (performance.now() - t0));
    aiTimer = setTimeout(() => {
      thinking = false;
      if (i >= 0) placeAi(i);
      updateHud();
      maybeAi();                           // 사람이 둘 곳이 없어 넘어갔으면 컴퓨터가 한 번 더 둔다
    }, wait);
  }, 30);
}

function undo() {
  if (mode !== 'ai' || !history.length) return;
  clearTimeout(aiTimer);
  thinking = false;
  // 내 차례로 돌아오도록, 내가 둔 마지막 수 이전으로 되돌린다
  let snap = null;
  while (history.length) { snap = history.pop(); if (snap.turn === humanColor) break; }
  if (!snap || snap.turn !== humanColor) { if (snap) history.push(snap); return; }
  board = snap.board; turn = snap.turn; lastMove = snap.last;
  over = false; anims = new Map(); placedAt = new Map(); note = null;
  hideOverlay(); sfx.undo(); updateHud(); draw(); maybeAi();   // 컴퓨터가 흑이라 첫 수까지 물렀으면 다시 둔다
}

// ---------- 온라인: 연결 ----------
const net = {
  ws: null, pulse: null, outbox: [], retry: 0,
  connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}${location.pathname}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.raw('hello', { name: myName() });
      const s = loadSession();
      if (s) this.raw('resume', s);
      for (const [t, p] of this.outbox.splice(0)) this.raw(t, p);
      clearInterval(this.pulse);
      // 프록시가 WebSocket ping 을 대신 받아버리는 환경이 있어 살아있다는 신호를 직접 보낸다
      this.pulse = setInterval(() => this.raw('pulse'), 10000);
    };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } onNet(m); };
    ws.onclose = () => {
      clearInterval(this.pulse);
      if (this.ws !== ws) return;   // 일부러 닫은 연결
      this.ws = null;
      if (mode !== 'online') return;
      if (room || loadSession()) {
        // 대국 중이면 계속 다시 붙어본다. 서버는 30초 동안 자리를 비워둔다.
        netDown = true; updateHud();
        setTimeout(() => { if (mode === 'online') this.connect(); }, Math.min(4000, 500 * 2 ** this.retry++));
      } else showOnline('서버와 연결이 끊겼어요. 다시 시도해 주세요.');
    };
  },
  send(t, p = {}) {
    if (this.ws && this.ws.readyState === 1) this.raw(t, p);
    else { this.outbox.push([t, p]); this.connect(); }
  },
  raw(t, p = {}) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t, ...p })); },
  close() {
    const ws = this.ws;
    this.ws = null; this.outbox = [];
    clearInterval(this.pulse);
    if (ws) ws.close();
  },
};

function onNet(m) {
  if (m.t === 'queued') { screen = 'queued'; showQueued(); }
  else if (m.t === 'room') applyRoom(m);
  else if (m.t === 'error') { room = null; saveSession(null); showOnline(m.msg); }
  else if (m.t === 'resumeFailed') {
    saveSession(null);
    if (room) { room = null; showOnline('대국이 끝나서 이어갈 수 없어요.'); }
    netDown = false; updateHud();
  }
}

function leaveOnline() {
  if (mode !== 'online') return;
  net.send('leave'); net.close();
  saveSession(null);
  room = null; netDown = false;
}

// ---------- 온라인: 대국 ----------
function applyRoom(r) {
  const prevLen = moves().length;
  const fresh = !room || room.code !== r.code;
  const newGame = r.state === 'playing' && (!room || room.state !== 'playing');
  const prevPass = fresh ? r.passSeq : passSeen;
  room = r;
  netDown = false;
  saveSession({ code: r.code, token: r.token });

  // 서버가 보낸 수순을 처음부터 두어서 판을 맞춘다. 방금 늘어난 한 수만 뒤집기 효과를 보여 준다
  const b = R.newBoard();
  let lastFlips = [], lastI = -1, lastC = EMPTY;
  for (const [i, col] of r.moves) { const f = R.play(b, i, col); if (!f) break; lastFlips = f; lastI = i; lastC = col; }
  board = b;
  if (r.moves.length === prevLen + 1 && !fresh && lastI >= 0) { animateMove(lastI, lastC, lastFlips); sfx.place(lastFlips.length); }
  else { anims = new Map(); placedAt = new Map(); lastMove = lastI; }
  turn = r.turn;
  over = r.state === 'over';
  turnEnd = performance.now() + r.remain;
  if (r.passSeq > prevPass) {
    showNote(r.passedBy === r.you ? '둘 곳이 없어 패스했어요' : '상대가 둘 곳이 없어 패스!', 2000);
    sfx.pass();
  }
  passSeen = r.passSeq;

  if (r.state === 'waiting') {
    screen = 'waiting'; showWaiting();
  } else if (r.state === 'playing') {
    if (newGame) { sfx.found(); resultSeen = ''; hover = cursor = -1; }
    if (screen !== 'confirm') { screen = ''; hideOverlay(); }
  } else {
    const key = `${r.code}:${r.moves.length}:${r.reason}:${r.winner}`;
    if (recorded !== key) {
      recorded = key;
      const rec = loadJson(ONLINE_KEY);
      if (r.winner === EMPTY) rec.d = (rec.d || 0) + 1;
      else if (r.winner === r.you) { rec.w = (rec.w || 0) + 1; sfx.win(); }
      else { rec.l = (rec.l || 0) + 1; sfx.lose(); }
      store.set(ONLINE_KEY, JSON.stringify(rec));
    }
    if (resultSeen !== key) {
      // 돌이 뒤집히는 모습을 잠깐 보여준 뒤 결과창
      const delay = r.reason === 'count' && screen !== 'result' ? 1100 : 0;
      setTimeout(() => { if (room === r && resultSeen !== key) showResult(); }, delay);
    }
  }
  updateHud(); draw();
}
const moves = () => (room ? room.moves : []);
const opponent = () => room && room.players.find((p) => p.color !== room.you);

function showResult() {
  screen = 'result';
  const r = room, opp = opponent();
  const won = r.winner === r.you;
  const c = R.count(board);
  const title = r.winner === EMPTY ? '무승부' : won ? '🎉 승리!' : '😵 패배';
  const why = {
    count: `흑 ${c.black} : 백 ${c.white}`,
    resign: won ? '상대가 기권했어요' : '기권했어요',
    timeout: won ? '상대가 시간을 넘겼어요' : '시간을 넘겼어요',
    left: won ? '상대가 나갔어요' : '연결이 끊겨 패배했어요',
  }[r.reason] || '';
  const rec = loadJson(ONLINE_KEY);
  const iVoted = r.rematch.includes(r.you), theyVoted = opp && r.rematch.includes(opp.color);
  let again;
  if (!opp) again = '<p>상대가 방을 나갔어요</p>';
  else if (iVoted) again = '<p>상대를 기다리는 중…</p>';
  else again = `${theyVoted ? '<p>상대가 한 판 더 두고 싶어해요!</p>' : ''}<div class="row"><button class="main" data-act="rematch">한 판 더</button></div>`;
  showOverlay(`
    <h2>${title}</h2>
    ${why ? `<p>${why}</p>` : ''}
    <span class="record">온라인 ${rec.w || 0}승 ${rec.l || 0}패${rec.d ? ` ${rec.d}무` : ''}</span>
    ${again}
    <div class="row">
      <button class="sub" data-act="viewResult">판 보기</button>
      <button class="sub" data-act="leave">나가기</button>
    </div>`);
}

function humanPlace(i) {
  if (!canPlace(i)) { if (canPlay() && board[i] === EMPTY) { sfx.nope(); showNote('뒤집을 돌이 없는 자리예요', 1100); } return; }
  hover = -1;
  if (mode === 'ai') { if (placeAi(i)) maybeAi(); return; }
  net.send('place', { i });
}
const canPlace = (i) => canPlay() && board[i] === EMPTY && R.flipsAt(board, i, turn).length > 0;

// 남은 시간 표시. 10초 아래로 내려가면 똑딱.
let lastTick = -1;
setInterval(() => {
  if (mode !== 'online' || !room || room.state !== 'playing') return;
  const s = Math.max(0, Math.ceil((turnEnd - performance.now()) / 1000));
  if (s !== lastTick) {
    lastTick = s;
    if (s <= 10 && s > 0 && turn === room.you) sfx.tick();
    updateHud();
  }
}, 200);

// ---------- HUD ----------
function updateHud() {
  let names = ['흑', '백'], status = '';
  const c = R.count(board);
  if (mode === 'ai') {
    const cpu = `🤖 ${LEVELS[level].name}`;
    names = humanColor === BLACK ? ['나', cpu] : [cpu, '나'];
    status = over ? '게임 끝' : thinking ? '생각 중…' : '내 차례';
  } else if (mode === 'online' && room) {
    for (const p of room.players) {
      const label = p.color === room.you ? `${p.name} (나)` : p.online ? p.name : `${p.name} · 끊김`;
      if (p.color === BLACK) names[0] = label;
      if (p.color === WHITE) names[1] = label;
    }
    if (room.state === 'waiting') status = '상대 기다리는 중';
    else if (room.state === 'over') status = '게임 끝';
    else if (netDown) status = '다시 연결하는 중…';
    else {
      const s = Math.max(0, Math.ceil((turnEnd - performance.now()) / 1000));
      status = `${turn === room.you ? '내 차례' : '상대 차례'} · ${s}초`;
    }
  }
  $('n1').textContent = names[0]; $('n2').textContent = names[1];
  $('c1').textContent = c.black; $('c2').textContent = c.white;
  const live = !!mode && !over && (mode === 'ai' || (room && room.state === 'playing'));
  $('p1').classList.toggle('turn', live && turn === BLACK);
  $('p2').classList.toggle('turn', live && turn === WHITE);
  $('status').textContent = status;
  const low = mode === 'online' && live && turn === room.you && turnEnd - performance.now() < 10000;
  $('status').classList.toggle('warn', !!low);

  const undoBtn = $('undoBtn');
  if (mode === 'online') { undoBtn.textContent = '🏳'; undoBtn.title = '기권'; undoBtn.disabled = !live; }
  else { undoBtn.textContent = '↩'; undoBtn.title = '무르기 (Z)'; undoBtn.disabled = mode !== 'ai' || !history.some((h) => h.turn === humanColor); }
}

// ---------- 그리기 ----------
const px = (i) => MARGIN + (i % N) * CELL + CELL / 2;
const py = (i) => MARGIN + ((i / N) | 0) * CELL + CELL / 2;
let drawQueued = false;
function scheduleDraw() { if (!drawQueued) { drawQueued = true; requestAnimationFrame(() => { drawQueued = false; draw(); }); } }

// 돌: 아래로 깔리는 진한 그림자 + 테두리 + 윗부분 광택. sx 는 뒤집히는 동안의 가로 폭 비율
function drawDisc(x, y, p, sx = 1, lift = 0, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y - lift);
  ctx.scale(Math.max(0.04, sx), 1);
  ctx.fillStyle = 'rgba(15,40,25,.55)';
  ctx.beginPath(); ctx.ellipse(0, 4 + lift, DISC_R, DISC_R * 0.96, 0, 0, Math.PI * 2); ctx.fill();
  const g = ctx.createRadialGradient(-DISC_R * 0.35, -DISC_R * 0.4, DISC_R * 0.1, 0, 0, DISC_R);
  if (p === BLACK) { g.addColorStop(0, '#7a7a86'); g.addColorStop(0.45, '#23202e'); g.addColorStop(1, '#0c0a14'); }
  else { g.addColorStop(0, '#ffffff'); g.addColorStop(0.6, '#f3f1f8'); g.addColorStop(1, '#c9c4d8'); }
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, DISC_R, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 2.5; ctx.strokeStyle = INK; ctx.stroke();
  ctx.fillStyle = p === BLACK ? 'rgba(255,255,255,.32)' : 'rgba(255,255,255,.95)';
  ctx.beginPath(); ctx.ellipse(-DISC_R * 0.3, -DISC_R * 0.42, DISC_R * 0.34, DISC_R * 0.17, -0.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function label(text, x, y, size, fill = '#fff') {
  ctx.font = `${size}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.22; ctx.strokeStyle = INK; ctx.strokeText(text, x, y);
  ctx.fillStyle = fill; ctx.fillText(text, x, y);
}

function draw() {
  const now = performance.now();
  let animating = false;
  // 초록 천 판
  const g = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  g.addColorStop(0, '#2fa66b'); g.addColorStop(1, '#1f8a55');
  ctx.fillStyle = g; ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = 'rgba(255,255,255,.035)';
  for (let k = 0; k < 12; k++) ctx.fillRect(0, 14 + k * 48, SIZE, 18);
  // 칸 줄
  ctx.strokeStyle = 'rgba(10,50,30,.75)'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let k = 0; k <= N; k++) {
    const a = MARGIN + k * CELL;
    ctx.moveTo(MARGIN, a); ctx.lineTo(MARGIN + N * CELL, a);
    ctx.moveTo(a, MARGIN); ctx.lineTo(a, MARGIN + N * CELL);
  }
  ctx.stroke();
  ctx.lineWidth = 4; ctx.strokeRect(MARGIN, MARGIN, N * CELL, N * CELL);
  ctx.fillStyle = 'rgba(10,50,30,.85)';
  for (const [r, c] of [[2, 2], [2, 6], [6, 2], [6, 6]]) { ctx.beginPath(); ctx.arc(MARGIN + c * CELL, MARGIN + r * CELL, 4.5, 0, Math.PI * 2); ctx.fill(); }

  const legal = canPlay() ? legalSet() : null;
  // 둘 수 있는 자리 표시
  if (legal && showHints) {
    for (const i of legal) {
      ctx.fillStyle = 'rgba(255,255,255,.28)';
      ctx.beginPath(); ctx.arc(px(i), py(i), 9, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.stroke();
    }
  }
  // 돌
  for (let i = 0; i < N * N; i++) {
    const v = board[i];
    if (!v) continue;
    const a = anims.get(i);
    let sx = 1, lift = 0, p = v;
    if (a) {
      const k = (now - a.start) / FLIP_MS;
      if (k < 0) { p = a.from; animating = true; }
      else if (k < 1) { animating = true; p = k < 0.5 ? a.from : a.to; sx = Math.abs(Math.cos(k * Math.PI)); lift = Math.sin(k * Math.PI) * 9; }
      else anims.delete(i);
    }
    const pa = placedAt.get(i);
    let alpha = 1;
    if (pa) {
      const k = (now - pa) / 220;
      if (k < 1) { animating = true; sx = Math.max(sx, 0.25 + 0.75 * k); alpha = 0.4 + 0.6 * k; lift = Math.max(lift, (1 - k) * 14); } else placedAt.delete(i);
    }
    drawDisc(px(i), py(i), p, sx, lift, alpha);
  }
  // 마지막 수 표시
  if (lastMove >= 0 && board[lastMove] && !anims.size) {
    ctx.strokeStyle = '#ff5f7a'; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.arc(px(lastMove), py(lastMove), DISC_R + 3, 0, Math.PI * 2); ctx.stroke();
  }
  // 놓을 자리 미리보기: 마우스·키보드 커서
  if (legal) {
    for (const i of [hover, cursor]) {
      if (i < 0 || !legal.has(i)) continue;
      drawDisc(px(i), py(i), turn, 1, 0, 0.5);
      // 뒤집힐 돌 표시
      for (const f of R.flipsAt(board, i, turn)) {
        ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(px(f), py(f), DISC_R - 4, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }
  // 안내 문구 (패스 등)
  if (note) {
    if (now > note.until) note = null;
    else {
      const k = Math.min(1, (note.until - now) / 300);
      ctx.save(); ctx.globalAlpha = k;
      ctx.fillStyle = 'rgba(43,29,82,.88)';
      const w = Math.min(SIZE - 40, 44 + note.text.length * 24), x0 = (SIZE - w) / 2;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x0, SIZE / 2 - 28, w, 56, 28) : ctx.rect(x0, SIZE / 2 - 28, w, 56); ctx.fill();
      label(note.text, SIZE / 2, SIZE / 2 + 1, 26, '#ffd23f');
      ctx.restore();
      animating = true;
    }
  }
  if (animating) scheduleDraw();
}

// ---------- 오버레이 ----------
function showOverlay(html) { const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden'); }
function hideOverlay() { $('overlay').classList.add('hidden'); }
const overlayOpen = () => !$('overlay').classList.contains('hidden');
function segHtml(key, opts, value) {
  return `<div class="seg" data-key="${key}">${opts.map(([v, label]) => `<button data-v="${v}" class="${String(v) === String(value) ? 'on' : ''}">${label}</button>`).join('')}</div>`;
}

function showHome() {
  leaveOnline();
  clearTimeout(aiTimer);
  mode = null; screen = ''; thinking = false;
  resetBoard(); updateHud(); draw();
  const wins = Number(store.get(WINS_KEY)) || 0, on = loadJson(ONLINE_KEY);
  showOverlay(`
    <h1>오<span class="y">셀로</span></h1>
    <p>내 돌로 상대 돌을 <b>끼워서 뒤집고</b>,<br>판이 끝났을 때 <b>돌이 더 많은 쪽</b>이 승리!</p>
    <div class="modes">
      <button class="mode" data-act="aiMenu"><span class="ico">🤖</span><b>컴퓨터랑 하기</b><small>쉬움 · 보통 · 어려움</small></button>
      <button class="mode" data-act="online"><span class="ico">🌐</span><b>온라인 오셀로</b><small>빠른 대전 · 친구와 방 만들기</small></button>
    </div>
    <span class="record">${wins || on.w || on.l ? `컴퓨터 상대 ${wins}승 · 온라인 ${on.w || 0}승 ${on.l || 0}패` : ''}</span>`);
}

function showAiMenu() {
  const rec = loadJson(RECORD_KEY)[level];
  const playing = mode === 'ai' && !over && history.length;
  showOverlay(`
    <h2>🤖 컴퓨터랑 하기</h2>
    <div class="group">
      <span class="label">난이도</span>
      ${segHtml('level', [['easy', '쉬움'], ['normal', '보통'], ['hard', '어려움']], level)}
      <span class="record">${rec ? `전적 ${rec.w}승 ${rec.l}패${rec.d ? ` ${rec.d}무` : ''}` : ''}</span>
    </div>
    <div class="group">
      <span class="label">내 돌</span>
      ${segHtml('color', [[BLACK, '⚫ 흑 (먼저)'], [WHITE, '⚪ 백 (나중)']], humanColor)}
    </div>
    <div class="group">
      <span class="label">둘 수 있는 자리 표시</span>
      ${segHtml('hints', [[1, '켜기'], [0, '끄기']], showHints ? 1 : 0)}
    </div>
    <div class="row">
      <button class="main" data-act="aiStart">${playing ? '새로 시작' : '시작하기'}</button>
      ${playing ? '<button class="sub" data-act="close">계속하기</button>' : ''}
    </div>
    <button class="back" data-act="home">← 처음으로</button>
    <div class="help"><span class="pc">🖱️ 클릭으로 착수<br>⌨️ 방향키 + Space · Z 무르기</span><span class="touch">👆 둘 수 있는 자리(점)를 눌러 착수</span></div>`);
}

function showOnline(error = '') {
  leaveOnline();
  clearTimeout(aiTimer);
  mode = 'online'; screen = 'online'; room = null;
  resetBoard(); updateHud(); draw();
  showOverlay(`
    <h2>🌐 온라인 오셀로</h2>
    <div class="group">
      <span class="label">내 이름</span>
      <input id="nameInput" maxlength="10" placeholder="이름 (최대 10자)" value="${esc(myName())}" autocomplete="off">
    </div>
    <div class="row"><button class="main" data-act="quick">⚡ 빠른 대전</button></div>
    <div class="row"><button class="sub" data-act="create">방 만들기</button></div>
    <div class="row join">
      <input id="codeInput" maxlength="4" placeholder="방 코드" autocomplete="off" autocapitalize="characters">
      <button class="sub" data-act="join">들어가기</button>
    </div>
    <span class="error">${esc(error)}</span>
    <button class="back" data-act="home">← 처음으로</button>
    <div class="help">한 수에 45초 · 흑백은 한 판마다 바뀌어요</div>`);
}

function showQueued() {
  showOverlay(`
    <h2>상대를 찾는 중…</h2>
    <div class="dots"><span></span><span></span><span></span></div>
    <p>누군가 빠른 대전을 누르면 바로 시작해요</p>
    <button class="sub" data-act="cancel">취소</button>`);
}
const inviteUrl = () => `${location.origin}${location.pathname}?room=${room.code}`;
function showWaiting() {
  showOverlay(`
    <h2>친구를 기다리는 중…</h2>
    <span class="label">방 코드</span>
    <div class="code">${esc(room.code)}</div>
    <p>친구가 <b>온라인 오셀로 → 들어가기</b>에<br>이 코드를 입력하면 시작해요</p>
    <div class="row"><button class="main" data-act="copy">🔗 초대 링크 복사</button></div>
    <button class="sub" data-act="cancel">취소</button>`);
}
function saveName() {
  const input = $('nameInput');
  if (!input) return;
  const name = input.value.trim().slice(0, 10);
  store.set('othelloName', name);
  net.send('hello', { name });
}

$('overlay').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const seg = btn.closest('.seg');
  if (seg) {
    const v = btn.dataset.v;
    if (seg.dataset.key === 'level') { level = v; store.set('othelloLevel', v); }
    if (seg.dataset.key === 'color') { humanColor = Number(v); store.set('othelloColor', v); }
    if (seg.dataset.key === 'hints') { showHints = v === '1'; store.set('othelloHints', v); }
    showAiMenu();
    return;
  }
  const act = btn.dataset.act;
  if (act === 'home') showHome();
  else if (act === 'aiMenu') showAiMenu();
  else if (act === 'aiStart') newAiGame();
  else if (act === 'close') { hideOverlay(); updateHud(); draw(); }
  else if (act === 'undo') undo();
  else if (act === 'online') showOnline();
  else if (act === 'quick') { saveName(); net.send('quick'); }
  else if (act === 'create') { saveName(); net.send('create'); }
  else if (act === 'join') {
    const code = ($('codeInput').value || '').trim().toUpperCase();
    if (code.length !== 4) { $('overlay').querySelector('.error').textContent = '방 코드 4자리를 입력해 주세요.'; return; }
    saveName();
    net.send('join', { code });
  } else if (act === 'cancel') { net.send('cancel'); showOnline(); }
  else if (act === 'copy') {
    const url = inviteUrl();
    const done = () => { btn.textContent = '✅ 복사했어요'; setTimeout(() => { btn.textContent = '🔗 초대 링크 복사'; }, 1500); };
    if (navigator.share && matchMedia('(pointer: coarse)').matches) navigator.share({ title: '오셀로 한 판 해요!', url }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('링크를 복사하세요', url));
    else prompt('링크를 복사하세요', url);
  } else if (act === 'rematch') net.send('rematch');
  else if (act === 'viewResult') { resultSeen = `${room.code}:${room.moves.length}:${room.reason}:${room.winner}`; screen = ''; hideOverlay(); }
  else if (act === 'leave') showOnline();
  else if (act === 'resign') { net.send('resign'); screen = ''; hideOverlay(); }
  else if (act === 'quit') showHome();
  else if (act === 'resume') { screen = ''; hideOverlay(); }
});
$('overlay').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'codeInput') $('overlay').querySelector('[data-act="join"]').click();
  if (e.target.id === 'nameInput') $('overlay').querySelector('[data-act="quick"]').click();
  e.stopPropagation();
});

function confirmResign() {
  screen = 'confirm';
  showOverlay(`<h2>기권할까요?</h2><p>이번 판은 패배로 기록돼요</p>
    <div class="row"><button class="main" data-act="resume">계속 두기</button><button class="sub" data-act="resign">🏳 기권</button></div>`);
}
function confirmQuit() {
  screen = 'confirm';
  showOverlay(`<h2>대국을 그만둘까요?</h2><p>지금 나가면 기권패가 돼요</p>
    <div class="row"><button class="main" data-act="resume">계속 두기</button><button class="sub" data-act="quit">나가기</button></div>`);
}

// ---------- 입력 ----------
function cellAt(e) {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (SIZE / rect.width), y = (e.clientY - rect.top) * (SIZE / rect.height);
  const c = Math.floor((x - MARGIN) / CELL), r = Math.floor((y - MARGIN) / CELL);
  if (r < 0 || r >= N || c < 0 || c >= N) return -1;
  return r * N + c;
}
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  const i = cellAt(e);
  if (i !== hover) { hover = i; scheduleDraw(); }
});
canvas.addEventListener('pointerleave', () => { hover = -1; scheduleDraw(); });
canvas.addEventListener('pointerdown', (e) => {
  // 판 보기 중에 누르면 결과창으로 돌아간다
  if (over && !overlayOpen()) {
    if (mode === 'online' && room) { resultSeen = ''; showResult(); }
    else if (mode === 'ai') finishAiOverlay();
    return;
  }
  const i = cellAt(e);
  if (i < 0 || !canPlay()) return;
  cursor = -1;
  humanPlace(i);
});
function finishAiOverlay() {
  showOverlay(`<h2>게임 끝</h2>
    <div class="row"><button class="main" data-act="aiStart">한 판 더</button></div>
    <div class="row"><button class="sub" data-act="close">판 보기</button><button class="sub" data-act="undo">무르기</button><button class="sub" data-act="home">메뉴</button></div>`);
}
function openMenu() {
  if (mode === 'online' && room && room.state === 'playing') confirmQuit();
  else if (mode === 'online') showOnline();
  else if (mode === 'ai') showAiMenu();
  else showHome();
}
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'KeyM') { toggleMute(); return; }
  if (e.code === 'Escape') {
    if (overlayOpen() && (screen === 'confirm' || (mode === 'ai' && !over && history.length))) { screen = ''; hideOverlay(); }
    else openMenu();
    return;
  }
  if (overlayOpen()) {
    if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); const m = $('overlay').querySelector('.main'); if (m) m.click(); }
    return;
  }
  if (e.code === 'KeyZ' || e.code === 'Backspace') { e.preventDefault(); undo(); return; }
  const move = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.code];
  if (move) {
    e.preventDefault();
    if (cursor < 0) cursor = lastMove >= 0 ? lastMove : 3 * N + 3;
    const r = Math.min(N - 1, Math.max(0, ((cursor / N) | 0) + move[0])), c = Math.min(N - 1, Math.max(0, (cursor % N) + move[1]));
    cursor = r * N + c; hover = -1; draw();
  }
  if ((e.code === 'Space' || e.code === 'Enter') && cursor >= 0) { e.preventDefault(); humanPlace(cursor); }
});

function toggleMute() { muted = !muted; store.set('othelloMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('undoBtn').onclick = (e) => { e.currentTarget.blur(); if (mode === 'online') confirmResign(); else undo(); };
$('menuBtn').onclick = (e) => { e.currentTarget.blur(); openMenu(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';

// ---------- 시작 ----------
// 초대 링크(?room=CODE)로 들어왔거나, 새로고침 전에 두던 대국이 있으면 온라인으로 바로 간다
const invite = new URLSearchParams(location.search).get('room');
if (invite) history_replace();
function history_replace() { try { window.history.replaceState(null, '', location.pathname); } catch (_) {} }
function joinInvite(code) { showOnline(); net.send('join', { code: code.toUpperCase() }); }
fit();
if (loadSession()) {
  mode = 'online'; screen = '';
  showOverlay('<h2>대국으로 돌아가는 중…</h2>');
  net.connect();
  const until = setInterval(() => {
    if (room || !loadSession()) { clearInterval(until); if (!room) invite ? joinInvite(invite) : showOnline(); }
  }, 100);
} else if (invite) joinInvite(invite);
else showHome();
updateHud();

/* @test-hooks:start */
window.__ot = { get board() { return board; }, get turn() { return turn; }, get over() { return over; }, get mode() { return mode; }, get room() { return room; }, get thinking() { return thinking; }, get history() { return history; }, get note() { return note; }, humanPlace, newAiGame, undo, canPlay, legalSet, draw, setLevel: (l) => { level = l; }, setColor: (c) => { humanColor = c; }, showResult, R };
/* @test-hooks:end */
})();

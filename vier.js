// Pong für bis zu vier Spieler: quadratisches Feld, jeder verteidigt eine Seite.
// Wie beim 2er-Spiel berechnet der Server alles, die Browser zeigen es nur an.
const { WebSocketServer } = require('ws');

// Spielfeld in Spieleinheiten. Seiten: 0 unten, 1 links, 2 oben, 3 rechts.
const S = 600;
const PADDLE_L = 90; // Länge entlang der Wand
const PADDLE_T = 12; // Dicke
const MARGIN = 16; // Abstand Schläger – Wand
const CORNER = 40; // feste Eckblöcke
const PADDLE_SPEED = 7;
const BALL = 12;
const BALL_SPEED = 5.5;
const BALL_MAX_SPEED = 12;
const LIVES = 5;
const MAX_PLAYERS = 4;
const TICK_MS = 1000 / 60;
const COUNTDOWN_TICKS = 180; // 3 Sekunden, damit noch jemand dazukommen kann
const SERVE_TICKS = 60;
const OVER_TICKS = 300;
const SEAT_ORDER = [0, 2, 1, 3]; // die ersten zwei spielen sich gegenüber
const PADDLE_MIN = CORNER;
const PADDLE_MAX = S - CORNER - PADDLE_L;

const wss = new WebSocketServer({ noServer: true });
const rooms = new Map();
let nextPublicId = 1;

function createRoom(key, isPublic) {
  const room = {
    key,
    isPublic,
    players: [null, null, null, null], // je Seite die Verbindung oder null
    inputs: [0, 0, 0, 0],
    paddles: [0, 0, 0, 0].map(() => (S - PADDLE_L) / 2),
    lives: [null, null, null, null], // null = in dieser Runde nicht dabei
    lastHit: null,
    ball: null,
    state: 'waiting', // waiting | countdown | serve | playing | over
    timer: 0,
    winner: null,
  };
  rooms.set(key, room);
  return room;
}

function findRoom(roomName) {
  if (roomName) {
    const key = 'privat:' + roomName;
    return rooms.get(key) || createRoom(key, false);
  }
  for (const room of rooms.values()) {
    if (room.isPublic && room.players.includes(null)) return room;
  }
  return createRoom('public:' + nextPublicId++, true);
}

const connectedCount = (room) => room.players.filter(Boolean).length;
const alive = (room) => [0, 1, 2, 3].filter((s) => room.lives[s] > 0);

// Richtung von der Feldmitte zur Wand der Seite
const OUT = [[0, 1], [-1, 0], [0, -1], [1, 0]];

function serve(room, towards) {
  const dir = OUT[towards];
  const angle = (Math.random() - 0.5) * (Math.PI / 3);
  // Grundrichtung zur Seite hin, um bis zu ±30° gedreht
  const vx = dir[0] * Math.cos(angle) - dir[1] * Math.sin(angle);
  const vy = dir[0] * Math.sin(angle) + dir[1] * Math.cos(angle);
  room.ball = {
    x: (S - BALL) / 2,
    y: (S - BALL) / 2,
    vx: vx * BALL_SPEED,
    vy: vy * BALL_SPEED,
    speed: BALL_SPEED,
  };
  room.state = 'serve';
  room.timer = SERVE_TICKS;
}

function randomOf(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function startRound(room) {
  for (let s = 0; s < 4; s++) {
    room.lives[s] = room.players[s] ? LIVES : null;
    room.paddles[s] = (S - PADDLE_L) / 2;
  }
  room.winner = null;
  serve(room, randomOf(alive(room)));
}

function toWaiting(room) {
  room.state = 'waiting';
  room.ball = null;
  room.winner = null;
  room.lives = [null, null, null, null];
}

// Schläger als Rechteck im Feld
function paddleRect(side, pos) {
  switch (side) {
    case 0: return { x: pos, y: S - MARGIN - PADDLE_T, w: PADDLE_L, h: PADDLE_T };
    case 1: return { x: MARGIN, y: pos, w: PADDLE_T, h: PADDLE_L };
    case 2: return { x: pos, y: MARGIN, w: PADDLE_L, h: PADDLE_T };
    default: return { x: S - MARGIN - PADDLE_T, y: pos, w: PADDLE_T, h: PADDLE_L };
  }
}

function overlaps(b, r) {
  return b.x < r.x + r.w && b.x + BALL > r.x && b.y < r.y + r.h && b.y + BALL > r.y;
}

function bounceOffPaddle(b, side, pos) {
  // Je weiter außen der Ball trifft, desto steiler fliegt er zurück
  const along = side === 0 || side === 2 ? b.x : b.y;
  const rel = Math.max(-1, Math.min(1, (along + BALL / 2 - (pos + PADDLE_L / 2)) / (PADDLE_L / 2)));
  const angle = rel * (Math.PI / 3);
  b.speed = Math.min(b.speed * 1.05, BALL_MAX_SPEED);
  const back = b.speed * Math.cos(angle); // zurück zur Mitte
  const side_ = b.speed * Math.sin(angle); // entlang der Wand
  const r = paddleRect(side, pos);
  if (side === 0) { b.y = r.y - BALL; b.vy = -back; b.vx = side_; }
  else if (side === 2) { b.y = r.y + r.h; b.vy = back; b.vx = side_; }
  else if (side === 1) { b.x = r.x + r.w; b.vx = back; b.vy = side_; }
  else { b.x = r.x - BALL; b.vx = -back; b.vy = side_; }
}

const CORNERS = [
  { x: 0, y: 0 }, { x: S - CORNER, y: 0 }, { x: 0, y: S - CORNER }, { x: S - CORNER, y: S - CORNER },
].map((c) => ({ ...c, w: CORNER, h: CORNER }));

function bounceOffCorners(b) {
  for (const c of CORNERS) {
    if (!overlaps(b, c)) continue;
    // Auf der Achse mit der kleinsten Überlappung hinausschieben und abprallen
    const dx = Math.min(b.x + BALL - c.x, c.x + c.w - b.x);
    const dy = Math.min(b.y + BALL - c.y, c.y + c.h - b.y);
    const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    if (dx < dy) {
      const right = b.x + BALL / 2 > cx;
      b.x = right ? c.x + c.w : c.x - BALL;
      b.vx = Math.abs(b.vx) * (right ? 1 : -1);
    } else {
      const below = b.y + BALL / 2 > cy;
      b.y = below ? c.y + c.h : c.y - BALL;
      b.vy = Math.abs(b.vy) * (below ? 1 : -1);
    }
  }
}

function moveBall(room) {
  const b = room.ball;
  b.x += b.vx;
  b.y += b.vy;

  // Freie und ausgeschiedene Seiten sind Wände
  const isWall = (s) => !(room.lives[s] > 0);
  if (isWall(0) && b.y + BALL > S) { b.y = S - BALL; b.vy = -Math.abs(b.vy); }
  if (isWall(2) && b.y < 0) { b.y = 0; b.vy = Math.abs(b.vy); }
  if (isWall(1) && b.x < 0) { b.x = 0; b.vx = Math.abs(b.vx); }
  if (isWall(3) && b.x + BALL > S) { b.x = S - BALL; b.vx = -Math.abs(b.vx); }

  bounceOffCorners(b);

  const approaching = [b.vy > 0, b.vx < 0, b.vy < 0, b.vx > 0];
  for (const s of alive(room)) {
    if (approaching[s] && overlaps(b, paddleRect(s, room.paddles[s]))) {
      bounceOffPaddle(b, s, room.paddles[s]);
      break;
    }
  }

  // Ball ganz hinter einer Seite: diese Seite verliert ein Leben
  const gone = [b.y > S, b.x + BALL < 0, b.y + BALL < 0, b.x > S];
  for (const s of alive(room)) {
    if (gone[s]) {
      loseLife(room, s);
      return;
    }
  }
}

function loseLife(room, side) {
  room.lives[side]--;
  const left = alive(room);
  if (left.length <= 1) {
    room.state = 'over';
    room.winner = left.length === 1 ? left[0] : null;
    room.ball = null;
    room.timer = OVER_TICKS;
    return;
  }
  // Aufschlag zu dem, der gerade verloren hat, sonst zu einem Zufälligen
  serve(room, room.lives[side] > 0 ? side : randomOf(left));
}

function tick(room) {
  for (let s = 0; s < 4; s++) {
    room.paddles[s] = Math.max(PADDLE_MIN, Math.min(PADDLE_MAX, room.paddles[s] + room.inputs[s] * PADDLE_SPEED));
  }

  if (room.state === 'waiting') {
    if (connectedCount(room) >= 2) {
      room.state = 'countdown';
      room.timer = COUNTDOWN_TICKS;
    }
  } else if (room.state === 'countdown') {
    if (connectedCount(room) < 2) toWaiting(room);
    else if (--room.timer <= 0) startRound(room);
  } else if (room.state === 'over') {
    if (--room.timer <= 0) {
      toWaiting(room);
      if (connectedCount(room) >= 2) startRound(room);
    }
  } else if (room.state === 'serve') {
    if (--room.timer <= 0) room.state = 'playing';
  } else {
    moveBall(room);
  }

  broadcast(room);
}

function broadcast(room) {
  const b = room.ball;
  const msg = JSON.stringify({
    type: 'state',
    st: room.state,
    p: room.paddles.map(Math.round),
    b: b ? [Math.round(b.x), Math.round(b.y)] : null,
    l: room.lives,
    c: room.players.map(Boolean),
    w: room.winner,
    t: Math.ceil(room.timer / 60),
  });
  for (const ws of room.players) {
    if (ws && ws.readyState === ws.OPEN) ws.send(msg);
  }
}

wss.on('connection', (ws, req) => {
  const roomName = new URL(req.url, 'http://localhost').searchParams.get('room');
  const cleanName = roomName ? roomName.slice(0, 32).replace(/[^\w-]/g, '') : '';
  const room = findRoom(cleanName);
  const side = SEAT_ORDER.find((s) => room.players[s] === null);

  if (side === undefined) {
    ws.send(JSON.stringify({ type: 'full' }));
    ws.close();
    return;
  }

  room.players[side] = ws;
  room.inputs[side] = 0;
  ws.send(
    JSON.stringify({
      type: 'welcome',
      side,
      room: room.isPublic ? null : cleanName,
      field: { S, PADDLE_L, PADDLE_T, MARGIN, CORNER, BALL, LIVES, MAX_PLAYERS },
    })
  );

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.type === 'input' && [-1, 0, 1].includes(msg.dir)) {
      // Der Browser schickt "links/rechts auf meinem Bildschirm". Weil jeder seine
      // Seite unten sieht, zeigt dieses Links je nach Seite in eine andere Feldrichtung.
      room.inputs[side] = side === 0 || side === 1 ? msg.dir : -msg.dir;
    }
  });

  ws.on('close', () => {
    room.players[side] = null;
    room.inputs[side] = 0;
    if (room.players.every((p) => p === null)) {
      rooms.delete(room.key);
      return;
    }
    if (room.lives[side] > 0) {
      // Wer mitten in der Runde geht, scheidet aus; seine Seite wird zur Wand
      room.lives[side] = 0;
      const left = alive(room);
      if ((room.state === 'serve' || room.state === 'playing') && left.length <= 1) {
        room.state = 'over';
        room.winner = left.length === 1 ? left[0] : null;
        room.ball = null;
        room.timer = OVER_TICKS;
      }
    }
    room.lives[side] = room.state === 'waiting' || room.state === 'countdown' ? null : room.lives[side];
    broadcast(room);
  });
});

setInterval(() => {
  for (const room of rooms.values()) tick(room);
}, TICK_MS);

module.exports = { wss };

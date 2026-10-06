// Ganz einfaches Online-Pong: der Server berechnet das Spiel, die Browser zeigen es nur an.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

// Spielfeld in Spieleinheiten (der Client skaliert auf seine Fenstergröße)
const W = 800;
const H = 500;
const PADDLE_W = 12;
const PADDLE_H = 80;
const PADDLE_MARGIN = 20;
const PADDLE_SPEED = 7;
const BALL = 12;
const BALL_SPEED = 6;
const BALL_MAX_SPEED = 14;
const WIN_SCORE = 7;
const TICK_MS = 1000 / 60;
const SERVE_TICKS = 60; // 1 Sekunde Pause vor jedem Aufschlag
const OVER_TICKS = 300; // 5 Sekunden bis zur nächsten Runde

const indexHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(indexHtml);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Nicht gefunden');
  }
});

const wss = new WebSocketServer({ server });
const rooms = new Map();
let nextPublicId = 1;

function createRoom(key, isPublic) {
  const room = {
    key,
    isPublic,
    players: [null, null],
    inputs: [0, 0],
    paddles: [(H - PADDLE_H) / 2, (H - PADDLE_H) / 2],
    score: [0, 0],
    ball: null,
    state: 'waiting', // waiting | serve | playing | over
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

function serve(room, dir) {
  const angle = (Math.random() - 0.5) * (Math.PI / 3);
  room.ball = {
    x: (W - BALL) / 2,
    y: (H - BALL) / 2,
    vx: dir * BALL_SPEED * Math.cos(angle),
    vy: BALL_SPEED * Math.sin(angle),
    speed: BALL_SPEED,
  };
  room.state = 'serve';
  room.timer = SERVE_TICKS;
}

function startGame(room) {
  room.score = [0, 0];
  room.winner = null;
  room.paddles = [(H - PADDLE_H) / 2, (H - PADDLE_H) / 2];
  serve(room, Math.random() < 0.5 ? -1 : 1);
}

function bounceOffPaddle(ball, paddleY, dir) {
  // Je weiter außen der Ball den Schläger trifft, desto steiler fliegt er zurück
  const rel = (ball.y + BALL / 2 - (paddleY + PADDLE_H / 2)) / (PADDLE_H / 2);
  const angle = Math.max(-1, Math.min(1, rel)) * (Math.PI / 3);
  ball.speed = Math.min(ball.speed * 1.05, BALL_MAX_SPEED);
  ball.vx = dir * ball.speed * Math.cos(angle);
  ball.vy = ball.speed * Math.sin(angle);
}

function hitsPaddle(ball, paddleX, paddleY) {
  return (
    ball.x < paddleX + PADDLE_W &&
    ball.x + BALL > paddleX &&
    ball.y < paddleY + PADDLE_H &&
    ball.y + BALL > paddleY
  );
}

function tick(room) {
  if (room.state === 'waiting') return;

  for (let i = 0; i < 2; i++) {
    room.paddles[i] = Math.max(0, Math.min(H - PADDLE_H, room.paddles[i] + room.inputs[i] * PADDLE_SPEED));
  }

  if (room.state === 'over') {
    if (--room.timer <= 0) startGame(room);
  } else if (room.state === 'serve') {
    if (--room.timer <= 0) room.state = 'playing';
  } else {
    moveBall(room);
  }

  broadcast(room);
}

function moveBall(room) {
  const b = room.ball;
  b.x += b.vx;
  b.y += b.vy;

  if (b.y < 0) {
    b.y = 0;
    b.vy = -b.vy;
  } else if (b.y + BALL > H) {
    b.y = H - BALL;
    b.vy = -b.vy;
  }

  const leftX = PADDLE_MARGIN;
  const rightX = W - PADDLE_MARGIN - PADDLE_W;
  if (b.vx < 0 && hitsPaddle(b, leftX, room.paddles[0])) {
    b.x = leftX + PADDLE_W;
    bounceOffPaddle(b, room.paddles[0], 1);
  } else if (b.vx > 0 && hitsPaddle(b, rightX, room.paddles[1])) {
    b.x = rightX - BALL;
    bounceOffPaddle(b, room.paddles[1], -1);
  }

  if (b.x + BALL < 0) point(room, 1);
  else if (b.x > W) point(room, 0);
}

function point(room, scorer) {
  room.score[scorer]++;
  if (room.score[scorer] >= WIN_SCORE) {
    room.state = 'over';
    room.winner = scorer;
    room.timer = OVER_TICKS;
  } else {
    // Aufschlag geht zu dem Spieler, der den Punkt verloren hat
    serve(room, scorer === 0 ? 1 : -1);
  }
}

function broadcast(room) {
  const b = room.ball;
  const msg = JSON.stringify({
    type: 'state',
    st: room.state,
    p: room.paddles.map(Math.round),
    b: b ? [Math.round(b.x), Math.round(b.y)] : null,
    s: room.score,
    w: room.winner,
  });
  for (const ws of room.players) {
    if (ws && ws.readyState === ws.OPEN) ws.send(msg);
  }
}

wss.on('connection', (ws, req) => {
  const roomName = new URL(req.url, 'http://localhost').searchParams.get('room');
  const cleanName = roomName ? roomName.slice(0, 32).replace(/[^\w-]/g, '') : '';
  const room = findRoom(cleanName);
  const side = room.players.indexOf(null);

  if (side === -1) {
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
      field: { W, H, PADDLE_W, PADDLE_H, PADDLE_MARGIN, BALL, WIN_SCORE },
    })
  );

  if (!room.players.includes(null)) startGame(room);
  broadcast(room);

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.type === 'input' && [-1, 0, 1].includes(msg.dir)) {
      room.inputs[side] = msg.dir;
    }
  });

  ws.on('close', () => {
    room.players[side] = null;
    room.inputs[side] = 0;
    if (room.players.every((p) => p === null)) {
      rooms.delete(room.key);
      return;
    }
    // Der verbliebene Spieler wartet auf einen neuen Gegner
    room.state = 'waiting';
    room.ball = null;
    room.score = [0, 0];
    room.winner = null;
    broadcast(room);
  });
});

setInterval(() => {
  for (const room of rooms.values()) tick(room);
}, TICK_MS);

server.listen(PORT, () => {
  console.log(`Pong läuft auf http://localhost:${PORT}`);
});

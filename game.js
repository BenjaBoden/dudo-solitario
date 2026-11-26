'use strict';

/* =========================================================
   Dudo Solitario — Dudo / Cacho / Liar's Dice contra bots
   ========================================================= */

const MAX_DICE = 5;
const BOT_DELAY = 1100;
const BOT_NAMES = ['Pancho', 'Rosa', 'Toño', 'Maite', 'Lucho', 'Carmen', 'Nacho', 'Vale'];
const FACE_NAMES = {
  1: ['as', 'ases'],
  2: ['tonto', 'tontos'],
  3: ['tren', 'trenes'],
  4: ['cuadra', 'cuadras'],
  5: ['quina', 'quinas'],
  6: ['sexto', 'sextos'],
};
// Posiciones de los puntos en una grilla 3x3 (0..8)
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

// Parámetros de la IA por dificultad
const DIFFICULTY = {
  easy:   { noise: 0.20, bluff: 0.25, dudoAt: 0.42, calzoAt: 0.30, target: [0.40, 0.75], readBids: false },
  normal: { noise: 0.08, bluff: 0.15, dudoAt: 0.33, calzoAt: 0.38, target: [0.50, 0.70], readBids: false },
  hard:   { noise: 0.03, bluff: 0.10, dudoAt: 0.30, calzoAt: 0.40, target: [0.55, 0.70], readBids: true },
};

const $ = (s) => document.querySelector(s);

let G = null;               // estado de la partida
const ui = { q: 1, f: 2 };  // apuesta seleccionada por el humano
let botTimer = null;

/* ---------------- Utilidades ---------------- */

const rand = (a, b) => a + Math.random() * (b - a);
const rollDie = () => 1 + Math.floor(Math.random() * 6);
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const matches = (d, f) => d === f || (f !== 1 && d === 1); // los ases son comodines
const faceName = (f, q) => FACE_NAMES[f][q === 1 ? 0 : 1];
const bidText = (b) => `${b.q} ${faceName(b.f, b.q)}`;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const totalDice = () => G.players.reduce((s, p) => s + p.count, 0);
const alivePlayers = () => G.players.filter((p) => p.count > 0);
const countAll = (f) => G.players.reduce((s, p) => s + p.dice.filter((d) => matches(d, f)).length, 0);
const ownCount = (i, f) => G.players[i].dice.filter((d) => matches(d, f)).length;

function nextAlive(i) {
  const n = G.players.length;
  for (let k = 1; k <= n; k++) {
    const j = (i + k) % n;
    if (G.players[j].count > 0) return j;
  }
  return i;
}

/* ---------------- Reglas de apuesta ---------------- */

// Cantidad mínima válida para apostar a la pinta f, dada la apuesta anterior
function minQty(prev, f) {
  if (!prev) return f === 1 ? Infinity : 1;          // no se abre con ases
  if (prev.f !== 1 && f !== 1) return f > prev.f ? prev.q : prev.q + 1;
  if (prev.f !== 1 && f === 1) return Math.ceil(prev.q / 2);
  if (prev.f === 1 && f === 1) return prev.q + 1;
  return prev.q * 2 + 1;                             // de ases a otra pinta
}

const isValidBid = (prev, q, f) => Number.isInteger(q) && q >= minQty(prev, f) && q <= totalDice();

/* ---------------- Probabilidades (IA) ---------------- */

function choose(n, k) {
  let r = 1;
  for (let j = 1; j <= k; j++) r = (r * (n - k + j)) / j;
  return r;
}
const binomEQ = (n, k, p) => (k < 0 || k > n ? 0 : choose(n, k) * p ** k * (1 - p) ** (n - k));
function binomGE(n, k, p) {
  if (k <= 0) return 1;
  let s = 0;
  for (let j = k; j <= n; j++) s += binomEQ(n, j, p);
  return s;
}

// En difícil, la IA supone que quien apostó a una pinta probablemente la tiene
function bidHint(i, f) {
  if (!DIFFICULTY[G.diff].readBids) return 0;
  const others = new Set(G.history.filter((b) => b.by !== i && b.f === f).map((b) => b.by));
  return Math.min(1.5, others.size * 0.5);
}

function probAtLeast(i, q, f) {
  const unknown = totalDice() - G.players[i].count;
  const need = Math.ceil(q - ownCount(i, f) - bidHint(i, f));
  return binomGE(unknown, need, f === 1 ? 1 / 6 : 1 / 3);
}

function probExact(i, q, f) {
  const unknown = totalDice() - G.players[i].count;
  return binomEQ(unknown, q - ownCount(i, f), f === 1 ? 1 / 6 : 1 / 3);
}

function botDecide(i) {
  const cfg = DIFFICULTY[G.diff];
  const me = G.players[i];
  const total = totalDice();
  const bid = G.bid;
  const jitter = () => rand(-cfg.noise, cfg.noise);

  if (!bid) {
    // Apertura: la pinta que más tengo, con la cantidad más alta que sigue siendo probable
    const target = rand(...cfg.target);
    let best = null;
    for (let f = 2; f <= 6; f++) {
      let q = 1;
      while (q < total && probAtLeast(i, q + 1, f) >= target) q++;
      const s = q + ownCount(i, f) * 0.3 + Math.random() * 0.5;
      if (!best || s > best.s) best = { q, f, s };
    }
    if (Math.random() < cfg.bluff) {
      best.f = 2 + Math.floor(Math.random() * 5);
      best.q = Math.max(1, best.q - 1);
    }
    return { type: 'bid', q: best.q, f: best.f };
  }

  const pTrue = probAtLeast(i, bid.q, bid.f) + jitter();
  if (pTrue < cfg.dudoAt) return { type: 'dudo' };
  if (me.count < MAX_DICE && probExact(i, bid.q, bid.f) > cfg.calzoAt && Math.random() < 0.5) {
    return { type: 'calzo' };
  }

  // Posibles subidas: la mínima de cada pinta y una más
  const cands = [];
  for (let f = 1; f <= 6; f++) {
    const m = minQty(bid, f);
    for (let q = m; q <= Math.min(total, m + 1); q++) {
      cands.push({ q, f, score: probAtLeast(i, q, f) + jitter() - (q - m) * 0.05 });
    }
  }
  if (!cands.length) return { type: 'dudo' };
  cands.sort((a, b) => b.score - a.score);

  let pick = cands[0];
  if (Math.random() < cfg.bluff) {
    const ok = cands.filter((c) => c.score > 0.3);
    if (ok.length) pick = ok[Math.floor(Math.random() * ok.length)];
  }
  if (pick.score < 0.35 && pTrue < 0.55) return { type: 'dudo' };
  return { type: 'bid', q: pick.q, f: pick.f };
}

/* ---------------- Flujo del juego ---------------- */

function newGame() {
  clearTimeout(botTimer);
  const name = $('#in-name').value.trim() || 'Tú';
  const nBots = Number($('#in-bots').value);
  const bots = shuffle(BOT_NAMES.slice()).slice(0, nBots);
  const mk = (n, human) => ({ name: n, human, count: MAX_DICE, dice: [], last: '' });

  G = {
    players: [mk(name, true), ...bots.map((n) => mk(n, false))],
    diff: $('#in-diff').value,
    round: 0,
    bid: null,
    history: [],
    current: 0,
    phase: 'bidding',
    result: null,
    reveal: null,
    nextStarter: 0,
    over: null,
  };
  $('#log').innerHTML = '';
  $('#setup').classList.add('hidden');
  $('#game').classList.remove('hidden');
  startRound(Math.floor(Math.random() * G.players.length));
}

function startRound(starter) {
  G.round++;
  G.bid = null;
  G.history = [];
  G.phase = 'bidding';
  G.result = null;
  G.reveal = null;
  for (const p of G.players) {
    p.dice = Array.from({ length: p.count }, rollDie).sort((a, b) => a - b);
    p.last = '';
  }
  G.current = G.players[starter].count > 0 ? starter : nextAlive(starter);
  log(`Ronda ${G.round} · ${totalDice()} dados en juego · empieza ${esc(G.players[G.current].name)}`, 'round');
  syncPicker();
  render(true);
  scheduleTurn();
}

function scheduleTurn() {
  clearTimeout(botTimer);
  if (G.phase !== 'bidding') return;
  if (!G.players[G.current].human) {
    botTimer = setTimeout(botTurn, BOT_DELAY + Math.random() * 500);
  }
}

function botTurn() {
  if (!G || G.phase !== 'bidding') return;
  const i = G.current;
  const d = botDecide(i);
  if (d.type === 'bid') placeBid(i, d.q, d.f);
  else if (d.type === 'dudo') callDudo(i);
  else callCalzo(i);
}

function placeBid(i, q, f) {
  if (G.phase !== 'bidding' || i !== G.current || !isValidBid(G.bid, q, f)) return;
  G.bid = { q, f, by: i };
  G.history.push({ ...G.bid });
  const p = G.players[i];
  p.last = bidText(G.bid);
  log(`${esc(p.name)} apuesta <b>${bidText(G.bid)}</b>`);
  G.current = nextAlive(i);
  syncPicker();
  render();
  scheduleTurn();
}

function callDudo(i) {
  if (G.phase !== 'bidding' || i !== G.current || !G.bid) return;
  const { q, f, by } = G.bid;
  const actual = countAll(f);
  const caller = G.players[i];
  const bidder = G.players[by];
  const loser = actual >= q ? i : by;
  caller.last = '¡Dudo!';
  log(`${esc(caller.name)} duda de ${esc(bidder.name)}`);

  const msg =
    `${esc(caller.name)} dudó de <b>${q} ${faceName(f, q)}</b> y había <b>${actual}</b>. ` +
    `${esc(G.players[loser].name)} pierde un dado.`;
  changeDice(loser, -1);
  endRound(msg, loser, f, loser);
}

function callCalzo(i) {
  if (G.phase !== 'bidding' || i !== G.current || !G.bid) return;
  const { q, f } = G.bid;
  const actual = countAll(f);
  const caller = G.players[i];
  caller.last = '¡Calzo!';
  log(`${esc(caller.name)} calza`);

  let msg = `${esc(caller.name)} calzó <b>${q} ${faceName(f, q)}</b> y había <b>${actual}</b>. `;
  if (actual === q) {
    if (caller.count < MAX_DICE) {
      changeDice(i, +1);
      msg += `¡Exacto! Recupera un dado.`;
    } else {
      msg += `¡Exacto! (Ya tenía 5 dados.)`;
    }
    endRound(msg, i, f, null, i);
  } else {
    changeDice(i, -1);
    msg += `Falló y pierde un dado.`;
    endRound(msg, i, f, i);
  }
}

function changeDice(i, delta) {
  const p = G.players[i];
  p.count = Math.max(0, Math.min(MAX_DICE, p.count + delta));
  if (p.count === 0) log(`${esc(p.name)} queda eliminado`, 'out');
}

function endRound(msg, nextStarter, face, loser, winner = null) {
  clearTimeout(botTimer);
  G.phase = 'reveal';
  G.result = msg;
  G.reveal = { face, loser, winner };
  G.nextStarter = nextStarter;
  log(msg, 'result');

  const human = G.players[0];
  if (human.count === 0) G.over = 'lose';
  else if (alivePlayers().length === 1) G.over = 'win';
  render();
}

function nextRound() {
  if (G.over) return showGameOver();
  startRound(G.nextStarter);
}

function showGameOver() {
  const won = G.over === 'win';
  const remaining = alivePlayers().length;
  $('#over-title').textContent = won ? '🏆 ¡Ganaste!' : '💀 Te quedaste sin dados';
  $('#over-text').textContent = won
    ? `Venciste a todos tus rivales en ${G.round} rondas.`
    : `Quedaste eliminado en la ronda ${G.round}. Aún quedaban ${remaining} jugadores en pie.`;
  $('#over-dialog').showModal();
}

/* ---------------- Interfaz ---------------- */

function dieHTML(v, cls = '') {
  if (!v) return `<div class="die hidden-die ${cls}">?</div>`;
  let cells = '';
  for (let k = 0; k < 9; k++) cells += `<span class="${PIPS[v].includes(k) ? 'pip' : ''}"></span>`;
  return `<div class="die face-${v} ${cls}">${cells}</div>`;
}

function revealClass(d) {
  if (!G.reveal) return '';
  return matches(d, G.reveal.face) ? 'match' : 'dim';
}

function log(html, cls = '') {
  const li = document.createElement('li');
  li.innerHTML = html;
  if (cls) li.className = cls;
  const ol = $('#log');
  ol.appendChild(li);
  ol.scrollTop = ol.scrollHeight;
}

// Ajusta el selector del humano a una apuesta mínima válida
function syncPicker() {
  const total = totalDice();
  if (minQty(G.bid, ui.f) > total) {
    ui.f = [2, 3, 4, 5, 6, 1].find((f) => minQty(G.bid, f) <= total) ?? 2;
  }
  ui.q = Math.min(total, minQty(G.bid, ui.f));
}

function render(rolled = false) {
  const reveal = G.phase === 'reveal';
  const rollCls = rolled ? 'roll' : '';

  // Rivales
  $('#opponents').innerHTML = G.players
    .map((p, i) => {
      if (p.human) return '';
      const cls = [
        G.phase === 'bidding' && i === G.current ? 'active' : '',
        p.count === 0 && !(reveal && G.reveal.loser === i) ? 'out' : '',
        reveal && G.reveal.loser === i ? 'loser' : '',
        reveal && G.reveal.winner === i ? 'winner' : '',
      ].join(' ');
      let dice = '';
      if (reveal) dice = p.dice.map((d) => dieHTML(d, `sm ${revealClass(d)}`)).join('');
      else dice = p.dice.map(() => dieHTML(0, `sm ${rollCls}`)).join('');
      const countTxt = p.count === 0 ? 'eliminado' : `${p.count} 🎲`;
      return `<div class="opp ${cls}">
        <div class="opp-head"><span>${esc(p.name)}</span><span class="muted">${countTxt}</span></div>
        <div class="dice-row">${dice}</div>
        <div class="bubble">${esc(p.last)}</div>
      </div>`;
    })
    .join('');

  // Apuesta actual
  const b = G.bid;
  $('#bid-display').innerHTML = b
    ? `<div class="label">Apuesta actual · de ${esc(G.players[b.by].name)}</div>
       <div class="bid-big"><span>${b.q}</span><span class="muted">×</span>${dieHTML(b.f)}</div>
       <div class="label">${b.q} ${faceName(b.f, b.q)} · ${reveal ? 'ronda terminada' : `${totalDice()} dados en juego`}</div>`
    : `<div class="label">Sin apuesta todavía</div>
       <div class="bid-big muted">—</div>
       <div class="label">${totalDice()} dados en juego</div>`;

  // Estado
  const cur = G.players[G.current];
  $('#status').innerHTML = reveal
    ? G.result
    : cur.human
      ? '<b>Tu turno.</b> Sube la apuesta, duda o calza.'
      : `${esc(cur.name)} está pensando…`;

  const next = $('#btn-next');
  next.classList.toggle('hidden', !reveal);
  next.textContent = G.over ? 'Ver resultado' : 'Siguiente ronda';

  // Jugador humano
  const me = G.players[0];
  $('#me-name').textContent = me.name;
  $('#me-count').textContent = me.count === 0 ? 'eliminado' : `${me.count} dado${me.count === 1 ? '' : 's'}`;
  $('#my-dice').innerHTML = me.dice.map((d) => dieHTML(d, reveal ? revealClass(d) : rollCls)).join('');
  const myTurn = G.phase === 'bidding' && G.current === 0 && me.count > 0;
  document.querySelector('.me').classList.toggle('active', myTurn);

  renderControls(myTurn);
}

function renderControls(enabled) {
  const total = totalDice();
  $('#controls').classList.toggle('disabled', !enabled);

  $('#face-picker').innerHTML = [1, 2, 3, 4, 5, 6]
    .map((f) => {
      const dis = minQty(G.bid, f) > total;
      return `<button data-face="${f}" class="${ui.f === f ? 'selected' : ''}" ${dis ? 'disabled' : ''}
        title="${FACE_NAMES[f][1]}">${dieHTML(f, 'sm')}</button>`;
    })
    .join('');

  $('#q-val').textContent = ui.q;
  $('#btn-bid').disabled = !isValidBid(G.bid, ui.q, ui.f);
  $('#btn-dudo').disabled = !G.bid;
  $('#btn-calzo').disabled = !G.bid;
  $('#q-minus').disabled = ui.q <= 1;
  $('#q-plus').disabled = ui.q >= total;

  let hint = '';
  if (enabled) {
    const m = minQty(G.bid, ui.f);
    hint = !G.bid
      ? 'Abres la ronda. No se puede abrir con ases.'
      : `Mínimo para ${FACE_NAMES[ui.f][1]}: ${m}`;
    if (ui.f === 1 && G.bid && G.bid.f !== 1) hint += ' (la mitad, por ser ases)';
    if (ui.f !== 1 && G.bid && G.bid.f === 1) hint += ' (el doble + 1, por salir de ases)';
  }
  $('#hint').textContent = hint;
}

/* ---------------- Eventos ---------------- */

function humanTurn() {
  return G && G.phase === 'bidding' && G.current === 0;
}

$('#btn-start').addEventListener('click', newGame);
$('#btn-next').addEventListener('click', nextRound);
$('#btn-rules').addEventListener('click', () => $('#rules-dialog').showModal());
$('#btn-again').addEventListener('click', () => {
  clearTimeout(botTimer);
  G = null;
  $('#game').classList.add('hidden');
  $('#setup').classList.remove('hidden');
});

$('#face-picker').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-face]');
  if (!btn || btn.disabled || !humanTurn()) return;
  ui.f = Number(btn.dataset.face);
  ui.q = Math.min(totalDice(), Math.max(ui.q, minQty(G.bid, ui.f)));
  renderControls(true);
});

$('#q-minus').addEventListener('click', () => {
  if (!humanTurn()) return;
  ui.q = Math.max(1, ui.q - 1);
  renderControls(true);
});
$('#q-plus').addEventListener('click', () => {
  if (!humanTurn()) return;
  ui.q = Math.min(totalDice(), ui.q + 1);
  renderControls(true);
});

$('#btn-bid').addEventListener('click', () => humanTurn() && placeBid(0, ui.q, ui.f));
$('#btn-dudo').addEventListener('click', () => humanTurn() && callDudo(0));
$('#btn-calzo').addEventListener('click', () => humanTurn() && callCalzo(0));

/* EMG Web — cliente.
 * Replica el comportamiento de la app de escritorio (PyQtGraph) en el navegador:
 * recibe raw + envolvente por WebSocket, dibuja con uPlot, y ofrece los mismos
 * controles (ventana, ganancia, toggles), cursores de medición y estado.
 */

// ---------- estado del stream ----------
let fs = 2000;
let windowMax = 20;
let cap = fs * windowMax;
let rawBuf = [];
let filtBuf = [];

// ---------- estado de UI ----------
let showRaw = true;
let showFilt = true;
let showCursors = true;
const cur = { t1: 1, t2: 2, y1: 100, y2: -100 };

// ---------- elementos ----------
const $ = (id) => document.getElementById(id);
const plotEl = $("plot");
const measureEl = $("measure");
const sldWindow = $("sld-window");
const sldGain = $("sld-gain");
const lblWindow = $("lbl-window");
const lblGain = $("lbl-gain");

// =================================================================
//  uPlot
// =================================================================
function drawV(u, ctx, val, color, L, T, W, H) {
  const x = u.valToPos(val, "x", true);
  if (x < L || x > L + W) return;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, T);
  ctx.lineTo(x, T + H);
  ctx.stroke();
}
function drawH(u, ctx, val, color, L, T, W, H) {
  const y = u.valToPos(val, "y", true);
  if (y < T || y > T + H) return;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(L, y);
  ctx.lineTo(L + W, y);
  ctx.stroke();
}
function drawCursors(u) {
  if (!showCursors) return;
  const ctx = u.ctx;
  const { left: L, top: T, width: W, height: H } = u.bbox;
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  drawV(u, ctx, cur.t1, "#00e5ff", L, T, W, H);
  drawV(u, ctx, cur.t2, "#ff4dff", L, T, W, H);
  drawH(u, ctx, cur.y1, "#2ee65a", L, T, W, H);
  drawH(u, ctx, cur.y2, "#ffd000", L, T, W, H);
  ctx.restore();
}

function plotSize() {
  return { width: plotEl.clientWidth, height: plotEl.clientHeight };
}

const opts = {
  ...plotSize(),
  pxAlign: false,
  cursor: { show: false, drag: { x: false, y: false } },
  legend: { show: false },
  scales: { x: { time: false }, y: { auto: true } },
  series: [
    {},
    { label: "Raw", stroke: "#ff3b3b", width: 1, points: { show: false }, show: true },
    { label: "Filtrada", stroke: "#ffd000", width: 1.6, points: { show: false }, show: true },
  ],
  axes: [
    {
      stroke: "#888",
      grid: { stroke: "#202020", width: 1 },
      ticks: { stroke: "#202020" },
      values: (u, vals) => vals.map((v) => v.toFixed(1) + "s"),
    },
    { stroke: "#888", grid: { stroke: "#202020", width: 1 }, ticks: { stroke: "#202020" } },
  ],
  plugins: [{ hooks: { draw: drawCursors } }],
};

const u = new uPlot(opts, [[0], [0], [0]], plotEl);

// =================================================================
//  Cursores arrastrables
// =================================================================
let dragging = null;
function pickCursor(offX, offY) {
  const cands = [
    { id: "t1", axis: "x", d: Math.abs(u.valToPos(cur.t1, "x") - offX) },
    { id: "t2", axis: "x", d: Math.abs(u.valToPos(cur.t2, "x") - offX) },
    { id: "y1", axis: "y", d: Math.abs(u.valToPos(cur.y1, "y") - offY) },
    { id: "y2", axis: "y", d: Math.abs(u.valToPos(cur.y2, "y") - offY) },
  ];
  cands.sort((a, b) => a.d - b.d);
  return cands[0].d <= 12 ? cands[0] : null;
}
u.over.addEventListener("mousedown", (e) => {
  if (!showCursors) return;
  const hit = pickCursor(e.offsetX, e.offsetY);
  if (hit) {
    dragging = hit;
    e.preventDefault();
  }
});
window.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  const rect = u.over.getBoundingClientRect();
  if (dragging.axis === "x") {
    cur[dragging.id] = u.posToVal(e.clientX - rect.left, "x");
  } else {
    cur[dragging.id] = u.posToVal(e.clientY - rect.top, "y");
  }
  updateMeasure();
  u.redraw(false);
});
window.addEventListener("mouseup", () => (dragging = null));

function updateMeasure() {
  const dt = Math.abs(cur.t2 - cur.t1);
  const dv = Math.abs(cur.y2 - cur.y1);
  measureEl.textContent = `Δt: ${dt.toFixed(4)} s  |  ΔV: ${dv.toFixed(2)}`;
}

// =================================================================
//  Render loop (igual al timer de 30 ms del original)
// =================================================================
function render() {
  const win = +sldWindow.value;
  const gain = +sldGain.value;
  lblWindow.textContent = win + " s";
  lblGain.textContent = "x" + gain;

  const n = Math.min(rawBuf.length, win * fs);
  if (n === 0) return;
  const start = rawBuf.length - n;
  const xs = new Array(n);
  const r = new Array(n);
  const f = new Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = i / fs;
    r[i] = rawBuf[start + i] * gain;
    f[i] = filtBuf[start + i] * gain;
  }
  u.setData([xs, r, f]);
}
setInterval(render, 30);
window.addEventListener("resize", () => u.setSize(plotSize()));

// =================================================================
//  Controles
// =================================================================
$("chk-raw").addEventListener("change", (e) => {
  showRaw = e.target.checked;
  u.setSeries(1, { show: showRaw });
});
$("chk-filt").addEventListener("change", (e) => {
  showFilt = e.target.checked;
  u.setSeries(2, { show: showFilt });
});
$("chk-cursors").addEventListener("change", (e) => {
  showCursors = e.target.checked;
  u.redraw(false);
});

// =================================================================
//  Badges de estado
// =================================================================
function setStatus(s) {
  const el = $("status-badge");
  el.textContent = s;
  el.className = "badge " + (s === "OK" ? "status-ok" : "status-bad");
}
function setLost(n) {
  $("lost-badge").textContent = "Perdidos: " + n;
}
function setMode(mode) {
  const el = $("mode-badge");
  if (mode === "udp") {
    el.textContent = "EN VIVO (ESP32)";
    el.className = "badge mode-udp";
    $("esp-hint").textContent = "Recibiendo del ESP32 por UDP (puerto 5005).";
  } else {
    el.textContent = "EMULADOR";
    el.className = "badge mode-fake";
    $("esp-hint").textContent = "Modo demo (señal sintética). Cambiá EMG_SOURCE=udp para el ESP32 real.";
  }
}

// =================================================================
//  WebSocket
// =================================================================
function pushChunk(buf, chunk) {
  for (let i = 0; i < chunk.length; i++) buf.push(chunk[i]);
  const ex = buf.length - cap;
  if (ex > 0) buf.splice(0, ex);
}

let ws = null;
let keepalive = null;
function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  const conn = $("conn-badge");

  ws.onopen = () => {
    conn.textContent = "WS: conectado";
    conn.className = "badge status-ok";
    keepalive = setInterval(() => {
      if (ws && ws.readyState === 1) ws.send("ping");
    }, 5000);
  };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === "init") {
      fs = m.fs;
      windowMax = m.window_max;
      cap = fs * windowMax;
      rawBuf = (m.raw || []).slice(-cap);
      filtBuf = (m.filt || []).slice(-cap);
      setMode(m.mode);
    } else if (m.type === "chunk") {
      if (m.raw && m.raw.length) {
        pushChunk(rawBuf, m.raw);
        pushChunk(filtBuf, m.filt);
      }
      setStatus(m.status);
      setLost(m.lost);
      setMode(m.mode);
    }
  };
  ws.onclose = () => {
    conn.textContent = "WS: reconectando…";
    conn.className = "badge status-bad";
    if (keepalive) clearInterval(keepalive);
    setTimeout(connect, 1500);
  };
  ws.onerror = () => ws.close();
}

updateMeasure();
connect();

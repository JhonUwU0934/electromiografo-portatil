/* ============================================================
   EMG WEB — Landing (motor de señal + interacciones)
   La traza es la heroína: ruido de baseline + ráfagas físicamente
   plausibles (nunca un seno limpio). Colores heredados del monitor.
   ============================================================ */
(function () {
  "use strict";
  const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const COL = { raw: "#ff3b3b", env: "#ffd000", grid: "rgba(255,255,255,0.05)", gridMaj: "rgba(255,255,255,0.12)" };

  // ---------- modelo de señal EMG ----------
  function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; }

  class Emg {
    constructor(o = {}) {
      this.n = o.n || 480;
      this.rest = o.rest != null ? o.rest : 0.12;
      this.burst = o.burst != null ? o.burst : 0.88;
      this.autoBurst = o.autoBurst !== false;
      this.spf = o.spf || 5;                 // samples por frame
      this.level = this.rest;
      this.target = this.rest;
      this.burstFrames = 0;
      this.nextAuto = 80 + Math.random() * 160;
      this.sustain = null;                   // 'reposo' | 'contraccion' | null
      this.raw = new Array(this.n).fill(0);
      this.env = new Array(this.n).fill(this.rest);
    }
    resize(n) {
      n = Math.max(160, n | 0);
      if (n === this.n) return;
      this.n = n;
      this.raw = new Array(n).fill(0);
      this.env = new Array(n).fill(this.level);
    }
    setMode(m) { this.sustain = m; }
    trigger(dur = 46) { this.target = this.burst; this.burstFrames = dur; }
    step() {
      for (let s = 0; s < this.spf; s++) {
        if (this.sustain === "contraccion") this.target = this.burst;
        else if (this.sustain === "reposo") this.target = this.rest;
        else {
          if (this.autoBurst && this.burstFrames <= 0) {
            if (--this.nextAuto <= 0) { this.trigger(44); this.nextAuto = 200 + Math.random() * 260; }
          }
          if (this.burstFrames > 0 && --this.burstFrames === 0) this.target = this.rest;
        }
        this.level += (this.target - this.level) * 0.06;
        const amp = this.rest * 0.45 + this.level;
        this.raw.push(gauss() * amp); this.raw.shift();
        this.env.push(this.level * (0.92 + Math.random() * 0.1)); this.env.shift();
      }
    }
    fillStatic() { for (let i = 0; i < 260; i++) this.step(); }   // snapshot para reduced-motion
  }

  // ---------- canvas helpers ----------
  function fit(canvas) {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.max(1, r.width * dpr);
    canvas.height = Math.max(1, r.height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: r.width, h: r.height, ctx };
  }
  // La retícula ahora es CSS (background del contenedor): cero costo por frame.
  function trace(ctx, data, w, h, color, baseFrac, ampFrac, glow) {
    const base = h * baseFrac;
    const n = data.length;
    ctx.lineJoin = "round";
    // glow barato: trazo ancho translúcido debajo (sin shadowBlur, que es lo caro)
    if (glow) {
      ctx.globalAlpha = 0.2; ctx.lineWidth = 4; ctx.strokeStyle = color;
      ctx.beginPath();
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * w, y = base - data[i] * h * ampFrac; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    ctx.lineWidth = 1.4; ctx.strokeStyle = color;
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * w, y = base - data[i] * h * ampFrac; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
    // leading dot sólido (sin shadowBlur)
    const ly = base - data[n - 1] * h * ampFrac;
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(w - 1, ly, 1.8, 0, Math.PI * 2); ctx.fill();
  }

  // ---------- scopes registrados ----------
  const scopes = [];
  function register(canvas, model, kind) {
    if (!canvas) return null;
    const s = { canvas, model, kind, dim: fit(canvas), visible: true };
    model.resize(Math.round(s.dim.w * 0.6));
    scopes.push(s);
    return s;
  }
  function render(s) {
    const { ctx, w, h } = s.dim;
    ctx.clearRect(0, 0, w, h);
    if (s.kind === "raw") {
      trace(ctx, s.model.raw, w, h, COL.raw, 0.5, 0.4, false);
    } else if (s.kind === "env") {
      trace(ctx, s.model.env, w, h, COL.env, 0.9, 0.78, true);
    } else { // both (hero / demo / cta)
      trace(ctx, s.model.raw, w, h, COL.raw, 0.5, 0.42, false);
      trace(ctx, s.model.env, w, h, COL.env, 0.74, 0.5, true);
    }
  }

  // ---------- modelos ----------
  const heroM = new Emg({ rest: 0.13, burst: 0.92, autoBurst: true, spf: 6 });
  const demoM = new Emg({ rest: 0.08, burst: 0.96, autoBurst: false, spf: 6 });
  const sigM = new Emg({ rest: 0.1, burst: 0.9, autoBurst: false, spf: 5 });
  const ctaM = new Emg({ rest: 0.12, burst: 0.82, autoBurst: true, spf: 5 });
  sigM.setMode("reposo");

  register(document.getElementById("hero-scope"), heroM, "both");
  register(document.getElementById("demo-scope"), demoM, "both");
  register(document.getElementById("lane-raw"), sigM, "raw");
  register(document.getElementById("lane-env"), sigM, "env");
  register(document.getElementById("cta-scope"), ctaM, "both");

  const models = [heroM, demoM, sigM, ctaM];

  // sólo animar/dibujar los canvases visibles (1-2 activos a la vez en vez de 5 siempre)
  const vio = new IntersectionObserver((ents) => {
    ents.forEach((e) => { const s = scopes.find((x) => x.canvas === e.target); if (s) s.visible = e.isIntersecting; });
  }, { rootMargin: "120px" });
  scopes.forEach((s) => vio.observe(s.canvas));

  // ---------- loop ----------
  function frame() {
    for (const m of models) m._vis = false;
    for (const s of scopes) if (s.visible) s.model._vis = true;
    for (const m of models) if (m._vis) m.step();
    for (const s of scopes) if (s.visible) render(s);
    requestAnimationFrame(frame);
  }
  if (REDUCE) {
    for (const m of models) m.fillStatic();
    for (const s of scopes) render(s);
  } else {
    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", () => {
    for (const s of scopes) { s.dim = fit(s.canvas); s.model.resize(Math.round(s.dim.w * 0.6)); }
    if (REDUCE) for (const s of scopes) render(s);
  });

  // ---------- interacciones ----------
  const flexBtn = document.getElementById("flex-btn");
  if (flexBtn) flexBtn.addEventListener("click", () => heroM.trigger(60));

  const demoBtn = document.getElementById("demo-btn");
  if (demoBtn) demoBtn.addEventListener("click", () => demoM.trigger(64));

  // toggle reposo / contracción
  const ampEl = document.getElementById("sig-amp");
  const stateEl = document.getElementById("sig-state");
  document.querySelectorAll(".sig-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".sig-tab").forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");
      const st = tab.dataset.state;
      sigM.setMode(st);
      if (st === "contraccion") { ampEl.innerHTML = "920<i>mV</i>"; stateEl.textContent = "CONTRACCIÓN"; }
      else { ampEl.innerHTML = "68<i>µV</i>"; stateEl.textContent = "REPOSO"; }
    });
  });

  // ---------- count-up ----------
  function fmt(n) { return Math.round(n).toLocaleString("es-ES"); }
  function countUp(el) {
    const target = +el.dataset.count;
    if (REDUCE) { el.textContent = fmt(target); return; }
    const dur = 1200, t0 = performance.now();
    (function tick(now) {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(target * e);
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  }

  // ---------- observers: reveal + count + pipeline pulse ----------
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add("in");
      en.target.querySelectorAll("[data-count]").forEach(countUp);
      if (en.target.querySelector(".pl-pulse")) runPulse();
      io.unobserve(en.target);
    });
  }, { threshold: 0.18 });
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
  // count-up también si la sección de cifras no tiene .reveal en el span
  document.querySelectorAll(".section").forEach((s) => { if (s.querySelector("[data-count]")) io.observe(s); });

  function runPulse() {
    const pulse = document.getElementById("pl-pulse");
    if (!pulse || REDUCE) return;
    let p = 0;
    (function move() {
      p += 0.012;
      if (p > 1) p = 0;
      pulse.style.left = (p * 100) + "%";
      requestAnimationFrame(move);
    })();
  }

  // ---------- loader ----------
  const loader = document.getElementById("loader");
  const num = document.getElementById("loader-num");
  const bar = document.querySelector(".loader-trace span");
  function endLoader() {
    if (!loader) return;
    loader.classList.add("done");
    setTimeout(() => loader.remove(), 600);
  }
  if (loader && !REDUCE) {
    let p = 0;
    const iv = setInterval(() => {
      p += Math.random() * 14 + 6;
      if (p >= 100) { p = 100; clearInterval(iv); setTimeout(endLoader, 220); }
      num.textContent = String(Math.floor(p)).padStart(3, "0");
      bar.style.width = p + "%";
    }, 90);
  } else {
    endLoader();
  }
})();

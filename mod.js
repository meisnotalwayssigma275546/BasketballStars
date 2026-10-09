(function () {
  "use strict";
  if (window.__bsMenu) return console.log("menu already loaded");
  const BIG = 9223372036854775807; // every stepper limit
  const wait = setInterval(() => {
    try {
      if (!window.__req || !window.__req.c || !document.body) return;
      const f = findClasses();
      if (f.player && f.main) { clearInterval(wait); start(f); }
    } catch (e) {}
  }, 500);

  // ---------- find the game's classes through the exposed module loader ----------
  function findClasses() {
    const out = { ai: [] }, seen = new Set();
    Object.values(__req.c).forEach((m) => {
      const ex = m && m.exports; if (!ex) return;
      Object.keys(ex).forEach((k) => {
        const v = ex[k], p = v && v.prototype; if (!p || seen.has(v)) return; seen.add(v);
        if (k === "ShieldObject") out.shield = v;
        else if (k === "Teleport") out.teleport = v;
        else if (k === "ObjectsData") out.data = v;
        else if (k === "PlayersData") out.pdata = v;
        else if (k === "Inventory") out.inv = v;
        else if (k === "AISkillsData") out.skills = v;
        else if (k === "AIController") out.aic = v;
        if ("makeAlleyOop" in p && p.hasOwnProperty("makeAlleyOop")) out.player = v;
        else if (p.hasOwnProperty("endOfTime")) out.main = v;
        else if (p.hasOwnProperty("calcDispersion")) out.ball = v;
        else if ("strategyAttack" in p) out.ai.push(v);
      });
    });
    return out;
  }

  function start(cls) {
    window.__bsMenu = true;
    const KEY = "bsmenu_v6", saved = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } })();
    const S = {
      time: false, cpu: false, cool: false, keys: false, cvc: false, acc: 100, dumb: false, dumbLvl: 60,
      dodge: false, dodgeRange: 110, tab: 0,
      ...(saved.s || {})
    };
    S.dodge = false;
    S.tab = S.tab === 1 ? 1 : 0;
    const soft = "cubic-bezier(.22,1,.36,1)";
    const players = new Map();

    const hook = (proto, name, make) => { const o = proto[name]; if (typeof o !== "function" || o.__bs) return; const f = make(o); f.__bs = true; proto[name] = f; };
    const gm = () => { try { return cls.inv.instance.matchData; } catch (e) { return null; } };
    const gc = () => cls.main.instance;
    const rand = (a, b) => a + Math.random() * (b - a);
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const livePlayers = () => [...players].filter(([p, t]) => performance.now() - t < 500).map(([p]) => p);
    const humans = () => livePlayers().filter((p) => p.isHuman).sort((a, b) => (a.playerNo || 0) - (b.playerNo || 0));
    const mineList = () => livePlayers().filter((p) => p.isHuman || p.__ai).sort((a, b) => (a.playerNo || 0) - (b.playerNo || 0));

    // ---------- CPU vs CPU: give each human's character to the game's own AI controller ----------
    const aiOn = (p) => {
      if (p.__ai || !p.isHuman || !cls.aic) return;
      const list = cls.skills && cls.skills.botsSkills;
      if (!list || !list.length) return;
      const d = list[list.length - 1]; // strongest behaviour; shot accuracy is controlled by the CPU accuracy setting
      const ctl = new cls.aic(p, p.superShot);
      ctl.init(d);
      ctl.opponent = ctl.opponents && ctl.opponents[0];
      ctl.restart(1);
      p.__humanCtl = p.controller; p.__ai = ctl;
      p.controller = ctl; p.isHuman = false;
    };
    const aiOff = (p) => {
      if (!p.__ai) return;
      try { p.__ai.dispose(); } catch (e) {}
      p.controller = p.__humanCtl; p.isHuman = true;
      p.__ai = null; p.__humanCtl = null;
    };

    // ---------- ball dodges the opponent ----------
    const dodge = (b) => {
      if (!S.dodge || !b || !b.body || !b.body.space || !b.body.position || !b.body.velocity) return;
      if (["inHands", "dunk", "score", "up"].indexOf(b.state) >= 0) return;
      const mine = mineList(); if (!mine.length) return;
      const side = mine[0].SIDE;
      if (b.state === "shooting" && b.SIDE !== side) return; // leave enemy shots alone
      const now = performance.now(); if (now - (b.__dt || 0) < 350) return;
      const bx = b.body.position.x, by = b.body.position.y, R = S.dodgeRange;
      for (const [p, t] of players) {
        if (now - t > 500 || p.SIDE === side || !p.body || !p.body.space || !p.body.position) continue;
        if (Math.hypot(p.body.position.x - bx, p.body.position.y - by) >= R) continue;
        let near = mine[0];
        mine.forEach((m) => { if (m.body && m.body.position && Math.abs(m.body.position.x - bx) < Math.abs(near.body.position.x - bx)) near = m; });
        let vx = Math.max(-520, Math.min(520, (near.body.position.x - bx) * 1.1));
        if (Math.abs(near.body.position.x - bx) < 30) vx = (bx < p.body.position.x ? -1 : 1) * 350;
        b.body.velocity.setxy(vx, -650); // hop over their head, toward your team
        b.__dt = now; break;
      }
    };

    // ---------- game hooks (read the switches live) ----------
    hook(cls.main.prototype, "update", (o) => function () { if (S.time && !this.isTraining) this.matchTime = Math.min(this.matchTime, 1); return o.apply(this, arguments); });
    hook(cls.main.prototype, "endOfTime", (o) => function () { if (S.time && !this.isTraining) return; return o.apply(this, arguments); });
    hook(cls.player.prototype, "update", (o) => function () {
      players.set(this, performance.now());
      try { if (S.cvc) aiOn(this); else aiOff(this); } catch (e) { console.warn("cpu vs cpu:", e); S.cvc = false; aiOff(this); }
      if (S.cool) { this.readyForSuper = true; }
      return o.apply(this, arguments);
    });
    // CPU accuracy: chance (%) that a shot by an AI-controlled character of yours is perfect
    let shooter = null;
    hook(cls.player.prototype, "makeThrow", (o) => function () { shooter = this; try { return o.apply(this, arguments); } finally { shooter = null; } });
    if (cls.ball) {
      hook(cls.ball.prototype, "calcDispersion", (o) => function () {
        const r = o.apply(this, arguments);
        if (shooter && shooter.__ai && r !== 1 && Math.random() < S.acc / 100) return 1;
        return r;
      });
      hook(cls.ball.prototype, "update", (o) => function () {
        try { dodge(this); } catch (e) {}
        return o.apply(this, arguments);
      });
    }

    // ---------- Dumb CPU + Disable CPU (computer opponents only, never your own AI character) ----------
    const CHANCES = ["chanceToRebound", "chanceToAvoidSteal", "chanceToMakePump", "chanceToReactOnCloseOpponent", "chanceToDash", "chanceToJumpWhenThrow", "chanceToUseSteal", "chanceToJumpWhenPump", "chanceToBlock"];
    const dumbDown = (c) => {
      const p = c.player; if (!p) return;
      const L = S.dumb ? Math.max(0, S.dumbLvl / 100) : 0;
      const Lc = Math.min(1, L);
      const o = c.__o || (c.__o = {});
      CHANCES.forEach((f) => { if (typeof c[f] !== "number" && o[f] === undefined) return; if (o[f] === undefined) o[f] = c[f]; c[f] = o[f] * (1 - Lc); });
      if (p.__acc0 === undefined) { p.__acc0 = p.accuracy; p.__dunk0 = p.chanceToCompleteDunk; }
      p.accuracy = p.__acc0 + 0.3 * L;
      p.chanceToCompleteDunk = p.__dunk0 * (1 - Lc);
    };
    const idle = (c) => { c.currentMove = 0; c.currentDash = 0; c.currentJump = false; c.currentAction = false; c.currentSuper = false; c.currentBlockOrPump = false; };
    cls.ai.forEach((C) => {
      if (!C.prototype.hasOwnProperty("update")) return;
      hook(C.prototype, "update", (o) => function () {
        const mine = this.player && this.player.__ai === this;
        if (!mine) {
          try { dumbDown(this); } catch (e) {}
          if (S.cpu) { idle(this); return; }
        }
        return o.apply(this, arguments);
      });
    });

    // ---------- power keys ----------
    const POWERS = { alley: 2, mega: 0, defense: 1, fast: 3 };
    const KEYS = { 1: { KeyF: "alley", KeyE: "mega", KeyQ: "defense", KeyC: "fast" }, 2: { KeyJ: "alley", KeyI: "mega", KeyU: "defense", KeyM: "fast" } };
    const prepare = (p, id) => {
      if (id === 1 && !p.shield && cls.shield) p.shield = new cls.shield(p.SIDE);
      if ((id === 0 || id === 2) && !p.teleport && cls.teleport) p.teleport = new cls.teleport();
      if (id === 3) {
        if (!Array.isArray(p.dashOpponents)) p.dashOpponents = [];
        if (p.teamMate === undefined || p.teamMate === null) {
          try { p.teamMate = p.gamecore.getTeamMate(p.playerNo) || null; } catch (e) { p.teamMate = null; }
        }
        if (!p.opponents && p.gamecore) p.opponents = p.SIDE === 1 ? p.gamecore.playersLeft : p.gamecore.playersRight;
      }
    };
    const fire = (p, power) => {
      if (!p || typeof p.superShot !== "function") return false;
      const id = POWERS[power], old = p.superID;
      try {
        prepare(p, id);
        p.superID = id; p.readyForSuper = true;
        if (p.gamecore) p.gamecore.isSuperShot = false;
        if ((id === 0 || id === 2) && !p.withBall) p.withBall = true;
        return p.superShot(true);
      } catch (e) {
        console.warn("power failed:", power, e);
        p.isSuperShot = false; if (p.gamecore) p.gamecore.isSuperShot = false; p.canAct = true;
        return false;
      } finally { p.superID = old; }
    };
    window.addEventListener("keydown", (e) => {
      if (!S.keys || e.repeat) return;
      const tg = e.composedPath()[0]; if (tg && /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName)) return;
      const h = humans();
      for (const side of [1, 2]) {
        const power = KEYS[side][e.code]; if (!power) continue;
        const p = h[side - 1] || h[0];
        const ok = fire(p, power); say(power + " (P" + side + ") " + (ok ? "fired" : "could not fire right now"));
      }
    }, true);


    // ---------- UI ----------
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;top:40px;left:12px;z-index:2147483647;";
    ["mousedown","mouseup","mousemove","click","dblclick","touchstart","touchmove","touchend","pointerdown","pointermove","pointerup","wheel","contextmenu","keydown","keyup","keypress","input","change"]
      .forEach((ev) => host.addEventListener(ev, (e) => e.stopPropagation()));
    const root = host.attachShadow({ mode: "open" });
    const MONO = "ui-monospace,Menlo,Consolas,monospace";
    const css = `
.p{width:340px;color:#000;font:13px -apple-system,system-ui,sans-serif;border-radius:30px;background:linear-gradient(135deg,rgba(255,255,255,.4),rgba(255,255,255,.15));-webkit-backdrop-filter:blur(16px) saturate(180%);backdrop-filter:blur(16px) saturate(180%);box-shadow:0 18px 50px rgba(0,0,0,.35),inset 0 0 0 1px rgba(255,255,255,.4),inset 0 1px 1px rgba(255,255,255,.8);user-select:none;overflow:hidden}
.h{padding:14px 18px 8px;display:flex;justify-content:space-between;align-items:center;cursor:grab;touch-action:none;font-weight:700;font-size:15px}
.min{width:28px;height:28px;border-radius:50%;border:1px solid rgba(255,255,255,.6);background:rgba(255,255,255,.4);color:#000;cursor:pointer;padding:0}
.b{padding:2px 14px 14px;display:flex;flex-direction:column;gap:9px;max-height:calc(100vh - 110px);overflow-y:auto}.b.hide{display:none}
.tabs{position:relative;display:flex;padding:3px;border-radius:18px;background:rgba(0,0,0,.12)}
.ind{position:absolute;top:3px;bottom:3px;left:3px;width:calc((100% - 6px) / 2);border-radius:15px;background:rgba(255,255,255,.75);box-shadow:0 2px 8px rgba(0,0,0,.15);transition:transform .5s ${soft}}
.tabs.t1 .ind{transform:translateX(100%)}
.tab{flex:1;text-align:center;padding:8px 0;font-weight:600;font-size:12px;border-radius:15px;cursor:pointer;position:relative;z-index:1;opacity:.65;transition:opacity .3s}.tab.on{opacity:1}
.pg{display:flex;flex-direction:column;gap:9px}.pg.hide{display:none}
.card{background:rgba(255,255,255,.35);border-radius:22px;padding:10px 12px;box-shadow:inset 0 1px 1px rgba(255,255,255,.8)}
.card h4{margin:0 0 8px;font-size:12px;opacity:.65;font-weight:700;letter-spacing:.3px;text-transform:uppercase}
.row{display:flex;align-items:center;justify-content:space-between;gap:10px}.card .row+.row{margin-top:9px}
.lbl{font-weight:600;min-width:0}.lbl small{display:block;opacity:.6;font-size:11px;font-weight:400}
.sw{width:48px;height:28px;border-radius:14px;background:rgba(0,0,0,.2);position:relative;cursor:pointer;transition:background .3s;flex:none}
.sw i{position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:11px;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.35);transition:transform .4s ${soft}}
.sw.on{background:rgba(52,199,89,.9)}.sw.on i{transform:translateX(20px)}
.step{display:flex;align-items:center;gap:2px;background:rgba(0,0,0,.12);border-radius:15px;padding:3px;flex:none}
.step button{width:27px;height:27px;border:0;border-radius:12px;background:rgba(255,255,255,.7);color:#000;font-size:16px;cursor:pointer;padding:0}.step button:active{transform:scale(.9)}
.step input{width:92px;text-align:center;background:transparent;border:0;font:700 12px -apple-system,system-ui,sans-serif;outline:none;padding:0;color:#000;user-select:text;-webkit-user-select:text}
.keys{font-size:11.5px;line-height:1.5}.keys b{display:inline-block;min-width:16px;text-align:center;background:rgba(255,255,255,.75);border-radius:6px;padding:0 4px;margin-right:3px}
.status{font:11px ${MONO};opacity:.8;min-height:13px;padding:0 5px;word-break:break-word}
.sel{width:100%;box-sizing:border-box;height:30px;background:rgba(0,0,0,.14);border:0;border-radius:13px;color:#000;padding:0 10px;font:12.5px -apple-system,system-ui,sans-serif;outline:none;user-select:text;-webkit-user-select:text}
.btns{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.rbtn{border:0;border-radius:14px;padding:0 12px;height:28px;background:rgba(255,255,255,.7);color:#000;font:600 12px -apple-system,system-ui,sans-serif;cursor:pointer}.rbtn:active{transform:scale(.94)}
.crumb{font:11px ${MONO};opacity:.7;margin-top:8px;word-break:break-all}
.tbl{max-height:290px;overflow-y:auto;border-radius:16px;background:rgba(0,0,0,.14);margin-top:8px}
.tbl::-webkit-scrollbar{width:6px}.tbl::-webkit-scrollbar-thumb{background:rgba(255,255,255,.5);border-radius:3px}
.tr{min-height:30px;box-sizing:border-box;display:flex;align-items:center;gap:6px;padding:3px 8px;border-bottom:1px solid rgba(255,255,255,.25)}
.nm{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font:11px ${MONO}}
.nm i{font-style:normal;opacity:.55;margin-left:6px;font:10px -apple-system,system-ui,sans-serif}
.tr input{width:96px;flex:none;box-sizing:border-box;background:rgba(255,255,255,.55);border:0;border-radius:8px;padding:4px 7px;color:#000;font:600 11px ${MONO};outline:none;text-align:right;user-select:text;-webkit-user-select:text}
.tr input[readonly]{opacity:.6}
.go{border:0;background:rgba(255,255,255,.7);color:#000;border-radius:8px;width:24px;height:22px;cursor:pointer;padding:0;flex:none}
.empty{padding:16px;text-align:center;opacity:.6;font-size:12px}`;
    const el = (tag, props, kids) => { const n = document.createElement(tag); if (props) Object.assign(n, props); (kids || []).forEach((k) => n.appendChild(k)); return n; };
    const txt = (s) => document.createTextNode(s);
    const status = el("div", { className: "status", textContent: "ready" });
    const say = (t) => { status.textContent = t; };
    const rowOf = (t, sub, ctl) => el("div", { className: "row" }, [el("div", { className: "lbl" }, [txt(t), el("small", { textContent: sub })]), ctl]);
    const sw = (k, label, extra) => { const s = el("div", { className: "sw" + (S[k] ? " on" : "") }, [el("i")]); s.onclick = () => { S[k] = !S[k]; s.classList.toggle("on", S[k]); say(label + (S[k] ? " ON" : " OFF")); if (extra) extra(S[k]); }; return s; };
    const btn = (label, fn) => { const b = el("button", { className: "rbtn", textContent: label }); b.onclick = () => { try { fn(); } catch (e) { say(String(e.message || e)); } }; return b; };
    const stepper = (init, min, max, step, onSet) => {
      const input = el("input", { type: "text", inputMode: "numeric", value: init });
      const minus = el("button", { textContent: "−" }), plus = el("button", { textContent: "+" });
      const wrap = el("div", { className: "step" }, [minus, input, plus]);
      const set = (v, user) => { v = +v; if (!isFinite(v)) v = min; v = Math.min(max, Math.max(min, Math.round(v / step) * step)); input.value = v; onSet(v, user); };
      input.onchange = () => set(input.value, true);
      input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
      minus.onclick = () => set(+input.value - step, true);
      plus.onclick = () => set(+input.value + step, true);
      const sync = (v) => { if (root.activeElement === input || typeof v !== "number" || !isFinite(v)) return; if (String(v) !== input.value) input.value = v; };
      return { wrap, input, set, sync };
    };

    // ===== General tab =====
    const keysHelp = el("div", { className: "keys" });
    keysHelp.innerHTML = "<div><b>F</b>Alley-oop <b>E</b>Mega dunk <b>Q</b>Defense <b>C</b>Fast break &nbsp;(P1)</div><div><b>J</b>Alley-oop <b>I</b>Mega dunk <b>U</b>Defense <b>M</b>Fast break &nbsp;(P2)</div>";
    const accStep = stepper(S.acc, 0, BIG, 5, (v, user) => { S.acc = v; if (user) say("CPU accuracy " + v + "%"); });
    const dumbStep = stepper(S.dumbLvl, 0, BIG, 5, (v, user) => { S.dumbLvl = v; if (user) say("dumbness " + v + "%"); });
    const general = el("div", { className: "card" }, [
      rowOf("No time limit", "the clock never runs out", sw("time", "No time limit")),
      rowOf("Disable CPU", "computer players stand still", sw("cpu", "Disable CPU")),
      rowOf("No cooldowns", "super is always ready", sw("cool", "No cooldowns")),
      rowOf("Power keys", "use any power on a key", sw("keys", "Power keys")),
      keysHelp
    ]);
    const cpuCard = el("div", { className: "card" }, [
      rowOf("CPU vs CPU", "an AI plays your character(s)", sw("cvc", "CPU vs CPU")),
      rowOf("CPU accuracy", "% of its shots that are perfect", accStep.wrap),
      rowOf("Dumb CPU", "opponents miss, fumble, react late", sw("dumb", "Dumb CPU")),
      rowOf("Dumbness", "% how bad they are", dumbStep.wrap)
    ]);
    const s1 = stepper(0, 0, BIG, 1, (v, user) => { if (user) setScore(0, v); });
    const s2 = stepper(0, 0, BIG, 1, (v, user) => { if (user) setScore(1, v); });
    const setScore = (i, v) => {
      const m = gm(); if (!m || !m.matchScore) return say("start a match first");
      m.matchScore[i] = v;
      const g = gc(); if (g && g.infoPanel) g.infoPanel.updateScore(m.matchScore[0], m.matchScore[1]);
      say("score " + m.matchScore[0] + " : " + m.matchScore[1]);
    };
    const scoreCard = el("div", { className: "card" }, [
      el("h4", { textContent: "Score editor" }),
      rowOf("Left score", "first number on the board", s1.wrap),
      rowOf("Right score", "second number", s2.wrap),
      el("div", { className: "btns" }, [
        btn("+10 left", () => setScore(0, ((gm() || {}).matchScore || [0])[0] + 10)),
        btn("+10 right", () => setScore(1, ((gm() || {}).matchScore || [0, 0])[1] + 10)),
        btn("Swap", () => { const m = gm(); if (!m) return; const a = m.matchScore[0]; m.matchScore[0] = m.matchScore[1]; m.matchScore[1] = a; setScore(0, m.matchScore[0]); }),
        btn("0 : 0", () => { setScore(1, 0); setScore(0, 0); })
      ])
    ]);
    const page0 = el("div", { className: "pg" }, [general, cpuCard, scoreCard]);

    const dodgeStep = stepper(S.dodgeRange, 1, BIG, 10, (v, user) => { S.dodgeRange = v; if (user) say("dodge range " + v + "px"); });
    const dodgeCard = el("div", { className: "card" }, [
      el("h4", { textContent: "Ball" }),
      rowOf("Ball dodges opponents", "hops over them toward your team", sw("dodge", "Ball dodges opponents")),
      rowOf("Dodge range", "pixels", dodgeStep.wrap)
    ]);
    const cloneInfo = () => { pruneClones(); say(clones.length + " clone(s) on court"); };
    const cloneCard = el("div", { className: "card" }, [
      el("h4", { textContent: "Clone army" }),
      el("div", { className: "btns", style: "margin-top:0" }, [
        btn("+1 my team", () => { spawnClone(teamOf(0, false)); cloneInfo(); }),
        btn("+1 enemy", () => { spawnClone(teamOf(0, true)); cloneInfo(); }),
        btn("+3 each", () => { for (let i = 0; i < 3; i++) { spawnClone(teamOf(0, false)); spawnClone(teamOf(0, true)); } cloneInfo(); }),
        btn("Clear clones", () => { pruneClones(); const n = clones.length; clones.slice().forEach(removeClone); clones = []; say("removed " + n + " clone(s)"); })
      ])
    ]);
    page0.appendChild(dodgeCard);
    page0.appendChild(cloneCard);

    // ===== Advanced tab: every property of live game objects, editable =====
    const targets = [
      ["Your player 1", () => mineList()[0]],
      ["Your player 2", () => mineList()[1]],
      ["CPU player", () => livePlayers().find((p) => !p.isHuman && !p.__ai && !p.__clone)],
      ["Ball", () => gc() && gc().ball],
      ["Match (game core)", () => gc() || (livePlayers()[0] && livePlayers()[0].gamecore)],
      ["Match data (scores, teams)", () => gm()],
      ["ObjectsData (constants)", () => cls.data],
      ["PlayersData (characters)", () => cls.pdata],
      ["AISkillsData (CPU levels)", () => cls.skills]
    ];
    const targetSel = el("select", { className: "sel" });
    targets.forEach((t, i) => targetSel.appendChild(el("option", { value: i, textContent: t[0] })));
    const filter = el("input", { type: "text", placeholder: "filter by name (speed, jump, super...)", className: "sel" });
    filter.addEventListener("keydown", (e) => e.stopPropagation());
    const crumb = el("div", { className: "crumb" });
    const table = el("div", { className: "tbl" });
    let cur = null, stack = [], rowsLive = [];
    const ctorName = (v) => { try { return (v.constructor && v.constructor.name) || "Object"; } catch (e) { return "Object"; } };
    const fmtv = (v) => {
      if (v === null) return "null";
      if (v === undefined) return "undefined";
      if (typeof v === "number") return String(Math.round(v * 10000) / 10000);
      if (typeof v === "boolean") return String(v);
      if (typeof v === "string") return v.length > 60 ? v.slice(0, 60) + "…" : v;
      if (Array.isArray(v)) return "Array(" + v.length + ")";
      return "{" + ctorName(v) + "}";
    };
    const tname = (v) => v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "object" ? ctorName(v) : typeof v;
    const draw = () => {
      table.innerHTML = ""; rowsLive = [];
      crumb.textContent = cur ? stack.map((s) => s.label).concat(cur.label).join(" › ") : "";
      if (!cur || !cur.obj) { table.appendChild(el("div", { className: "empty", textContent: "nothing to show - start a match first, then press Load" })); return; }
      let keys = []; try { keys = Object.keys(cur.obj); } catch (e) {}
      const q = filter.value.trim().toLowerCase();
      let n = 0, total = 0;
      for (const k of keys) {
        if (q && k.toLowerCase().indexOf(q) < 0) continue;
        let v; try { v = cur.obj[k]; } catch (e) { continue; }
        if (typeof v === "function") continue;
        total++; if (n >= 400) continue; n++;
        const prim = v === null || v === undefined || ["number", "boolean", "string"].indexOf(typeof v) >= 0;
        const editable = typeof v === "number" || typeof v === "boolean" || typeof v === "string";
        const nm = el("div", { className: "nm", title: k }, [txt(k), el("i", { textContent: tname(v) })]);
        const inp = el("input", { type: "text", value: fmtv(v), readOnly: !editable, spellcheck: false });
        inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") inp.blur(); });
        inp.onchange = () => {
          try {
            const old = cur.obj[k], t = inp.value.trim();
            let x;
            if (typeof old === "boolean") x = t === "true" || t === "1";
            else if (typeof old === "number") { x = parseFloat(t); if (!isFinite(x)) { inp.value = fmtv(old); return; } }
            else x = inp.value;
            cur.obj[k] = x; say(cur.label + "." + k + " = " + x);
          } catch (e) { say(String(e.message || e)); }
        };
        const kids = [nm, inp];
        if (!prim && typeof v === "object") {
          const go = el("button", { className: "go", textContent: "→", title: "open" });
          go.onclick = () => { stack.push(cur); cur = { label: k, obj: v }; draw(); };
          kids.push(go);
        }
        table.appendChild(el("div", { className: "tr" }, kids));
        if (prim) rowsLive.push({ k, inp });
      }
      if (!n) table.appendChild(el("div", { className: "empty", textContent: "no matching properties" }));
      say(n + " of " + keys.length + " properties" + (total > 400 ? " (first 400 shown, use the filter)" : ""));
    };
    const load = () => {
      const t = targets[+targetSel.value];
      let o; try { o = t[1](); } catch (e) { o = null; }
      stack = []; cur = o ? { label: t[0], obj: o } : null; draw();
    };
    targetSel.onchange = load;
    filter.oninput = draw;
    const backBtn = btn("◀ Back", () => { if (stack.length) { cur = stack.pop(); draw(); } });
    const adv = el("div", { className: "card" }, [targetSel, el("div", { style: "height:8px" }), filter,
      el("div", { className: "btns" }, [btn("Load", load), backBtn, btn("Refresh", draw)]), crumb, table]);
    const page2 = el("div", { className: "pg hide" }, [adv]);

    // ===== tab bar =====
    const tabNames = ["General", "Advanced"];
    const tabEls = tabNames.map((n, i) => { const t = el("div", { className: "tab", textContent: n }); t.onclick = () => setTab(i); return t; });
    const tabs = el("div", { className: "tabs" }, [el("div", { className: "ind" }), ...tabEls]);
    const pages = [page0, page2];
    const setTab = (i) => {
      i = i === 1 ? 1 : 0;
      S.tab = i;
      tabs.classList.toggle("t1", i === 1);
      tabEls.forEach((t, j) => t.classList.toggle("on", j === i));
      pages.forEach((p, j) => p.classList.toggle("hide", j !== i));
      if (i === 1 && !cur) load();
    };

    const minBtn = el("button", { className: "min", textContent: "–" });
    const head = el("div", { className: "h" }, [el("span", { textContent: "Basketball Legends" }), minBtn]);
    const body = el("div", { className: "b" }, [tabs, page0, page2, status]);
    const panel = el("div", { className: "p" }, [head, body]);
    root.appendChild(el("style", { textContent: css })); root.appendChild(panel); document.body.appendChild(host);
    setTab(S.tab === 1 ? 1 : 0);

    // live values: score boxes + Advanced rows (skips the box you're typing in)
    setInterval(() => {
      if (body.classList.contains("hide")) return;
      try {
        if (S.tab === 0) { const m = gm(); if (m && m.matchScore) { s1.sync(m.matchScore[0]); s2.sync(m.matchScore[1]); } }
        else if (S.tab === 1 && cur) rowsLive.forEach(({ k, inp }) => {
          if (root.activeElement === inp) return;
          const t = fmtv(cur.obj[k]); if (inp.value !== t) inp.value = t;
        });
      } catch (e) {}
    }, 600);

    // direct dragging + position memory
    const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
    if (saved.pos) { host.style.left = saved.pos.l + "px"; host.style.top = saved.pos.t + "px"; }
    if (saved.min) body.classList.add("hide");
    let drag = false, ox = 0, oy = 0;
    head.addEventListener("pointerdown", (e) => { if (e.target === minBtn) return; drag = true; ox = e.clientX - host.offsetLeft; oy = e.clientY - host.offsetTop; head.setPointerCapture(e.pointerId); });
    head.addEventListener("pointermove", (e) => { if (!drag) return; host.style.left = clamp(e.clientX - ox, 0, Math.max(0, innerWidth - host.offsetWidth)) + "px"; host.style.top = clamp(e.clientY - oy, 0, Math.max(0, innerHeight - host.offsetHeight)) + "px"; });
    head.addEventListener("pointerup", () => { drag = false; });
    minBtn.onclick = () => body.classList.toggle("hide");
    setInterval(() => { try { localStorage.setItem(KEY, JSON.stringify({ s: S, pos: { l: host.offsetLeft, t: host.offsetTop }, min: body.classList.contains("hide") })); } catch (e) {} }, 2000);
    window.__BS = { S, players, fire, cls, spawnClone, removeClone, get clones() { return clones.slice(); } };
    console.log("Basketball Legends menu loaded");
  }
})();
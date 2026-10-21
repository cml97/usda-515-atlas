/* Prime Chase: a chase game played on the Map page.

   Every property in view is a dot to collect. Four pieces of Red Tape chase
   the Prime shield around the map. The bigger dots are properties whose
   program exit is within five years, and grabbing one sends the Red Tape
   running for a few seconds, which is when it can be caught.

   It opens from the Games buttons behind the Konami code, or straight from
   map.html#prime-chase. It reads the map and the dots map.js has drawn
   through window.AtlasMap, freezes the map where it is, and lays a canvas
   over it. Quitting puts everything back the way it was. */

window.PrimeChase = (() => {
  const C = {
    navy: "#081937", seafoam: "#3b7f83", slate: "#5a5c65", paper: "#ffffff",
    tape: "#b4483c", scared: "#9fb6d6", dot: "#081937", hud: "rgba(8,25,55,.88)",
  };
  const BEST_KEY = "atlas.primechase.best";
  const MAX_DOTS = 420;
  const CELL = 16;          // one dot per cell, so dots never sit on top of each other
  const PLAYER_R = 13;      // the shield's drawn radius, and its reach for dots
  const DOT_R = 3, POWER_R = 6.5;

  /* Five rounds. Each brings one more piece of Red Tape, a little more speed,
     and a shorter scare when you grab a big dot. */
  const LEVELS = [
    { tape: 4, speed: 1.55, power: 6000 },
    { tape: 5, speed: 1.75, power: 5500 },
    { tape: 6, speed: 1.95, power: 5000 },
    { tape: 7, speed: 2.15, power: 4500 },
    { tape: 8, speed: 2.35, power: 4000 },
  ];
  const ROUNDS = LEVELS.length;
  const lv = (n) => LEVELS[Math.min(n || state.level, ROUNDS) - 1];
  const TOP = 30;           // the score bar; the board starts under it

  /* The board wraps on all four sides: run off one edge and come back on the
     opposite one. Positions wrap, and anything measuring a distance takes the
     short way round, so the Red Tape follows you through the edge too. */
  const FH = () => H - TOP;
  const wrapX = (x) => ((x % W) + W) % W;
  const wrapY = (y) => TOP + ((((y - TOP) % FH()) + FH()) % FH());
  function delta(ax, ay, bx, by) {
    let dx = bx - ax, dy = by - ay;
    if (dx > W / 2) dx -= W; else if (dx < -W / 2) dx += W;
    if (dy > FH() / 2) dy -= FH(); else if (dy < -FH() / 2) dy += FH();
    return [dx, dy];
  }
  const dist = (a, b) => Math.hypot(...delta(a.x, a.y, b.x, b.y));
  /* Distance from a point to the segment the shield moved along this frame. */
  function segDist(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay;
    const len2 = vx * vx + vy * vy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2)) : 0;
    return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
  }

  let map = null, host = null, canvas = null, ctx = null, W = 0, H = 0, dpr = 1;
  let running = false, raf = 0, last = 0, keyHandler = null, touchStart = null;
  let state = null;

  /* -------------------------------------------------------------- setup */

  function freeze(on) {
    const h = ["dragging", "touchZoom", "doubleClickZoom", "scrollWheelZoom", "boxZoom", "keyboard"];
    h.forEach((k) => { if (map[k]) (on ? map[k].disable() : map[k].enable()); });
    // The clusters, pins and overlays come off while playing, so the board
    // is the dots the game drew and nothing else.
    host.classList.toggle("chasing", on);
  }

  function bestScore() {
    try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch (e) { return 0; }
  }
  function saveBest(n) {
    try { if (n > bestScore()) localStorage.setItem(BEST_KEY, String(n)); } catch (e) { /* private window */ }
  }

  /* The properties in view, as screen points, thinned to one per cell. */
  function collectDots() {
    const pts = (window.AtlasMap && window.AtlasMap.points) || [];
    const size = map.getSize();
    const seen = new Map();
    const thisYear = new Date().getFullYear();
    pts.forEach((r) => {
      const p = map.latLngToContainerPoint([r.lat, r.lon]);
      if (p.x < 14 || p.y < 40 || p.x > size.x - 14 || p.y > size.y - 14) return;
      const key = `${Math.floor(p.x / CELL)}:${Math.floor(p.y / CELL)}`;
      const near = r.exit_year && r.exit_year - thisYear >= 0 && r.exit_year - thisYear <= 5;
      const prev = seen.get(key);
      // Within a cell, an exiting property wins, then the bigger one.
      if (!prev || (near && !prev.power) || (near === prev.power && (r.units || 0) > (prev.units || 0))) {
        seen.set(key, { x: p.x, y: p.y, name: r.name, city: r.city, state: r.state,
          units: r.units || 0, power: Boolean(near), eaten: false });
      }
    });
    let dots = [...seen.values()];
    if (dots.length > MAX_DOTS) {
      // Too many to play with: keep every exiting one, sample the rest evenly.
      const power = dots.filter((d) => d.power);
      const rest = dots.filter((d) => !d.power);
      const step = rest.length / Math.max(1, MAX_DOTS - Math.min(power.length, 12));
      const kept = [];
      for (let i = 0; i < rest.length; i += step) kept.push(rest[Math.floor(i)]);
      dots = [...power.slice(0, 12), ...kept];
    }
    // Power dots are the reward, so cap them; the rest revert to plain dots.
    let powers = dots.filter((d) => d.power).sort((a, b) => b.units - a.units);
    powers.slice(6).forEach((d) => { d.power = false; });
    if (!powers.length && dots.length > 8) {
      // Nothing exiting soon in view: promote the four largest so the game
      // still has a way to turn the tables.
      [...dots].sort((a, b) => b.units - a.units).slice(0, 4).forEach((d) => { d.power = true; });
    }
    return dots;
  }

  function newChasers(level) {
    const pad = 30, midY = (TOP + H) / 2;
    // Corners first, then the middle of each edge, as the rounds add more.
    const spots = [[pad, 60], [W - pad, 60], [pad, H - pad], [W - pad, H - pad],
      [W / 2, 60], [W / 2, H - pad], [pad, midY], [W - pad, midY]];
    const L = lv(level);
    return spots.slice(0, L.tape).map(([x, y], i) => ({
      x, y, home: { x, y }, vx: 0, vy: 0, mode: i % 4, // 0 chase, 1 ahead, 2 flank, 3 wander
      speed: L.speed + (i % 4) * 0.06, eaten: 0, wander: { x: W / 2, y: H / 2, until: 0 },
    }));
  }

  function resetPositions() {
    state.player = { x: W / 2, y: H / 2, dir: { x: 0, y: 0 }, want: { x: 0, y: 0 }, r: PLAYER_R, chomp: 0 };
    state.chasers = newChasers(state.level);
    state.scaredUntil = 0;
    state.pauseUntil = performance.now() + 900;
  }

  /* --------------------------------------------------------------- loop */

  function step(now) {
    if (!running) return;
    const dt = Math.min(2.5, (now - last) / 16.67 || 1);
    last = now;
    if (state.phase === "play" && now >= state.pauseUntil) update(dt, now);
    // The congratulations screen moves on to the next round by itself.
    if (state.phase === "cleared" && now - state.clearedAt > 4000) nextRound();
    if (state.confetti) state.confetti.forEach((c) => { c.y += c.vy * dt; c.x += Math.sin((now + c.seed) / 300) * 0.6; c.rot += c.spin * dt; });
    draw(now);
    raf = requestAnimationFrame(step);
  }

  function update(dt, now) {
    const p = state.player;
    // Turn as soon as a direction is pressed; the field is open, so any turn is legal.
    if (p.want.x || p.want.y) p.dir = { ...p.want };
    const speed = 2.9;
    const fromX = p.x, fromY = p.y;
    p.x = wrapX(p.x + p.dir.x * speed * dt);
    p.y = wrapY(p.y + p.dir.y * speed * dt);
    // The path this frame, for the dot check. A frame that wrapped round an
    // edge is checked at its end point only.
    const wrapped = Math.abs(p.x - fromX) > W / 2 || Math.abs(p.y - fromY) > FH() / 2;
    if (p.dir.x || p.dir.y) p.chomp += 0.25 * dt;

    // Dots. A dot counts once the shield actually covers it: its center
    // inside the shield's circle, give or take the dot's own radius. Checked
    // along the whole step, so a fast frame cannot hop over one.
    for (const d of state.dots) {
      if (d.eaten) continue;
      const reach = PLAYER_R + (d.power ? POWER_R : DOT_R) * 0.5;
      const near = wrapped ? dist(d, p) : segDist(d.x, d.y, fromX, fromY, p.x, p.y);
      if (near <= reach) {
        d.eaten = true;
        state.left -= 1;
        state.units += d.units || 0;
        state.score += d.power ? 50 : 10;
        state.last = d;
        if (d.power) { state.scaredUntil = now + lv().power; state.combo = 0; }
      }
    }
    if (state.left <= 0) { finish(true); return; }

    // Red Tape.
    const scared = now < state.scaredUntil;
    for (const c of state.chasers) {
      if (c.eaten && now < c.eaten) continue;
      if (c.eaten) { c.eaten = 0; c.x = c.home.x; c.y = c.home.y; }
      let tx, ty;
      if (scared) {
        tx = c.x + (c.x - p.x); ty = c.y + (c.y - p.y);
      } else if (c.mode === 0) {
        tx = p.x; ty = p.y;
      } else if (c.mode === 1) {
        tx = p.x + p.dir.x * 70; ty = p.y + p.dir.y * 70;
      } else if (c.mode === 2) {
        const lead = state.chasers[0];
        tx = p.x * 2 - lead.x; ty = p.y * 2 - lead.y;
      } else {
        if (now > c.wander.until || Math.hypot(c.x - c.wander.x, c.y - c.wander.y) < 20) {
          const close = dist(c, p) < 160;
          c.wander = close ? { x: p.x, y: p.y, until: now + 900 }
            : { x: 30 + Math.random() * (W - 60), y: 60 + Math.random() * (H - 90), until: now + 2200 };
        }
        tx = c.wander.x; ty = c.wander.y;
      }
      // Toward the target the short way round; scared, straight away from you.
      let [dx, dy] = scared ? delta(p.x, p.y, c.x, c.y) : delta(c.x, c.y, wrapX(tx), wrapY(ty));
      const len = Math.hypot(dx, dy) || 1;
      const sp = scared ? c.speed * 0.6 : c.speed;
      // Steer rather than snap, so the chase has some give in it.
      c.vx += ((dx / len) * sp - c.vx) * 0.12 * dt;
      c.vy += ((dy / len) * sp - c.vy) * 0.12 * dt;
      c.x = wrapX(c.x + c.vx * dt);
      c.y = wrapY(c.y + c.vy * dt);

      if (dist(c, p) < PLAYER_R + 8) {
        if (scared) {
          state.combo += 1;
          state.score += 200 * state.combo;
          c.eaten = now + 2500;
          c.x = -100; c.y = -100;
        } else {
          state.lives -= 1;
          if (state.lives <= 0) { finish(false); return; }
          resetPositions();
          state.banner = "Caught by Red Tape";
          return;
        }
      }
    }
  }

  /* --------------------------------------------------------------- draw */

  function shield(x, y, s, fill, ring, chomp) {
    const k = s / 32;
    const squash = 1 - Math.abs(Math.sin(chomp || 0)) * 0.12;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k * squash);
    ctx.beginPath();
    ctx.arc(0, 0, 31, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = ring;
    ctx.beginPath();
    ctx.arc(0, 0, 25.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -17); ctx.lineTo(18, -2); ctx.lineTo(13, -2); ctx.lineTo(13, 15);
    ctx.lineTo(-13, 15); ctx.lineTo(-13, -2); ctx.lineTo(-18, -2); ctx.closePath();
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.restore();
  }

  /* Red Tape: a sheet of paper with a fold, eyes, and a strip of tape. */
  function redTape(c, scared, blink) {
    const w = 22, h = 24;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(Math.sin((c.x + c.y) / 40) * 0.12);
    ctx.fillStyle = scared ? (blink ? "#ffffff" : C.scared) : C.paper;
    ctx.strokeStyle = scared ? C.slate : C.navy;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w / 2 - 6, -h / 2); ctx.lineTo(w / 2, -h / 2 + 6);
    ctx.lineTo(w / 2, h / 2); ctx.lineTo(-w / 2, h / 2); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w / 2 - 6, -h / 2); ctx.lineTo(w / 2 - 6, -h / 2 + 6); ctx.lineTo(w / 2, -h / 2 + 6);
    ctx.stroke();
    if (!scared) {
      ctx.fillStyle = C.tape;
      ctx.save(); ctx.rotate(-0.5); ctx.fillRect(-w * 0.75, 2, w * 1.5, 5); ctx.restore();
    }
    // Eyes look where it is heading.
    const lx = Math.max(-1.5, Math.min(1.5, c.vx)), ly = Math.max(-1.5, Math.min(1.5, c.vy));
    [[-4.5, -4], [4.5, -4]].forEach(([ex, ey]) => {
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ex, ey, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = C.navy; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = C.navy; ctx.beginPath(); ctx.arc(ex + lx, ey + ly, 1.6, 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
  }

  function draw(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // A wash over the map so the game reads as on top of it.
    ctx.fillStyle = "rgba(244,247,250,.62)";
    ctx.fillRect(0, 0, W, H);

    const pulse = 1 + Math.sin(now / 160) * 0.18;
    for (const d of state.dots) {
      if (d.eaten) continue;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.power ? 6.5 * pulse : 3, 0, Math.PI * 2);
      ctx.fillStyle = d.power ? C.seafoam : C.dot;
      ctx.fill();
      if (d.power) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke(); }
    }

    const scared = now < state.scaredUntil;
    const blink = scared && state.scaredUntil - now < 1500 && Math.floor(now / 150) % 2 === 0;
    for (const c of state.chasers) {
      if (c.eaten && now < c.eaten) continue;
      echoes(c.x, c.y, 16).forEach(([x, y]) => redTape({ ...c, x, y }, scared, blink));
    }

    const p = state.player;
    // shield() draws a circle of radius 31 on a 32 unit box, so this size
    // makes the drawn shield exactly PLAYER_R across its radius.
    echoes(p.x, p.y, PLAYER_R + 2).forEach(([x, y]) => shield(x, y, (PLAYER_R * 32) / 31, C.navy, C.seafoam, p.chomp));

    if (state.confetti) {
      state.confetti.forEach((c) => {
        if (c.y < -20 || c.y > H + 20) return;
        ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rot);
        shield(0, 0, c.size, c.color, "#ffffff", 0);
        ctx.restore();
      });
    }

    hud(now);
    if (state.phase !== "play") panel(now);
    else if (now < state.pauseUntil) banner(state.banner || "Ready");
  }

  /* A sprite straddling an edge is drawn on both sides, so it slides through
     instead of popping. */
  function echoes(x, y, r) {
    const xs = [x], ys = [y];
    if (x < r) xs.push(x + W); else if (x > W - r) xs.push(x - W);
    if (y < TOP + r) ys.push(y + FH()); else if (y > H - r) ys.push(y - FH());
    return xs.flatMap((ex) => ys.map((ey) => [ex, ey]));
  }

  function hud() {
    ctx.fillStyle = C.hud;
    ctx.fillRect(0, 0, W, 30);
    ctx.font = "600 12.5px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.fillText("PRIME CHASE", 12, 15);
    ctx.fillStyle = "#c9d6e6";
    const lives = "● ".repeat(Math.max(0, state.lives)).trim();
    ctx.fillText(`Round ${state.level} of ${ROUNDS}    Score ${state.score.toLocaleString()}    Lives ${lives}    Left ${state.left}    Best ${Math.max(bestScore(), state.score).toLocaleString()}`, 120, 15);
    ctx.textAlign = "right";
    if (state.last) {
      const t = `${titleCase(state.last.name)}, ${titleCase(state.last.city)} ${state.last.state} · ${state.last.units} units`;
      ctx.fillStyle = "#8fb9bb";
      ctx.fillText(t.length > 70 ? t.slice(0, 69) + "…" : t, W - 110, 15);
    }
    ctx.fillStyle = "#c9d6e6";
    ctx.fillText("Esc to quit", W - 12, 15);
  }

  function banner(text) {
    ctx.font = "700 22px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const w = ctx.measureText(text).width + 40;
    ctx.fillStyle = "rgba(8,25,55,.85)";
    roundRect(W / 2 - w / 2, H / 2 - 50, w, 40, 8);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText(text, W / 2, H / 2 - 30);
  }

  function panel(now) {
    const lines = state.phase === "intro" ? [
      ["Prime Chase", 26, 800, C.navy],
      ["Collect every property in view before the Red Tape catches you.", 14, 500, C.slate],
      ["Big seafoam dots are properties exiting within five years. Grab one", 14, 500, C.slate],
      ["and the Red Tape runs scared for a few seconds. Catch it then.", 14, 500, C.slate],
      ["Run off any edge to come back on the other side.", 14, 500, C.slate],
      [`${ROUNDS} rounds, with more Red Tape each round.`, 14, 500, C.slate],
      ["Arrow keys or WASD to move. Swipe on a phone. Esc to quit.", 13, 500, C.slate],
      [`${state.left} properties in view · Press Enter or Space to play`, 14, 700, C.seafoam],
    ] : state.phase === "cleared" ? [
      ["Congratulations!", 28, 800, C.navy],
      [`Round ${state.level} of ${ROUNDS} cleared`, 17, 700, C.seafoam],
      [`${state.dots.length} properties · ${state.units.toLocaleString()} units · Score ${state.score.toLocaleString()}`, 14, 500, C.slate],
      [`Round ${state.level + 1} brings ${lv(state.level + 1).tape} pieces of Red Tape, and they are faster. Plus one life.`, 14, 500, C.slate],
      [`Starting in ${Math.max(1, Math.ceil((4000 - (now - state.clearedAt)) / 1000))} · Press Enter to go now`, 14, 700, C.seafoam],
    ] : state.phase === "champion" ? [
      ["You beat Prime Chase!", 28, 800, C.navy],
      [`All ${ROUNDS} rounds cleared`, 17, 700, C.seafoam],
      [`Final score ${state.score.toLocaleString()} · Best ${Math.max(bestScore(), state.score).toLocaleString()}`, 15, 600, C.slate],
      ["Press Enter to play again, or Esc to quit.", 14, 700, C.seafoam],
    ] : [
      ["Out of lives", 26, 800, C.navy],
      [`Score ${state.score.toLocaleString()} · Best ${Math.max(bestScore(), state.score).toLocaleString()}`, 16, 600, C.slate],
      ["Press Enter to play again, or Esc to quit.", 14, 700, C.seafoam],
    ];
    const boxW = Math.min(W - 40, 640), boxH = 40 + lines.length * 30;
    const x = W / 2 - boxW / 2, y = H / 2 - boxH / 2;
    ctx.fillStyle = "rgba(255,255,255,.97)";
    ctx.shadowColor = "rgba(8,25,55,.3)"; ctx.shadowBlur = 24;
    roundRect(x, y, boxW, boxH, 12); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    lines.forEach(([t, size, weight, color], i) => {
      ctx.font = `${weight} ${size}px system-ui, sans-serif`;
      ctx.fillStyle = color;
      ctx.fillText(t, W / 2, y + 34 + i * 30 + (i === 0 ? 0 : 8));
    });
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function titleCase(t) {
    const tmp = document.createElement("textarea");
    // Atlas is a top-level const in app.js, so it is not on window.
    tmp.innerHTML = typeof Atlas !== "undefined" ? Atlas.titleCase(t || "") : (t || "");
    return tmp.value;
  }

  /* ------------------------------------------------------------- control */

  function newGame(level = 1, keepScore = 0, lives = 3) {
    const dots = collectDots();
    state = { dots, left: dots.length, score: keepScore, units: 0, lives, level, combo: 0,
      last: null, phase: "play", scaredUntil: 0, pauseUntil: 0, banner: `Round ${level}`, confetti: null };
    resetPositions();
  }

  /* After a cleared round: the same properties back on the board, one more
     piece of Red Tape, and a life back (up to five). */
  function nextRound() {
    newGame(state.level + 1, state.score, Math.min(5, state.lives + 1));
    state.pauseUntil = performance.now() + 1400;
  }

  function burst() {
    const colors = [C.navy, C.seafoam, C.slate];
    state.confetti = Array.from({ length: 70 }, (_, i) => ({
      x: Math.random() * W, y: -Math.random() * H * 0.8 - 20, vy: 1.6 + Math.random() * 2.4,
      rot: Math.random() * 6, spin: (Math.random() - 0.5) * 0.12, size: 10 + Math.random() * 14,
      color: colors[i % colors.length], seed: Math.random() * 5000,
    }));
  }

  function finish(won) {
    saveBest(state.score);
    if (!won) { state.phase = "lost"; return; }
    burst();
    if (state.level >= ROUNDS) { state.phase = "champion"; return; }
    state.phase = "cleared";
    state.clearedAt = performance.now();
  }

  function onKey(e) {
    const k = e.key;
    const dirs = {
      ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
      w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0], W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0],
    };
    if (k === "Escape") { e.preventDefault(); stop(); return; }
    if (dirs[k]) {
      e.preventDefault();
      e.stopPropagation();
      if (state.phase === "play") state.player.want = { x: dirs[k][0], y: dirs[k][1] };
      return;
    }
    if (k === "Enter" || k === " ") {
      e.preventDefault();
      e.stopPropagation();
      if (state.phase === "intro") { state.phase = "play"; state.pauseUntil = performance.now() + 900; }
      else if (state.phase === "cleared") nextRound();
      else if (state.phase === "lost" || state.phase === "champion") newGame(1, 0);
    }
  }

  function onTouchStart(e) {
    const t = e.touches[0];
    touchStart = { x: t.clientX, y: t.clientY };
    if (state.phase !== "play") onKey({ key: "Enter", preventDefault() {}, stopPropagation() {} });
  }
  function onTouchEnd(e) {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
    touchStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 20 || state.phase !== "play") return;
    state.player.want = Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
  }

  function sizeCanvas() {
    const r = host.getBoundingClientRect();
    W = r.width; H = r.height; dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
  }

  function start() {
    if (running) return;
    if (!window.AtlasMap || !window.AtlasMap.map) {
      location.href = "map.html#prime-chase";
      return;
    }
    map = window.AtlasMap.map;
    host = map.getContainer();
    // Bring the map into view so the whole board is on screen.
    host.scrollIntoView({ block: "center", behavior: "instant" in document.documentElement.style ? "instant" : "auto" });
    canvas = document.createElement("canvas");
    canvas.className = "prime-chase";
    canvas.setAttribute("aria-label", "Prime Chase game. Arrow keys to move, Escape to quit.");
    host.append(canvas);
    ctx = canvas.getContext("2d");
    sizeCanvas();
    freeze(true);
    newGame(1, 0);
    state.phase = "intro";
    running = true;
    keyHandler = onKey;
    window.addEventListener("keydown", keyHandler, true);
    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("resize", sizeCanvas);
    last = performance.now();
    raf = requestAnimationFrame(step);
  }

  function stop() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
    if (state) saveBest(state.score);
    window.removeEventListener("keydown", keyHandler, true);
    window.removeEventListener("resize", sizeCanvas);
    canvas.remove();
    freeze(false);
  }

  // Opened from another page through map.html#prime-chase.
  document.addEventListener("atlasmap:ready", () => {
    if (location.hash === "#prime-chase") {
      history.replaceState(null, "", location.pathname + location.search);
      setTimeout(start, 400);
    }
  });

  return { start, stop };
})();

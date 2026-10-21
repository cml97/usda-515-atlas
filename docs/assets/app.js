/* Shared data loading, filtering and detail rendering for the Section 515 atlas. */

const Atlas = (() => {
  const PROGRAMS = {
    0: "Section 515 Rural Rental Housing",
    1: "Section 514 Off-Farm Labor Housing",
    2: "Section 514 On-Farm Labor Housing",
  };

  const RENTAL = {
    FA: "Family",
    EL: "Elderly",
    MX: "Mixed",
    CG: "Congregate",
    GH: "Group Home",
  };

  const STATE_NAMES = {
    AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
    CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
    GU: "Guam", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
    KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
    MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
    MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
    NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
    ND: "North Dakota", MP: "Northern Mariana Islands", OH: "Ohio", OK: "Oklahoma",
    OR: "Oregon", PA: "Pennsylvania", PR: "Puerto Rico", RI: "Rhode Island",
    SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
    UT: "Utah", VT: "Vermont", VI: "Virgin Islands", VA: "Virginia", WA: "Washington",
    WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", WP: "Western Pacific",
  };

  let index = [];
  let meta = {};
  let counties = {};
  const shardCache = new Map();

  /* ---------------------------------------------------------- data source */

  // Local folder by default. Set window.ATLAS_DATA_BASE in assets/config.js to
  // the Worker's address to read the gated data instead.
  const BASE = (window.ATLAS_DATA_BASE || "data").replace(/\/+$/, "");
  const REMOTE = /^https?:\/\//i.test(BASE);
  // Mason's PBS8 database. Section 8 contract detail lives there; this atlas
  // links out rather than keeping a second copy of the same data.
  const HAP_DB_URL = "https://mrare-cmd.github.io/HAP-Database/";

  /* Deep link into the PBS8 Database, whose filters are read from the URL
     fragment by its applyFilterHash(). Confirmed keys:

       property -> opens that Property ID's dashboard outright
       subj / comp -> mark a subject and comparables in the table and map
       name -> Property Name       city / state / county / zip / msa -> chips
       umin / umax -> unit range   q -> global search

     `property` is exact and cannot resolve to more than one row, so it leads.
     The name, city and state keys ride along behind it on purpose: Property
     IDs are HUD's, not ours, and if HUD ever reissues one the dashboard simply
     will not open. With the filters attached, a stale ID lands the reader on
     the right property anyway instead of on 24,000 rows.

     The fragment is parsed once at load and there is no hashchange listener,
     so these links must open in a new tab. Every caller below passes
     target="_blank", which sidesteps it. */
  function hapDeepLink(d) {
    if (!d || !d.s8) return HAP_DB_URL;
    const parts = [];
    const add = (k, v) => {
      if (v === null || v === undefined || v === "") return;
      parts.push(k + "=" + encodeURIComponent(String(v).trim()));
    };
    add("property", d.s8_hud_property_id);
    add("name", d.s8_hud_name);
    add("city", d.s8_hud_city);
    add("state", d.state);
    return parts.length ? `${HAP_DB_URL}#${parts.join("&")}` : HAP_DB_URL;
  }

  const TOKEN_KEY = "atlas.session";
  const HASH_KEY = "atlas.hash";

  function dataUrl(name) {
    return REMOTE ? `${BASE}/data/${name}` : `${BASE}/${name}`;
  }

  /**
   * Session handling.
   *
   * The Worker hands the token back in the URL fragment, which browsers never
   * transmit to a server. We move it into storage and wipe the address bar, then
   * send it as an Authorization header on every data request. A header rather
   * than a cookie, because a cookie between this page and the Worker's own
   * domain is a third-party cookie: Safari blocks those outright and Chrome is
   * retiring them, so a cookie session would work here and fail for someone else.
   */
  function captureToken() {
    const match = /[#&]atlas_token=([^&]+)/.exec(location.hash || "");
    if (!match) return;
    try {
      localStorage.setItem(TOKEN_KEY, decodeURIComponent(match[1]));
    } catch { /* private browsing with storage disabled, carry on in memory */ }
    memoryToken = decodeURIComponent(match[1]);

    // Put back whatever fragment the page had before sign-in sent us away.
    let restore = "";
    try {
      restore = sessionStorage.getItem(HASH_KEY) || "";
      sessionStorage.removeItem(HASH_KEY);
    } catch { /* nothing to restore */ }
    history.replaceState(null, "", location.pathname + location.search + restore);
  }

  let memoryToken = null;

  function token() {
    const raw = memoryToken || readStoredToken();
    if (!raw) return null;
    // The payload is readable without the signing key, so an expired session
    // can be spotted here and treated as no session at all. The Worker still
    // does the real check; this only avoids showing a page that is about to
    // be taken away.
    const exp = tokenExpiry(raw);
    if (exp !== null && exp * 1000 < Date.now()) {
      clearToken();
      return null;
    }
    return raw;
  }

  function readStoredToken() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  function tokenExpiry(raw) {
    try {
      const body = String(raw).split(".")[0];
      const pad = body.replace(/-/g, "+").replace(/_/g, "/");
      const json = JSON.parse(atob(pad + "===".slice((pad.length + 3) % 4)));
      return typeof json.exp === "number" ? json.exp : null;
    } catch {
      return null;
    }
  }

  function clearToken() {
    memoryToken = null;
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch { /* nothing stored */ }
  }

  function authHeaders() {
    const t = token();
    return t ? { Authorization: `Bearer ${t}` } : {};
  }

  async function request(name) {
    return fetch(dataUrl(name), REMOTE ? { headers: authHeaders() } : {});
  }

  /**
   * Fetch one data file, turning a signed-out response into a sign-in prompt
   * rather than a broken page.
   */
  async function fetchData(name, { optional = false } = {}) {
    let res;
    try {
      res = await request(name);
    } catch (err) {
      if (optional) return null;
      if (REMOTE) promptSignIn();
      throw err;
    }

    if (res.status === 401 || res.status === 403) {
      clearToken();
      promptSignIn();
      throw new Error("Sign-in required");
    }
    if (!res.ok) {
      if (optional) return null;
      let detail = "";
      try {
        detail = (await res.json()).detail || "";
      } catch { /* not JSON */ }
      throw new Error(`${name} returned ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    return res.json();
  }

  /**
   * Download a file the user asked for. A plain link cannot carry an
   * Authorization header, so fetch it and hand the browser a blob.
   */
  async function download(name, filename) {
    const res = await request(name);
    if (res.status === 401 || res.status === 403) {
      clearToken();
      promptSignIn();
      return;
    }
    if (!res.ok) throw new Error(`${name} returned ${res.status}`);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename || name.split("/").pop();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  /** The email out of the session payload, for the masthead. */
  function sessionEmail() {
    const raw = token();
    if (!raw) return null;
    try {
      const body = String(raw).split(".")[0];
      const pad = body.replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(atob(pad + "===".slice((pad.length + 3) % 4))).email || null;
    } catch {
      return null;
    }
  }

  function signOut() {
    clearToken();
    // A plain reload is enough: the script in the page head sees no session and
    // locks the interface before anything paints.
    location.replace(location.pathname + location.search);
  }

  function paintSession() {
    const box = document.getElementById("session");
    if (!box) return;
    if (!REMOTE) { box.innerHTML = ""; return; }

    const who = sessionEmail();
    box.innerHTML = `${who ? `<span>${esc(who)}</span>` : ""}<button type="button" id="sign-out">Sign out</button>`;
    box.querySelector("#sign-out").addEventListener("click", signOut);
  }

  /** "2026-08-17" -> "08/17/2026" */
  function usDate(iso) {
    if (!iso || iso.length < 10) return null;
    const [y, m, d] = iso.slice(0, 10).split("-");
    return `${m}/${d}/${y}`;
  }

  function paintAsOf() {
    const el = document.getElementById("asof");
    if (!el || !meta) return;
    const prop = usDate(meta.property_report_date);
    const exit = usDate(meta.exit_report_date);
    if (!prop && !exit) return;
    // Both dates, because USDA publishes the two files on different cycles and
    // quoting only the newer one would overstate how current the exit years are.
    el.textContent = exit && exit !== prop
      ? `Data as of ${prop} · Program Exit Data as of ${exit}`
      : `Data as of ${prop || exit}`;
  }

  function signInUrl() {
    try {
      if (location.hash) sessionStorage.setItem(HASH_KEY, location.hash);
    } catch { /* storage unavailable, the fragment is just lost */ }
    const back = location.origin + location.pathname + location.search;
    return `${BASE}/login?return=${encodeURIComponent(back)}`;
  }

  function promptSignIn() {
    lock();
    if (document.getElementById("signin-gate")) return;

    const gate = document.createElement("div");
    gate.id = "signin-gate";
    gate.innerHTML = `
      <div class="signin-card">
        <h1>USDA Section 515 Property Atlas</h1>
        <p>Rural Rental Housing and Farm Labor Housing, built from USDA Rural
           Development open data.</p>
        <a class="signin-go" id="signin-go">Sign in with your work account</a>
        <p class="signin-foot">Greysteel accounts only.</p>
      </div>`;
    document.body.appendChild(gate);
    gate.querySelector("#signin-go").href = signInUrl();
  }

  /* The gate hides the whole interface rather than sitting on top of it, so a
     signed-out visitor sees a sign-in screen and nothing else: no filters, no
     column headers, no counts. */
  function lock() {
    document.documentElement.classList.add("atlas-locked");
  }

  function unlock() {
    document.documentElement.classList.remove("atlas-locked");
    document.getElementById("signin-gate")?.remove();
  }

  function esc(value) {
    if (value === null || value === undefined) return "";
    return String(value).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  captureToken();

  /* ------------------------------------------------------------ credit */

  /* Added from here rather than in each page's markup so every page picks it
     up, including any added later. */
  function paintCredit() {
    const h1 = document.querySelector(".masthead-inner h1");
    if (!h1 || document.querySelector(".masthead .credit")) return;
    const tag = document.createElement("span");
    tag.className = "credit";
    tag.textContent = "Created by Charlie Lederberg";
    h1.after(tag);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paintCredit);
  else paintCredit();

  /* ----------------------------------------------------------- the stamp */

  /* Up, up, down, down, left, right, left, right, B, A, Start. Enter is
     Start. The favicon already plays on USDA's beef grades, so the atlas
     grades itself. */
  const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft",
    "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a", "Enter"];

  /* A shower of the favicon shield before the stamp lands. */
  function shieldRain() {
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return 0;
    const sky = document.createElement("div");
    sky.className = "shield-rain";
    const n = 46;
    for (let i = 0; i < n; i++) {
      const img = document.createElement("img");
      img.src = "favicon.svg";
      img.alt = "";
      const size = 22 + Math.random() * 34;
      img.style.left = `${Math.random() * 100}vw`;
      img.style.width = `${size}px`;
      img.style.animationDuration = `${1.6 + Math.random() * 1.4}s`;
      img.style.animationDelay = `${Math.random() * 1.1}s`;
      img.style.setProperty("--spin", `${(Math.random() * 2 - 1) * 540}deg`);
      sky.append(img);
    }
    document.body.append(sky);
    setTimeout(() => sky.remove(), 4000);
    return 900;
  }
  let konamiAt = 0;

  function primeStamp() {
    if (document.getElementById("prime-stamp")) return;
    const wrap = document.createElement("div");
    wrap.id = "prime-stamp";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-label", "USDA Prime");
    wrap.innerHTML = `
      <div class="stamp-card">
        <svg class="stamp" viewBox="0 0 200 230" aria-hidden="true">
          <path d="M100 8 L188 34 L188 112 C188 168 148 204 100 222 C52 204 12 168 12 112 L12 34 Z"
                fill="none" stroke="currentColor" stroke-width="9"/>
          <path d="M100 24 L174 46 L174 112 C174 160 140 190 100 206 C60 190 26 160 26 112 L26 46 Z"
                fill="none" stroke="currentColor" stroke-width="3"/>
          <text x="100" y="92" text-anchor="middle" font-size="40" font-weight="800" fill="currentColor"
                font-family="Georgia, serif" letter-spacing="3">USDA</text>
          <line x1="44" y1="108" x2="156" y2="108" stroke="currentColor" stroke-width="4"/>
          <text x="100" y="152" text-anchor="middle" font-size="36" font-weight="800" fill="currentColor"
                font-family="Georgia, serif" letter-spacing="2">PRIME</text>
        </svg>
        <p class="stamp-line">This atlas has been graded Prime.</p>
        <p class="stamp-by">Created by Charlie Lederberg</p>
        <div class="stamp-games">
          <h4>Games</h4>
          <a href="https://clederberg.github.io/Bubble-Craps/" target="_blank" rel="noopener">Bubble Craps</a>
          <a href="https://mrare-cmd.github.io/GreyHub/" target="_blank" rel="noopener">GreyHub</a>
          <a href="map.html#prime-chase" class="stamp-chase">Prime Chase</a>
        </div>
        <p class="stamp-hint">Click outside or press Esc to close</p>
      </div>`;
    const onEsc = (e) => { if (e.key === "Escape") close(); };
    function close() {
      wrap.classList.add("out");
      setTimeout(() => wrap.remove(), 250);
      document.removeEventListener("keydown", onEsc);
    }
    // Clicks inside the card (the game links) leave it open.
    wrap.addEventListener("click", (e) => { if (!e.target.closest(".stamp-card")) close(); });
    // Already on the map, start the game in place rather than reloading.
    wrap.querySelector(".stamp-chase").addEventListener("click", (e) => {
      if (window.PrimeChase) { e.preventDefault(); close(); window.PrimeChase.start(); }
    });
    document.addEventListener("keydown", onEsc);
    document.body.append(wrap);
  }

  document.addEventListener("keydown", (e) => {
    const el = e.target;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    konamiAt = key === KONAMI[konamiAt] ? konamiAt + 1 : (key === KONAMI[0] ? 1 : 0);
    if (konamiAt === KONAMI.length) {
      konamiAt = 0;
      e.preventDefault();
      if (document.getElementById("prime-stamp")) return;
      setTimeout(primeStamp, shieldRain());
    }
  });

  // If the token arrives without a full page load, pick it up and retry.
  window.addEventListener("hashchange", () => {
    if (!/[#&]atlas_token=/.test(location.hash)) return;
    captureToken();
    document.getElementById("signin-gate")?.remove();
    location.reload();
  });

  const num = (v) => (v === null || v === undefined || v === "" ? "" : Number(v).toLocaleString());
  const pct = (v) => (v === null || v === undefined ? "" : (v * 100).toFixed(0) + "%");
  const money = (v) => (v === null || v === undefined ? "" : "$" + Math.round(v).toLocaleString());
  const dash = (v) => (v === null || v === undefined || v === "" ? "&mdash;".replace("&mdash;", "-") : v);

  // Words that stay as written, and abbreviations with a preferred casing.
  const KEEP_UPPER = new Set(["LLC", "LLP", "LP", "USA", "HUD", "USDA", "II", "III", "IV", "VI"]);
  const FORCED = { INC: "Inc", CO: "Co", CORP: "Corp", LTD: "Ltd", APT: "Apt", APTS: "Apts", MGMT: "Mgmt" };
  const SMALL_WORDS = new Set(["AND", "THE", "OF", "FOR", "AT", "ON", "IN"]);

  /**
   * USDA records names in capitals. Title-casing them reads better, but a blunt
   * pass turns initialisms into nonsense: "TM ASSOCIATES" becomes "Tm", and
   * "J & A" becomes "J & A" only by luck. Short all-capital tokens are left
   * alone, and a few abbreviations get a preferred spelling.
   */
  function titleCase(text) {
    if (!text) return "";
    const out = String(text).split(/(\s+)/).map((tok) => {
      const bare = tok.replace(/[^A-Za-z0-9&]/g, "");
      if (!bare) return tok;
      const upper = bare.toUpperCase();
      if (FORCED[upper]) return tok.replace(bare, FORCED[upper]);
      if (tok === tok.toUpperCase()) {
        if (KEEP_UPPER.has(upper)) return tok;
        if (bare.length <= 3 && !SMALL_WORDS.has(upper)) return tok;
      }
      return tok.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
    }).join("");
    return esc(out);
  }

  /* The five horizon colors live in the stylesheet so the table pills, the
     map markers, the cluster bubbles and the legend cannot drift apart. The
     map needs them as values rather than class names, so it reads them back
     off the document here. */
  const HORIZONS = ["past", "near", "mid", "far", "none"];

  function horizonColors() {
    const style = getComputedStyle(document.documentElement);
    const out = {};
    HORIZONS.forEach((k) => {
      out[k] = (style.getPropertyValue("--h-" + k) || "").trim() || "#77756e";
    });
    return out;
  }

  function horizonClass(exitYear) {
    if (!exitYear) return "none";
    const years = exitYear - new Date().getFullYear();
    if (years < 0) return "past";
    if (years <= 5) return "near";
    if (years <= 10) return "mid";
    return "far";
  }

  /* "3 yrs", "1 yr", "past" - USDA's projected date can already have gone by
     on a property that is still in the portfolio. */
  function horizonLabel(exitYear) {
    if (!exitYear) return "not reported";
    const years = exitYear - new Date().getFullYear();
    if (years < 0) return `${exitYear} (date passed)`;
    if (years === 0) return `${exitYear} (this year)`;
    return `${exitYear} (${years} ${years === 1 ? "yr" : "yrs"})`;
  }

  /* Title-case a "CITY, ST" string without lowercasing the state. */
  function placeCase(text) {
    if (!text) return "";
    const parts = String(text).split(",");
    if (parts.length < 2) return titleCase(text);
    return titleCase(parts.slice(0, -1).join(",")) + ", " + esc(parts[parts.length - 1].trim().toUpperCase());
  }

  /* ------------------------------------------------- QCT, DDA, USDA rural */

  /* HUD designates QCTs and DDAs once a year, in October, for the following
     January 1, and the data build carries both years. Either one gives the
     130% eligible basis boost, so the two are read together as one question:
     is this property in a boosted area now, and will it be next year. */
  function desigYears() {
    const d = (meta && meta.designations) || {};
    return { now: d.designation_year || null, next: d.next_designation_year || null };
  }

  const basisNow = (r) => (r.qct === null && r.dda === null) || (r.qct === undefined && r.dda === undefined)
    ? null : Boolean(r.qct || r.dda);
  const basisNext = (r) => (r.qct_next === null && r.dda_next === null)
    || (r.qct_next === undefined && r.dda_next === undefined) ? null : Boolean(r.qct_next || r.dda_next);

  /* 3 joins next year, 2 in now and next, 1 in now but leaving, 0 neither.
     The QCT, DDA and rural fields live in the per-state detail files, not
     the index, so this is worked out from a full record. */
  function basisRank(r) {
    const now = basisNow(r), next = basisNext(r);
    if (now === null) return null;
    if (next === null) return now ? 2 : 0;
    if (next && !now) return 3;
    if (now && next) return 2;
    if (now && !next) return 1;
    return 0;
  }

  /** Short label for the table, such as "QCT", "QCT DDA" or "New 2027". */
  function basisLabel(r) {
    const y = desigYears();
    const now = [r.qct && "QCT", r.dda && "DDA"].filter(Boolean).join(" ");
    const next = [r.qct_next && "QCT", r.dda_next && "DDA"].filter(Boolean).join(" ");
    const rank = r.basis_rank !== undefined ? r.basis_rank : basisRank(r);
    if (rank === null || rank === undefined) return "";
    if (rank === 3) return `<span class="pill basis-new" title="Not a QCT or DDA in ${y.now}, becomes ${next} on January 1, ${y.next}">${next} ${y.next}</span>`;
    if (rank === 1) return `<span class="pill basis-leave" title="${now} in ${y.now}, drops off HUD's ${y.next} list">${now} until ${y.next}</span>`;
    if (rank === 2) return `<span class="pill basis">${now || next}</span>`;
    return "";
  }

  async function load() {
    if (REMOTE && !token() && !/[#&]atlas_token=/.test(location.hash || "")) {
      promptSignIn();
      throw new Error("Sign-in required");
    }

    const [idx, m, c] = await Promise.all([
      fetchData("index.json"),
      fetchData("meta.json"),
      // County names live in their own small file so the build can add them
      // without reissuing the whole index. Absent is survivable.
      fetchData("counties.json", { optional: true }),
    ]);
    index = idx;
    meta = m;
    counties = c || {};
    unlock();
    paintSession();
    paintAsOf();
    index.forEach((r) => {
      if (!r.county && r.fips && counties[r.fips]) r.county = counties[r.fips];
    });
    return { index, meta };
  }

  async function detail(record) {
    const state = (record.state || "ZZ").toUpperCase();
    if (!shardCache.has(state)) {
      shardCache.set(state, fetchData(`by-state/${state}.json`));
    }
    const shard = await shardCache.get(state);
    const found = shard[record.id] || null;
    if (found && !found.county && found.fips && counties[found.fips]) {
      found.county = counties[found.fips];
    }
    return found;
  }

  /* ---------------------------------------------------------- managers */

  /**
   * USDA's management names are free text, so the same firm appears as
   * "MACO MANAGEMENT CO INC", "Maco Management Co., Inc." and so on. Fold case,
   * punctuation and the trailing corporate suffix so those group together.
   * Deliberately conservative: it will not merge genuinely different firms that
   * happen to share a first word.
   */
  function normManager(name) {
    if (!name) return null;
    let s = String(name).toUpperCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
    // Strip suffixes until the name stops changing. Running once is not enough
    // for "MACO MANAGEMENT CO INC", and more importantly a single pass is not
    // idempotent: normalizing an already-normalized key would keep eating
    // words, so a value round-tripped through a URL would stop matching.
    for (let i = 0; i < 6; i++) {
      const next = s.replace(/\s+(INC|LLC|L L C|LP|LTD|CO|CORP|COMPANY)$/, "").trim();
      if (next === s) break;
      s = next;
    }
    return s || null;
  }

  /** Roll the property list up by management company. */
  function managers(rows) {
    const thisYear = new Date().getFullYear();
    const out = new Map();
    for (const r of rows || index) {
      const key = normManager(r.management);
      if (!key) continue;
      let e = out.get(key);
      if (!e) {
        e = { key, label: r.management, properties: 0, units: 0, ra: 0, lihtc: 0,
              exiting: 0, s8: 0, states: new Set(), labels: new Map() };
        out.set(key, e);
      }
      e.properties += 1;
      e.units += r.units || 0;
      e.ra += r.ra_units || 0;
      if (r.lihtc) e.lihtc += 1;
      if (r.s8) e.s8 += 1;
      if (r.exit_year && r.exit_year - thisYear <= 10) e.exiting += 1;
      if (r.state) e.states.add(r.state);
      e.labels.set(r.management, (e.labels.get(r.management) || 0) + 1);
    }
    for (const e of out.values()) {
      // Show whichever spelling USDA uses most often for this firm.
      e.label = [...e.labels.entries()].sort((a, b) => b[1] - a[1])[0][0];
      e.stateList = [...e.states].sort();
      e.raShare = e.units ? e.ra / e.units : null;
      e.avgSize = e.properties ? Math.round(e.units / e.properties) : 0;
      delete e.labels;
      delete e.states;
    }
    return [...out.values()];
  }

  /** A manager filter arriving as ?mgmt= on the table or map page. */
  function managerParam() {
    const v = new URLSearchParams(location.search).get("mgmt");
    return v ? normManager(v) : "";
  }

  /* The management filter travels in the query string rather than in the
     saved filter state, because it is an explicit act (clicking a firm) and
     should not linger the way a search does. To let it survive a jump between
     the table and the map, the nav links carry it forward. */
  function carryParamsIntoNav(root) {
    const params = new URLSearchParams(location.search);
    const keep = new URLSearchParams();
    for (const key of ["mgmt", "state"]) {
      const value = params.get(key);
      if (value) keep.set(key, value);
    }
    const query = keep.toString();
    if (!query) return;
    root.querySelectorAll(".tabs a").forEach((link) => {
      const href = link.getAttribute("href");
      if (!href || href.includes("?") || href.startsWith("http")) return;
      // The Companies page rolls firms up and has no management filter, so
      // handing it a mgmt parameter would say nothing.
      if (/companies\.html/.test(href)) return;
      link.setAttribute("href", `${href}?${query}`);
    });
  }

  /** Says which firm the view is filtered to, and offers the other view of
      the same set. Shared by the table and the map so a manager search can be
      read either way round. */
  function paintManagerBanner(root) {
    const host = root.querySelector("#mgmt-banner");
    if (!host) return;
    const key = managerParam();
    if (!key) { host.innerHTML = ""; host.hidden = true; return; }

    const hit = index.find((r) => normManager(r.management) === key);
    const label = hit ? titleCase(hit.management) : esc(key);
    const params = new URLSearchParams(location.search);
    const onMap = /map\.html/.test(location.pathname);
    const other = onMap ? "index.html" : "map.html";
    const otherLabel = onMap ? "See them in the table" : "See them on the map";

    const matching = index.filter((r) => normManager(r.management) === key);
    const units = matching.reduce((n, r) => n + (r.units || 0), 0);
    const states = new Set(matching.map((r) => r.state).filter(Boolean));
    const scoped = statesFromUrl();
    const scope = scoped.length
      ? ` in ${esc(scoped.join(", "))}`
      : states.size > 1 ? ` across ${states.size} states` : "";

    host.hidden = false;
    host.innerHTML =
      `<span>Filtered to <strong>${label}</strong>${scope}:
        ${matching.length.toLocaleString()} ${matching.length === 1 ? "property" : "properties"},
        ${units.toLocaleString()} units</span>
       <a href="${other}?${params.toString()}">${otherLabel}</a>
       <a href="${onMap ? "map.html" : "index.html"}">Clear</a>`;
  }


  /* ------------------------------------------------------- chip multiselect

     A text input that commits its matches as removable chips. Replaces the
     single-value dropdowns, so a search can name several states, counties,
     tenant types or programs at once.

     Each field owns a `values` array. `search(term)` returns candidates,
     and `label(value)` renders a chip. Typing filters a suggestion list;
     Enter takes the first suggestion, Backspace on an empty box removes the
     last chip, and Escape closes the list. */

  function chipField(host, spec) {
    const values = [];
    const input = host.querySelector("input");
    const chips = host.querySelector(".chips");
    const menu = host.querySelector(".menu");
    let active = -1;

    function render() {
      chips.innerHTML = values.map((v, i) =>
        `<span class="chip">${esc(spec.label(v))}<button type="button" data-i="${i}"
          aria-label="Remove ${esc(spec.label(v))}">&times;</button></span>`).join("");
      chips.querySelectorAll("button").forEach((b) => {
        b.addEventListener("mousedown", (e) => {
          e.preventDefault();
          values.splice(Number(b.dataset.i), 1);
          render();
          spec.onChange();
        });
      });
      host.classList.toggle("has-chips", values.length > 0);
      input.placeholder = values.length ? "" : spec.placeholder || "";
    }

    function closeMenu() {
      menu.innerHTML = "";
      menu.hidden = true;
      active = -1;
    }

    function openMenu() {
      const term = input.value.trim();
      const hits = spec.search(term, values).slice(0, 10);
      if (!hits.length) { closeMenu(); return; }
      menu.hidden = false;
      menu.innerHTML = hits.map((h, i) =>
        `<li data-v="${esc(String(h.value))}" class="${i === active ? "on" : ""}">
           ${esc(h.label)}${h.hint ? `<span class="hint">${esc(h.hint)}</span>` : ""}</li>`).join("");
      menu.querySelectorAll("li").forEach((li) => {
        li.addEventListener("mousedown", (e) => { e.preventDefault(); take(li.dataset.v); });
      });
    }

    function take(value) {
      if (value === undefined || value === null || value === "") return;
      if (!values.includes(value)) values.push(value);
      input.value = "";
      render();
      closeMenu();
      spec.onChange();
    }

    input.addEventListener("input", openMenu);
    input.addEventListener("focus", openMenu);
    input.addEventListener("blur", () => setTimeout(closeMenu, 120));

    input.addEventListener("keydown", (e) => {
      const items = [...menu.querySelectorAll("li")];
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!items.length) return;
        active = e.key === "ArrowDown"
          ? Math.min(active + 1, items.length - 1)
          : Math.max(active - 1, 0);
        items.forEach((li, i) => li.classList.toggle("on", i === active));
        items[active].scrollIntoView({ block: "nearest" });
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const pick = items[active >= 0 ? active : 0];
        if (pick) take(pick.dataset.v);
        return;
      }
      if (e.key === "Escape") { closeMenu(); return; }
      if (e.key === "Backspace" && !input.value && values.length) {
        values.pop();
        render();
        spec.onChange();
      }
    });

    render();

    return {
      get values() { return [...values]; },
      set(list) {
        values.length = 0;
        (list || []).forEach((v) => { if (!values.includes(v)) values.push(v); });
        render();
      },
      clear() { values.length = 0; input.value = ""; render(); closeMenu(); },
    };
  }

  /* --------------------------------------------------- segmented selector

     Three-state toggle for a yes / either / no question. Reads faster than a
     dropdown for something with only three answers. */

  function segField(host, onChange) {
    let value = "";
    function render() {
      host.querySelectorAll("button").forEach((b) => {
        const mine = b.dataset.v || "";
        const on = mine === value;
        // "Any" is the resting state, so it never takes the active color.
        // Colouring it would say a filter is on when nothing is narrowing.
        b.classList.toggle("on", on && mine !== "");
        b.classList.toggle("neutral", on && mine === "");
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }
    host.querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => {
        value = b.dataset.v || "";
        render();
        onChange();
      });
    });
    render();
    return {
      get value() { return value; },
      set(v) { value = v || ""; render(); },
      clear() { value = ""; render(); },
    };
  }

  const SHORT_PROGRAM = {
    0: "Section 515",
    1: "514 Off-Farm",
    2: "514 On-Farm",
  };

  /* Which text inputs map to which saved key. */
  const TEXT_FIELDS = [
    ["f-q", "q"], ["f-city", "city"],
    ["f-units-min", "minUnits"], ["f-units-max", "maxUnits"],
    ["f-exit-min", "minExit"], ["f-exit-max", "maxExit"],
  ];

  let presentStates = new Set();

  /** County lookup built once from the index: by FIPS, and grouped by state. */
  function countyList() {
    const byFips = new Map();
    const byState = new Map();
    for (const r of index) {
      if (!r.fips || byFips.has(r.fips)) continue;
      const short = r.county || `FIPS ${r.fips}`;
      const entry = { fips: r.fips, short, state: r.state, name: `${short}, ${r.state}` };
      byFips.set(r.fips, entry);
      if (!byState.has(r.state)) byState.set(r.state, []);
      byState.get(r.state).push(entry);
    }
    for (const list of byState.values()) list.sort((a, b) => a.short.localeCompare(b.short));
    const all = [...byFips.values()].sort((a, b) => a.name.localeCompare(b.name));
    presentStates = new Set(byState.keys());
    return { byFips, byState, all };
  }

  /* State entry takes a code or a name, whole or partial, so "VA", "Virg"
     and "Virginia" all resolve to the same place. */
  /** States handed over in the URL, as a list. One link can carry several,
      comma separated, so a multi-state view survives a click-through. */
  function statesFromUrl() {
    const raw = new URLSearchParams(location.search).get("state") || "";
    return raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  }

  function stateMatches(term) {
    const t = norm(term);
    const codes = Object.keys(STATE_NAMES);
    if (!t) return codes;
    const scored = [];
    for (const code of codes) {
      const name = norm(STATE_NAMES[code]);
      let rank = null;
      if (code.toLowerCase() === t) rank = 0;
      else if (code.toLowerCase().startsWith(t)) rank = 1;
      else if (name.startsWith(t)) rank = 2;
      else if (name.includes(t)) rank = 3;
      if (rank !== null) scored.push({ code, rank, len: STATE_NAMES[code].length });
    }
    // Where two states share a prefix, the shorter name is the one meant:
    // "Virg" is Virginia, not the Virgin Islands.
    scored.sort((a, b) => a.rank - b.rank || a.len - b.len
                          || a.code.localeCompare(b.code));
    return scored.map((x) => x.code);
  }

  function norm(v) {
    return String(v || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  }


  /* ------------------------------------------------------- the Prime Score

     Factors arrive from the build already ranked 0..1 against the whole
     portfolio. Weighting happens here so the sliders move the score with no
     rebuild. A factor with no data drops out and the remaining weights
     renormalize, so a property is scored on what is known rather than
     punished for a gap in USDA's file. */

  const PRIME_FACTORS = [
    { key: "size", label: "Size", hint: "Units, ranked against the portfolio" },
    { key: "market", label: "Market", hint: "HUD area median income for the county" },
    { key: "other_subsidy", label: "Other subsidy", hint: "LIHTC or a Section 8 contract already in place" },
    { key: "unassisted_upside", label: "Unassisted upside", hint: "Share of units without rental assistance" },
    { key: "section8", label: "Section 8", hint: "Share of units on a project-based contract" },
    { key: "prepay", label: "Prepayment", hint: "How soon the loan can be prepaid, discounted for minority impact under 7 CFR 3560.658(b)" },
  ];

  /* Shown at the top of the weights panel. The short version repeats as the
     column header tooltip, for anyone who never opens the panel. */
  const PRIME_SUMMARY = "Prime Score ranks how attractive a property looks as an "
    + "acquisition target, from 0 to 100. It is a relative score, not a grade: 80 "
    + "means the property scores better than roughly 80% of USDA's portfolio, not "
    + "that it is 80% good.";

  const PRIME_EXPLAINER = `
    <p><b>Prime Score</b> ranks how attractive a property looks as an acquisition
    target, from 0 to 100. It is a relative score, not a grade: 80 means the
    property scores better than roughly 80% of USDA's portfolio, not that it is
    80% good.</p>
    <p>Six factors go in, each one a percentile rank against all
    <span id="prime-n">12,449</span> properties: size, the county's area median
    income, whether another subsidy is already in place, the share of units
    without rental assistance, the share of tenants on Section 8, and how soon
    the loan can be prepaid. The prepayment factor is discounted where a high
    share of minority tenants makes USDA approval of prepayment less likely,
    which is the test in 7 CFR 3560.658(b).</p>
    <p>The weights are yours to move, and start where the original Excel model
    had them. Where a factor has no data it drops out and the rest are
    reweighted, so a property is never punished for a gap in USDA's file. Every
    property's page shows its own breakdown.</p>`;

  const PRIME_DEFAULTS = {
    size: 2, market: 2, other_subsidy: 1, unassisted_upside: 1, section8: 3, prepay: 4,
  };

  // How hard a high minority share discounts the prepayment component. USDA
  // weighs minority impact when deciding prepayment, so it belongs to whether
  // this loan can be prepaid, not to the property's general quality.
  const MINORITY_DISCOUNT = 0.5;

  const PRIME_KEY = "atlas.weights";

  function primeWeights() {
    try {
      const raw = sessionStorage.getItem(PRIME_KEY);
      if (raw) return { ...PRIME_DEFAULTS, ...JSON.parse(raw) };
    } catch (e) {}
    return { ...PRIME_DEFAULTS };
  }

  function setPrimeWeights(w) {
    try { sessionStorage.setItem(PRIME_KEY, JSON.stringify(w)); } catch (e) {}
  }

  function primeScore(record, weights) {
    const f = record.factors;
    if (!f) return null;
    const w = weights || primeWeights();
    let used = 0, total = 0;
    const parts = {};
    for (const { key } of PRIME_FACTORS) {
      let v = f[key];
      if (v === null || v === undefined) { parts[key] = null; continue; }
      if (key === "prepay" && f.minority !== null && f.minority !== undefined) {
        v = v * (1 - MINORITY_DISCOUNT * f.minority);
      }
      parts[key] = v;
      used += v * w[key];
      total += w[key];
    }
    if (!total) return null;
    return {
      score: Math.round((100 * used) / total * 10) / 10,
      parts,
      used: Object.values(parts).filter((x) => x !== null).length,
      possible: PRIME_FACTORS.length,
    };
  }

  /** The breakdown, for the detail page. */
  function primeBreakdown(record) {
    const w = primeWeights();
    const s = primeScore(record, w);
    if (!s) return '<p class="note">Not enough data to score this property.</p>';
    const rows = PRIME_FACTORS.map(({ key, label, hint }) => {
      const v = s.parts[key];
      const share = v === null ? 0 : (v * w[key]);
      return `<tr>
        <th>${esc(label)}<span class="fhint">${esc(hint)}</span></th>
        <td class="num">${v === null ? "&ndash;" : Math.round(v * 100)}</td>
        <td class="num">${w[key]}</td>
        <td class="bar"><span style="width:${v === null ? 0 : Math.round(v * 100)}%"></span></td>
      </tr>`;
    }).join("");
    return `
      <div class="primehead"><b>${s.score}</b><span>out of 100, from ${s.used} of ${s.possible} factors</span></div>
      <table class="primetable">
        <thead><tr><th>Factor</th><th class="num">Rank</th><th class="num">Weight</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="note">Each factor is a percentile rank against the whole portfolio, so 80
      means larger, or better placed, than 80% of USDA's properties. A factor with no data
      drops out and the rest are reweighted rather than scoring it zero.</p>
      <p class="primefoot">The score only means anything against the portfolio as it
      stands today, so it shifts a little every time the data is refreshed.</p>`;
  }

  /* ---------------------------------------------------------- filtering */

  /* Live controls, keyed by page. buildFilterBar fills this in. */
  let FIELDS = null;

  function readFilters(root) {
    const el = (id) => root.querySelector("#" + id);
    const numOf = (id) => {
      const v = parseInt((el(id) || {}).value || "", 10);
      return Number.isFinite(v) ? v : null;
    };
    return {
      q: ((el("f-q") || {}).value || "").trim().toLowerCase(),
      city: ((el("f-city") || {}).value || "").trim().toLowerCase(),
      states: FIELDS ? FIELDS.state.values : [],
      counties: FIELDS ? FIELDS.county.values : [],
      programs: FIELDS ? FIELDS.program.values : [],
      rentals: FIELDS ? FIELDS.rental.values : [],
      lihtc: FIELDS ? FIELDS.lihtc.value : "",
      subsidy: FIELDS ? FIELDS.subsidy.value : "",
      prepay: FIELDS ? FIELDS.prepay.value : "",
      minUnits: numOf("f-units-min"),
      maxUnits: numOf("f-units-max"),
      minExit: numOf("f-exit-min"),
      maxExit: numOf("f-exit-max"),
      mgmt: managerParam(),
      onlySelected: onlySelected(),
    };
  }

  /** How many filters are actually narrowing the view. Drives Clear all. */
  function activeCount(f) {
    let n = 0;
    if (f.q) n += 1;
    if (f.city) n += 1;
    n += f.states.length ? 1 : 0;
    n += f.counties.length ? 1 : 0;
    n += f.programs.length ? 1 : 0;
    n += f.rentals.length ? 1 : 0;
    if (f.lihtc) n += 1;
    if (f.subsidy) n += 1;
    if (f.prepay) n += 1;
    if (f.minUnits !== null || f.maxUnits !== null) n += 1;
    if (f.minExit !== null || f.maxExit !== null) n += 1;
    if (f.onlySelected) n += 1;
    return n;
  }

  function apply(filters) {
    const thisYear = new Date().getFullYear();
    const f = filters;
    const states = f.states && f.states.length ? new Set(f.states) : null;
    const counties = f.counties && f.counties.length ? new Set(f.counties) : null;
    const programs = f.programs && f.programs.length ? new Set(f.programs.map(String)) : null;
    const rentals = f.rentals && f.rentals.length ? new Set(f.rentals) : null;
    const picked = f.onlySelected ? selectionIds() : null;

    return index.filter((r) => {
      if (picked && !picked.has(String(r.id))) return false;
      if (states && !states.has(r.state)) return false;
      if (counties && !counties.has(String(r.fips))) return false;
      if (programs && !programs.has(String(r.program_code))) return false;
      if (rentals && !rentals.has(r.rental_code)) return false;

      if (f.lihtc === "y" && !r.lihtc) return false;
      if (f.lihtc === "n" && r.lihtc) return false;
      /* Has Subsidy. Four of the five options are property-level contract
         facts, so they sit alongside each other and mean the same kind of
         thing. "Other" is Section 202/811 PRAC and PRA, which the Section 8
         column also counts as a Yes, marked with an asterisk; the option is a
         way into that subset rather than a contradiction of it. "None" keeps
         the unassisted case reachable, which is what the Prime Score's
         unassisted upside factor weights. */
      if (f.subsidy === "ra" && !(r.ra_units > 0)) return false;
      if (f.subsidy === "s8" && !(r.s8 && r.s8_is_hap === true)) return false;
      if (f.subsidy === "other" && !(r.s8 && r.s8_is_hap !== true)) return false;
      if (f.subsidy === "none" && (r.ra_units > 0 || r.s8)) return false;
      if (f.prepay === "y" && !r.prepay_eligible_now) return false;
      if (f.prepay === "n" && r.prepay_eligible_now) return false;

      const units = r.units || 0;
      if (f.minUnits !== null && f.minUnits !== undefined && units < f.minUnits) return false;
      if (f.maxUnits !== null && f.maxUnits !== undefined && units > f.maxUnits) return false;

      // Years to exit, as a window rather than a ceiling, so "5 to 15" is
      // expressible and not just "within 10".
      if (f.minExit !== null && f.minExit !== undefined
          || f.maxExit !== null && f.maxExit !== undefined) {
        if (!r.exit_year) return false;
        const out = r.exit_year - thisYear;
        if (f.minExit !== null && f.minExit !== undefined && out < f.minExit) return false;
        if (f.maxExit !== null && f.maxExit !== undefined && out > f.maxExit) return false;
      }

      if (f.mgmt && normManager(r.management) !== f.mgmt) return false;

      if (f.city && !String(r.city || "").toLowerCase().includes(f.city)) return false;

      if (f.q) {
        const hay = `${r.name} ${r.management || ""} ${r.county || ""}`.toLowerCase();
        if (!hay.includes(f.q)) return false;
      }
      return true;
    });
  }

  function summarize(rows) {
    const thisYear = new Date().getFullYear();
    let units = 0, ra = 0, exiting = 0, lihtc = 0;
    rows.forEach((r) => {
      units += r.units || 0;
      ra += r.ra_units || 0;
      if (r.exit_year && r.exit_year - thisYear <= 10) exiting += 1;
      if (r.lihtc) lihtc += 1;
    });
    return {
      properties: rows.length,
      units,
      ra,
      raShare: units ? ra / units : null,
      exiting,
      lihtc,
      avgSize: rows.length ? Math.round(units / rows.length) : 0,
    };
  }

  /* ---------------------------------------------------------- filter bar */

  /* Filter state is shared between the table and the map, which carry the
     same controls. Serializing it to sessionStorage means a search survives
     the jump from one view to the other, and survives the back button,
     without putting a long query string in front of the reader. Session
     rather than local, so a new tab starts clean. */
  /* ------------------------------------------------- the selected-only view

     Selecting properties and then asking to see only those is a filter like
     any other, so it runs through apply() with the rest rather than being
     bolted onto the table. select.js owns the checkboxes and writes the id
     list; this reads it. Keeping the flag in sessionStorage means the view
     survives a jump between the table and the map, which is the point: you
     pick five, then you want those five on the map too. */

  const SELECTION_KEY = "atlas.selection";
  const ONLY_KEY = "atlas.only_selected";

  function selectionIds() {
    try {
      const raw = sessionStorage.getItem(SELECTION_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(list) ? list.map(String) : []);
    } catch (e) { return new Set(); }
  }

  function onlySelected() {
    try { return sessionStorage.getItem(ONLY_KEY) === "1"; } catch (e) { return false; }
  }

  /* An empty selection with the flag on would show an empty table and no clue
     why, so the flag cannot be on without something selected. */
  function setOnlySelected(on) {
    const live = Boolean(on) && selectionIds().size > 0;
    try {
      if (live) sessionStorage.setItem(ONLY_KEY, "1");
      else sessionStorage.removeItem(ONLY_KEY);
    } catch (e) {}
    return live;
  }

  /* The flag reaches pages that have no checkbox to turn it off, so every page
     that filters says so and offers the way out. */
  function paintSelectionBanner(root) {
    const anchor = root.querySelector("#mgmt-banner");
    let host = root.querySelector("#sel-banner");
    if (!onlySelected()) {
      if (host) { host.hidden = true; host.innerHTML = ""; }
      return;
    }
    if (!host) {
      host = document.createElement("div");
      host.className = "chip-banner";
      host.id = "sel-banner";
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(host, anchor);
      else root.body && root.body.prepend(host);
    }
    const picked = selectionIds();
    const rows = index.filter((r) => picked.has(String(r.id)));
    const units = rows.reduce((n, r) => n + (r.units || 0), 0);
    const onMap = /map\.html/.test(location.pathname);
    host.hidden = false;
    host.innerHTML =
      `<span>Showing <strong>your selection only</strong>:
        ${rows.length.toLocaleString()} ${rows.length === 1 ? "property" : "properties"},
        ${units.toLocaleString()} units</span>
       <a href="${onMap ? "index.html" : "map.html"}">${onMap ? "See them in the table" : "See them on the map"}</a>
       <a href="#" id="sel-banner-off">Show all properties</a>`;
    const off = host.querySelector("#sel-banner-off");
    if (off) {
      off.addEventListener("click", (e) => {
        e.preventDefault();
        setOnlySelected(false);
        refreshView();
      });
    }
  }

  /* ----------------------------------------------------- saved portfolios

     A selection is worth naming. Five properties picked out of twelve
     thousand is a piece of work, and losing it when the tab closes is the
     difference between a tool and a toy.

     These live in localStorage rather than the session, so they survive the
     browser closing. That makes them per browser and per machine: a portfolio
     saved on a laptop is not on a phone, and a colleague cannot see it. The
     share link below is the answer to that for now, and the seam for moving
     the store behind the Worker later is deliberately narrow, which is
     listPortfolios, savePortfolio and removePortfolio. Nothing else in the
     app touches the storage. */

  const PORTFOLIO_KEY = "atlas.portfolios";
  const PORTFOLIO_LIMIT = 40;

  function listPortfolios() {
    try {
      const raw = localStorage.getItem(PORTFOLIO_KEY);
      const list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      return list.filter((p) => p && p.name && Array.isArray(p.ids));
    } catch (e) { return []; }
  }

  function writePortfolios(list) {
    try {
      localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(list.slice(0, PORTFOLIO_LIMIT)));
      return true;
    } catch (e) {
      // Storage disabled or full. Saying so beats a button that silently does
      // nothing, so the caller gets the failure back.
      return false;
    }
  }

  /* Saving the same name twice replaces it rather than leaving two entries
     that differ only in what they hold, which is how a saved list turns into
     a junk drawer. */
  function savePortfolio(name, ids) {
    const clean = String(name || "").trim();
    if (!clean) return null;
    const list = listPortfolios().filter((p) => p.name.toLowerCase() !== clean.toLowerCase());
    const entry = {
      name: clean,
      ids: [...new Set((ids || []).map(String))],
      savedAt: new Date().toISOString(),
    };
    list.unshift(entry);
    return writePortfolios(list) ? entry : null;
  }

  function removePortfolio(name) {
    const clean = String(name || "").trim().toLowerCase();
    writePortfolios(listPortfolios().filter((p) => p.name.toLowerCase() !== clean));
  }

  /* Adding is its own operation rather than a second meaning for save,
     because saving under a name that already exists replaces that portfolio
     outright, and the two intentions sit one click apart. Neither of these
     touches savedAt. A portfolio keeps the date it was created and carries
     updatedAt separately, so the card cannot claim a property added today was
     saved today. */
  function addToPortfolio(name, ids) {
    const list = listPortfolios();
    const hit = list.find(
      (p) => p.name.toLowerCase() === String(name || "").trim().toLowerCase());
    if (!hit) return null;
    const before = hit.ids.length;
    hit.ids = [...new Set([...hit.ids.map(String), ...(ids || []).map(String)])];
    hit.updatedAt = new Date().toISOString();
    if (!writePortfolios(list)) return null;
    return { entry: hit, added: hit.ids.length - before, already: (ids || []).length - (hit.ids.length - before) };
  }

  function removeFromPortfolio(name, ids) {
    const list = listPortfolios();
    const hit = list.find(
      (p) => p.name.toLowerCase() === String(name || "").trim().toLowerCase());
    if (!hit) return null;
    const drop = new Set((ids || []).map(String));
    const before = hit.ids.length;
    hit.ids = hit.ids.filter((id) => !drop.has(String(id)));
    hit.updatedAt = new Date().toISOString();
    if (!writePortfolios(list)) return null;
    return { entry: hit, removed: before - hit.ids.length };
  }

  /* Renaming in place keeps the saved date and the position in the list. A
     name already in use is refused rather than quietly swallowing the other
     portfolio, which is what saving over it would do. */
  function renamePortfolio(oldName, newName) {
    const from = String(oldName || "").trim().toLowerCase();
    const to = String(newName || "").trim();
    if (!to) return null;
    const list = listPortfolios();
    const hit = list.find((p) => p.name.toLowerCase() === from);
    if (!hit) return null;
    const clash = list.find(
      (p) => p !== hit && p.name.toLowerCase() === to.toLowerCase());
    if (clash) return null;
    hit.name = to;
    return writePortfolios(list) ? hit : null;
  }

  /* A saved portfolio is a fixed list, so loading it has to mean "show exactly
     these". Leaving a state or unit filter in place would hide half of what
     was just loaded and look like data loss, so the filters come off. */
  function loadPortfolio(name) {
    const hit = listPortfolios().find(
      (p) => p.name.toLowerCase() === String(name || "").trim().toLowerCase());
    if (!hit) return null;
    adoptSelection(hit.ids);
    return hit;
  }

  /* The same thing for a bare list of ids, which is what a portfolio that
     arrived on a share link and was never saved amounts to. */
  function adoptSelection(ids) {
    clearFilters();
    /* clearFilters only reaches a filter bar that exists. This runs from the
       Portfolios tab and the portfolio page, neither of which has one, so the
       stored filters have to be dropped directly or they come back with the
       table. */
    clearStoredFilters();
    const clean = [...new Set((ids || []).map(String))];
    try { sessionStorage.setItem(SELECTION_KEY, JSON.stringify(clean)); } catch (e) {}
    setOnlySelected(true);
    return clean;
  }

  /* Portfolios do not sync between machines, so a link is how one reaches a
     colleague. The ids are the whole payload; the atlas resolves them. */
  /* The link lands on the portfolio's own page rather than the table, because
     a colleague opening it wants to read the portfolio, not inherit a filtered
     table. index.html still honors the same two parameters, so links shared
     before this change keep working. */
  function portfolioLink(entry) {
    const u = new URL("portfolio.html", location.href);
    u.searchParams.set("portfolio", entry.name);
    u.searchParams.set("sel", entry.ids.join(","));
    return u.toString();
  }

  function portfolioFromUrl() {
    const q = new URLSearchParams(location.search);
    const sel = q.get("sel");
    if (!sel) return null;
    const ids = sel.split(",").map((x) => x.trim()).filter(Boolean);
    if (!ids.length) return null;
    return { name: q.get("portfolio") || "Shared selection", ids };
  }

  let clearFilters = () => {};

  /* The page hands its own repaint to buildFilterBar. Holding on to it lets
     anything that changes a filter outside the bar, such as the selection
     tray, redraw the page without each page exporting its own hook. */
  let pageRefresh = null;
  function refreshView() {
    paintSelectionBanner(document);
    if (pageRefresh) pageRefresh();
  }

  const FILTER_KEY = "atlas.filters";

  function saveFilters(root) {
    const f = readFilters(root);
    const out = {
      states: f.states, counties: f.counties, programs: f.programs, rentals: f.rentals,
      lihtc: f.lihtc, subsidy: f.subsidy, prepay: f.prepay,
      q: f.q, city: f.city,
      minUnits: f.minUnits, maxUnits: f.maxUnits,
      minExit: f.minExit, maxExit: f.maxExit,
    };
    try { sessionStorage.setItem(FILTER_KEY, JSON.stringify(out)); } catch (e) {}
  }

  function storedFilters() {
    try {
      const raw = sessionStorage.getItem(FILTER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function clearStoredFilters() {
    try { sessionStorage.removeItem(FILTER_KEY); } catch (e) {}
  }

  function buildFilterBar(root, onChange) {
    const counties = countyList();
    pageRefresh = onChange;

    function fire() {
      saveFilters(root);
      paintClear();
      paintSelectionBanner(root);
      onChange();
    }

    const state = chipField(root.querySelector("#w-state .chipbox"), {
      placeholder: "VA, Virginia",
      label: (code) => code,
      onChange: () => { FIELDS.county.set(prunedCounties()); fire(); },
      search: (term, chosen) => stateMatches(term)
        .filter((c) => !chosen.includes(c) && presentStates.has(c))
        .map((c) => ({ value: c, label: c, hint: STATE_NAMES[c] })),
    });

    const county = chipField(root.querySelector("#w-county .chipbox"), {
      placeholder: "Start typing",
      // The chip carries the state, since two states can hold a Richmond County.
      label: (fips) => {
        const c = counties.byFips.get(fips);
        return c ? `${c.short}, ${c.state}` : fips;
      },
      onChange: fire,
      search: (term, chosen) => {
        const t = norm(term);
        const picked = state.values;
        // Counties narrow to the chosen states, which keeps a name like
        // Richmond County from returning three of them.
        let pool = picked.length
          ? picked.flatMap((st) => counties.byState.get(st) || [])
          : counties.all;
        if (t) pool = pool.filter((c) => norm(c.short).startsWith(t));
        else pool = pool.slice(0, 10);
        return pool
          .filter((c) => !chosen.includes(c.fips))
          .map((c) => ({ value: c.fips, label: c.short, hint: c.state }));
      },
    });

    const program = chipField(root.querySelector("#w-program .chipbox"), {
      placeholder: "515, 514",
      label: (code) => SHORT_PROGRAM[code] || PROGRAMS[code] || code,
      onChange: fire,
      search: (term, chosen) => {
        const t = norm(term);
        return Object.keys(PROGRAMS)
          .filter((k) => !chosen.includes(k))
          .filter((k) => !t || norm(PROGRAMS[k]).includes(t) || String(k) === t
                          || norm(SHORT_PROGRAM[k]).includes(t))
          .map((k) => ({ value: k, label: SHORT_PROGRAM[k], hint: PROGRAMS[k] }));
      },
    });

    const rental = chipField(root.querySelector("#w-rental .chipbox"), {
      placeholder: "Family, elderly",
      label: (code) => RENTAL[code] || code,
      onChange: fire,
      search: (term, chosen) => {
        const t = norm(term);
        return Object.keys(RENTAL)
          .filter((k) => !chosen.includes(k))
          .filter((k) => !t || norm(RENTAL[k]).startsWith(t) || k.toLowerCase() === t)
          .map((k) => ({ value: k, label: RENTAL[k], hint: k }));
      },
    });

    FIELDS = {
      state, county, program, rental,
      lihtc: segField(root.querySelector("#w-lihtc"), fire),
      subsidy: segField(root.querySelector("#w-subsidy"), fire),
      prepay: segField(root.querySelector("#w-prepay"), fire),
    };

    /** Drop any chosen county that no longer sits in a chosen state. */
    function prunedCounties() {
      const picked = state.values;
      if (!picked.length) return county.values;
      const ok = new Set(picked.flatMap((st) =>
        (counties.byState.get(st) || []).map((c) => c.fips)));
      return county.values.filter((f) => ok.has(f));
    }

    function paintClear() {
      const btn = root.querySelector("#f-reset");
      if (!btn) return;
      const n = activeCount(readFilters(root));
      btn.classList.toggle("armed", n > 0);
      btn.textContent = n > 0 ? `Clear all (${n})` : "Clear all";
    }

    // Restore the last search, then let an explicit link override it.
    const saved = storedFilters();
    if (saved) {
      state.set((saved.states || []).filter((c) => presentStates.has(c)));
      county.set(saved.counties || []);
      program.set(saved.programs || []);
      rental.set(saved.rentals || []);
      FIELDS.lihtc.set(saved.lihtc);
      /* A session saved before Has Subsidy existed carries the old rental
         assistance toggle. Carry it across rather than dropping the reader's
         search on the floor. */
      FIELDS.subsidy.set(saved.subsidy !== undefined ? saved.subsidy
        : saved.ra === "y" ? "ra"
        : saved.ra === "n" ? "none"
        : "");
      FIELDS.prepay.set(saved.prepay);
      for (const [id, key] of TEXT_FIELDS) {
        const el = root.querySelector("#" + id);
        if (el && saved[key] !== undefined && saved[key] !== null) el.value = saved[key];
      }
    }
    const urlStates = statesFromUrl().filter((c) => presentStates.has(c));
    if (urlStates.length) {
      state.set(urlStates);
      county.set([]);
    }

    root.querySelectorAll('#filterbar input[type="search"], #filterbar input[type="number"]')
      .forEach((el) => el.addEventListener("input", fire));

    /* Shared with loadPortfolio, which needs the same reset without the
       side effect of turning the selected-only view off. */
    clearFilters = () => {
      Object.values(FIELDS).forEach((f) => f.clear());
      root.querySelectorAll('#filterbar input[type="search"], #filterbar input[type="number"]')
        .forEach((el) => { el.value = ""; });
      clearStoredFilters();
      paintClear();
    };

    root.querySelector("#f-reset")?.addEventListener("click", () => {
      clearFilters();
      setOnlySelected(false);
      paintSelectionBanner(root);
      onChange();
    });

    paintClear();
    paintSelectionBanner(root);
  }

  function closeDrawer() {
    document.querySelectorAll(".drawer, .drawer-backdrop").forEach((el) => el.remove());
    document.body.classList.remove("drawer-open");
  }

  /** The body of a property's detail, shared by the slide-over drawer and the
      standalone detail page so the two can never drift apart. */
  function detailSections(d) {
    const beds = d.beds || {};
    const mix = [1, 2, 3, 4, 5, 6]
      .filter((n) => (beds[n] || 0) > 0)
      .map((n) => `<div class="cell"><b>${beds[n]}</b><span>${n} BR</span></div>`)
      .join("") || '<div class="cell"><b>-</b><span>not stated</span></div>';

    const cls = horizonClass(d.exit_year);
    const exitLabel = horizonLabel(d.exit_year);

    return `
      <section>
        <h3>Prime Score</h3>
        ${primeBreakdown(d)}
      </section>

      <section>
        <h3>Program exit</h3>
        <dl class="kv">
          <dt>Estimated exit year</dt><dd><span class="pill ${cls}">${exitLabel}</span></dd>
          <dt>Estimated exit date</dt><dd>${esc(d.exit_date) || "-"}</dd>
          <dt>Loan payoff year</dt><dd>${d.loan_payoff_year || "-"}</dd>
          <dt>Prepay eligible year</dt><dd>${d.prepay_eligible_year || "-"}</dd>
          <dt>Prepay eligible now</dt><dd>${d.prepay_eligible_now === null ? "-" : d.prepay_eligible_now ? "Yes" : "No"}</dd>
          <dt>Natural maturity</dt><dd>${esc(d.natural_maturity) || "-"}</dd>
          <dt>UPB maturity</dt><dd>${esc(d.upb_maturity) || "-"}</dd>
          <dt>Balloon payment</dt><dd>${d.balloon === null ? "-" : d.balloon ? "Yes" : "No"}</dd>
        </dl>
      </section>

      <section>
        <h3>Units</h3>
        <dl class="kv">
          <dt>Total units</dt><dd>${num(d.units)}</dd>
          <dt>Rental assistance units</dt><dd>${num(d.ra_units)} ${d.ra_share !== null ? `(${pct(d.ra_share)})` : ""}</dd>
          <dt>Vacant units</dt><dd>${num(d.vacant_units)}</dd>
          <dt>Accessible units</dt><dd>${num(d.handicapped_units)}</dd>
        </dl>
        <div style="height:9px"></div>
        <div class="mix">${mix}</div>
      </section>

      <section>
        <h3>Project-based Section 8</h3>
        <dl class="kv">
          <dt>HAP contract</dt><dd>${d.s8 ? "Yes" : "No"}</dd>
          ${d.s8 ? `
          <dt>Contract number</dt><dd>${esc(d.s8_contract) || "-"}</dd>
          <dt>Contract units</dt><dd>${num(d.s8_units)}</dd>
          <dt>Contract expires</dt><dd>${esc(d.s8_expires) || "-"}</dd>
          <dt>HUD program type</dt><dd>${esc(d.s8_program_type) || "-"}</dd>
          <dt>Contract family</dt><dd>${
            d.s8_is_hap
              ? 'Section 8 HAP'
              : `${esc(d.s8_doc_type) || "other"} <span class="warn">(not Section 8)</span>`
          }</dd>` : ""}
        </dl>
        <p class="note">
          ${d.s8
            ? `${d.s8_is_hap ? "" : `<b>Mark-up-to-market does not apply here.</b> This is
                  Section 202 or 811 project rental assistance, not Section 8, so there is no
                  comparability-study path and rents move by budget-based adjustment. `}
               Matched to the PBS8 Database on ${esc((d.s8_match || {}).evidence || "name")}.
               ${(d.s8_match || {}).review
                 ? `<b>Worth a check:</b> the names differ and the contract covers well under
                    the property's unit count, so this address may hold two buildings.`
                 : ""}
               Contract rents, renewal option and rent-to-SAFMR live in the PBS8 Database
               rather than here, so nothing is duplicated between the two.`
            : `USDA's file carries no Section 8 flag, so this is matched against the PBS8
               Database on address, ZIP, county and name. A property with a contract HUD
               records under a different name or address can read as No.`}
        </p>
        <p><a href="${hapDeepLink(d)}" target="_blank" rel="noopener">${
          d.s8 ? "Open this property in the PBS8 Database" : "Open the PBS8 Database"
        }</a></p>
      </section>

      <section>
        <h3>Management fee ceiling</h3>
        <dl class="kv">
          <dt>Maximum fee</dt><dd>${d.mgmt_fee_max
            ? `${money(d.mgmt_fee_max)} per occupied unit per month`
            : "<span class=\"muted\">no published fee for this state</span>"}</dd>
          ${d.mgmt_fee_annual_max ? `
          <dt>Annual ceiling</dt><dd>${money(d.mgmt_fee_annual_max)}
            <span class="muted">on ${num(d.occupied_units)} occupied of ${num(d.units)} units</span></dd>` : ""}
          ${d.mgmt_fee_offroad ? `
          <dt>Off-road communities</dt><dd>${money(d.mgmt_fee_offroad)}
            <span class="muted">a separate, higher line in this state</span></dd>` : ""}
        </dl>
        ${d.mgmt_fee_max ? `<p class="note">USDA's ceiling on what an owner may pay a management
        agent, from ${esc(d.mgmt_fee_source || "HB-2-3560 Attachment 3-F")}. It is a maximum and
        not an estimate of what this property actually pays. The annual figure applies the rate to
        occupied units, which is the basis the handbook states; occupancy here is USDA's unit count
        less its vacant count, on the file's as-of date.
        ${d.mgmt_fee_offroad ? `The handbook prints a second, higher fee for off-road communities
        in this state and USDA publishes nothing that says which side of that line a property sits
        on, so the standard rate is shown and the other is noted.` : ""}</p>` : ""}
      </section>

      <section>
        <h3>Affordability</h3>
        <dl class="kv">
          <dt>LIHTC financed</dt><dd>${d.lihtc === null ? "-" : d.lihtc ? "Yes" : "No"}</dd>
          <dt>Tax credit expires</dt><dd>${esc(d.lihtc_expires) || "-"}</dd>
          <dt>Restrictive clause expires</dt><dd>${esc(d.restrictive_clause_expires) || "-"}</dd>
          <dt>MPR revitalized</dt><dd>${d.revitalized ? "Yes" : "No"}</dd>
        </dl>
      </section>

      ${designationSection(d)}

      <section>
        <h3>Ownership and loan</h3>
        <dl class="kv">
          <dt>Borrower</dt><dd>${titleCase(d.borrower_name) || "-"}</dd>
          <dt>Borrower type</dt><dd>${esc(d.borrower_type) || "-"}</dd>
          <dt>Borrower location</dt><dd>${placeCase(d.borrower_city_state) || "-"}</dd>
          <dt>Management agent</dt><dd>${titleCase(d.management) || "-"}</dd>
          <dt>Profit type</dt><dd>${esc(d.profit_type) || "-"}</dd>
          <dt>Loan amount (source)</dt><dd>${money(d.loan_amt) || "-"}</dd>
          <dt>Rate at closing</dt><dd>${d.interest_rate !== null && d.interest_rate !== undefined ? d.interest_rate + "%" : "-"}</dd>
          <dt>Original loan term</dt><dd>${d.orig_loan_term ? Number(d.orig_loan_term).toFixed(2).replace(/\.00$/, "") + " yrs" : "-"}</dd>
          <dt>FY of obligation</dt><dd>${d.fy_loan_obligation || "-"}</dd>
          <dt>Remaining term</dt><dd>${d.remaining_term_days ? Math.round(d.remaining_term_days).toLocaleString() + " days" : "-"}</dd>
          <dt>Date of operation</dt><dd>${esc(d.date_of_operation) || "-"}</dd>
        </dl>
      </section>

      <section>
        <h3>Identifiers</h3>
        <dl class="kv">
          <dt>Program</dt><dd>${esc(d.program) || "-"}</dd>
          <dt>Tenant type</dt><dd>${esc(d.rental_type) || "-"}</dd>
          <dt>Borrower / project / check</dt><dd>${esc(d.borrower_id) || "?"} / ${esc(d.project_id) || "?"} / ${esc(d.check_digit) || "?"}</dd>
          <dt>MFIS project key</dt><dd>${esc(d.id)}</dd>
          <dt>County FIPS</dt><dd>${esc(d.fips) || "-"}${d.county ? " (" + esc(d.county) + ")" : ""}</dd>
          <dt>Coordinates</dt><dd>${d.lat && d.lon ? `${d.lat.toFixed(5)}, ${d.lon.toFixed(5)}` : "-"}</dd>
        </dl>
        ${d.lat && d.lon ? `<p class="note"><a href="https://www.google.com/maps?q=${d.lat},${d.lon}" target="_blank" rel="noopener">Open in Google Maps</a></p>` : ""}
        <p class="note">Loan figures come from the single loan record USDA publishes per property in the program exit file. A property can carry more debt than one line shows.</p>
      </section>
    `;
  }

  /** QCT, DDA and USDA rural eligibility, for the detail page and drawer. */
  function designationSection(d) {
    const y = desigYears();
    const yn = (v) => (v === null || v === undefined ? "-" : v ? "Yes" : "No");
    const hasAny = d.tract || d.qct !== undefined || d.rd_eligible !== undefined;
    if (!hasAny) return "";
    const change = (a, b, what) => (a === false && b === true
      ? ` <span class="pill basis-new">becomes ${what} ${y.next}</span>`
      : a === true && b === false ? ` <span class="pill basis-leave">drops off ${y.next}</span>` : "");
    const tract = d.tract ? `${d.tract.slice(5, 9).replace(/^0+/, "") || "0"}.${d.tract.slice(9)}` : null;
    const usdaDate = d.rd_checked ? (() => { const [yy, mm, dd] = d.rd_checked.split("-"); return `${mm}/${dd}/${yy}`; })() : null;
    return `
      <section>
        <h3>QCT, DDA and USDA rural eligibility</h3>
        <dl class="kv">
          <dt>Census tract</dt><dd>${tract ? `${esc(tract)} <span class="muted">${esc(d.tract)}</span>` : "-"}</dd>
          <dt>QCT ${y.now || ""}</dt><dd>${yn(d.qct)}</dd>
          ${y.next ? `<dt>QCT ${y.next}</dt><dd>${yn(d.qct_next)}${change(d.qct, d.qct_next, "QCT")}</dd>` : ""}
          <dt>DDA ${y.now || ""}</dt><dd>${yn(d.dda)}${d.dda ? ` <span class="muted">${esc(d.dda_basis || "")}${d.dda_area ? ", " + esc(d.dda_area) : ""}</span>` : ""}</dd>
          ${y.next ? `<dt>DDA ${y.next}</dt><dd>${yn(d.dda_next)}${change(d.dda, d.dda_next, "DDA")}</dd>` : ""}
          <dt>Tract poverty rate</dt><dd>${d.tract_poverty_rate !== null && d.tract_poverty_rate !== undefined ? (d.tract_poverty_rate * 100).toFixed(1) + "%" : "-"}</dd>
          <dt>Tract median household income</dt><dd>${money(d.tract_median_income) || "-"}</dd>
          <dt>USDA rural eligible</dt><dd>${d.rd_eligible === null || d.rd_eligible === undefined ? "-"
            : d.rd_eligible ? "Yes" : '<span class="warn">No, inside an ineligible area</span>'}${usdaDate ? ` <span class="muted">checked ${usdaDate}</span>` : ""}</dd>
        </dl>
        <p class="note">QCT and DDA are HUD's designations for the year shown, matched on the census
        tract and ZCTA at USDA's coordinates. Either one qualifies a new tax credit allocation for the
        130% basis boost. HUD publishes the next year's lists each October, which is why both years
        appear. USDA rural eligibility is USDA's own ineligible-areas map, checked monthly. An existing
        loan stays in place when an area loses eligibility. New USDA financing, such as a Section 538
        guarantee or a new 515 loan, needs an eligible area.
        <a href="https://www.huduser.gov/portal/sadda/sadda_qct.html" target="_blank" rel="noopener">HUD QCT and DDA map</a> ·
        <a href="https://eligibility.sc.egov.usda.gov/eligibility/welcomeAction.do" target="_blank" rel="noopener">USDA eligibility map</a></p>
      </section>`;
  }

  /** Property detail is a page of its own now, so a click navigates rather
      than sliding a panel over the view. The back link returns to wherever
      the reader came from, and the filters are still in session storage. */
  function openDetail(record) {
    const from = /map\.html/.test(location.pathname) ? "&from=map" : "";
    location.href = `detail.html?id=${encodeURIComponent(record.id)}${from}`;
  }

  async function openDrawer(record) {
    closeDrawer();
    const backdrop = document.createElement("div");
    backdrop.className = "drawer-backdrop";
    backdrop.addEventListener("click", closeDrawer);

    const panel = document.createElement("aside");
    panel.className = "drawer";
    panel.innerHTML = '<div class="loading">Loading property detail...</div>';
    document.body.append(backdrop, panel);
    // The map's controls are hidden while this is open; see styles.css.
    document.body.classList.add("drawer-open");

    /* The shard carries the extra fields, but the row already in hand has the
       name, place and headline figures. Falling back to it means a shard that
       fails to load leaves the drawer showing less, rather than leaving it on
       "Loading property detail..." for good. */
    let d = record;
    try {
      d = (await detail(record)) || record;
    } catch (e) {
      d = record;
    }
    panel.innerHTML = `
      <header>
        <button class="close" aria-label="Close">&times;</button>
        <h2>${titleCase(d.name)}</h2>
        <div class="where">${titleCase(d.address || "")}${d.address ? ", " : ""}${titleCase(d.city)}, ${esc(d.state)} ${esc(d.zip) || ""}</div>
        <p class="drawer-more"><a href="detail.html?id=${encodeURIComponent(d.id)}">Open the full page</a></p>
      </header>
      ${detailSections(d)}
    `;

    panel.querySelector(".close").addEventListener("click", closeDrawer);
  }

  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

  return {
    PROGRAMS, RENTAL, STATE_NAMES,
    load, apply, summarize, readFilters, buildFilterBar,
    desigYears, basisNow, basisNext, basisRank, basisLabel,
    openDrawer, openDetail, detailSections, detail, paintManagerBanner, carryParamsIntoNav, horizonClass, horizonLabel, horizonColors, HORIZONS, titleCase, placeCase, num, pct, money,
    lock, unlock, signOut, sessionEmail,
    normManager, managers, managerParam,
    chipField, segField, stateMatches, statesFromUrl,
    PRIME_FACTORS, PRIME_DEFAULTS, PRIME_SUMMARY, PRIME_EXPLAINER,
    primeWeights, setPrimeWeights, primeScore, primeBreakdown,
    saveFilters, storedFilters, clearStoredFilters,
    selectionIds, onlySelected, setOnlySelected, paintSelectionBanner, refreshView,
    listPortfolios, savePortfolio, removePortfolio, renamePortfolio, loadPortfolio, adoptSelection,
    addToPortfolio, removeFromPortfolio,
    portfolioLink, portfolioFromUrl,
    clearFilters: () => clearFilters(),
    HAP_DB_URL, hapDeepLink,
    dataUrl, fetchData, download, esc, signInUrl, promptSignIn,
    get index() { return index; },
    get meta() { return meta; },
  };
})();

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

  /* ---------------------------------------------------------- filtering */

  function readFilters(root) {
    const get = (id) => root.querySelector("#" + id);
    return {
      q: (get("f-q")?.value || "").trim().toLowerCase(),
      state: get("f-state")?.value || "",
      county: get("f-county")?.value || "",
      program: get("f-program")?.value || "",
      rental: get("f-rental")?.value || "",
      lihtc: get("f-lihtc")?.value || "",
      horizon: get("f-horizon")?.value || "",
      minUnits: parseInt(get("f-units")?.value || "0", 10) || 0,
      mgmt: managerParam(),
      raOnly: get("f-ra")?.checked || false,
      prepay: get("f-prepay")?.checked || false,
    };
  }

  function apply(filters) {
    const thisYear = new Date().getFullYear();
    const horizon = filters.horizon ? thisYear + parseInt(filters.horizon, 10) : null;

    return index.filter((r) => {
      if (filters.state && r.state !== filters.state) return false;
      if (filters.county && String(r.fips) !== filters.county) return false;
      if (filters.program !== "" && String(r.program_code) !== filters.program) return false;
      if (filters.rental && r.rental_code !== filters.rental) return false;
      if (filters.lihtc === "y" && !r.lihtc) return false;
      if (filters.lihtc === "n" && r.lihtc) return false;
      if (filters.minUnits && (r.units || 0) < filters.minUnits) return false;
      if (filters.mgmt && normManager(r.management) !== filters.mgmt) return false;
      if (filters.raOnly && !(r.ra_units > 0)) return false;
      if (filters.prepay && !r.prepay_eligible_now) return false;
      if (horizon && !(r.exit_year && r.exit_year <= horizon)) return false;
      if (filters.q) {
        const hay = `${r.name} ${r.city} ${r.state} ${r.county || ""} ${r.management || ""}`.toLowerCase();
        if (!hay.includes(filters.q)) return false;
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

  function buildFilterBar(root, onChange) {
    const states = [...new Set(index.map((r) => r.state).filter(Boolean))].sort();
    const stateSel = root.querySelector("#f-state");
    states.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = `${s} - ${STATE_NAMES[s] || s}`;
      stateSel.appendChild(opt);
    });

    function refreshCounties() {
      const countySel = root.querySelector("#f-county");
      const chosen = stateSel.value;
      const seen = new Map();
      index.forEach((r) => {
        if (!r.fips) return;
        if (chosen && r.state !== chosen) return;
        if (!seen.has(r.fips)) seen.set(r.fips, r.county || `FIPS ${r.fips}`);
      });
      const sorted = [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
      countySel.innerHTML = '<option value="">All counties</option>';
      sorted.forEach(([fips, label]) => {
        const opt = document.createElement("option");
        opt.value = fips;
        opt.textContent = label;
        countySel.appendChild(opt);
      });
      countySel.disabled = sorted.length === 0;
    }

    // A state handed over in the URL (a link from the Companies page) should
    // arrive already applied, not just sitting in the query string.
    const urlState = (new URLSearchParams(location.search).get("state") || "").toUpperCase();
    if (urlState && states.includes(urlState)) stateSel.value = urlState;

    refreshCounties();
    stateSel.addEventListener("change", () => { refreshCounties(); onChange(); });

    root.querySelectorAll("select, input").forEach((el) => {
      if (el.id === "f-state") return;
      const evt = el.type === "search" || el.type === "text" || el.type === "number" ? "input" : "change";
      el.addEventListener(evt, onChange);
    });

    root.querySelector("#f-reset")?.addEventListener("click", () => {
      root.querySelectorAll("select").forEach((s) => { s.selectedIndex = 0; });
      root.querySelectorAll('input[type="search"], input[type="number"]').forEach((i) => { i.value = ""; });
      root.querySelectorAll('input[type="checkbox"]').forEach((i) => { i.checked = false; });
      refreshCounties();
      onChange();
    });
  }

  /* ---------------------------------------------------------- detail drawer */

  function closeDrawer() {
    document.querySelectorAll(".drawer, .drawer-backdrop").forEach((el) => el.remove());
    document.body.classList.remove("drawer-open");
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

    const d = (await detail(record)) || record;
    const beds = d.beds || {};
    const mix = [1, 2, 3, 4, 5, 6]
      .filter((n) => (beds[n] || 0) > 0)
      .map((n) => `<div class="cell"><b>${beds[n]}</b><span>${n} BR</span></div>`)
      .join("") || '<div class="cell"><b>-</b><span>not stated</span></div>';

    const cls = horizonClass(d.exit_year);
    const exitLabel = horizonLabel(d.exit_year);

    panel.innerHTML = `
      <header>
        <button class="close" aria-label="Close">&times;</button>
        <h2>${titleCase(d.name)}</h2>
        <div class="where">${titleCase(d.address || "")}${d.address ? ", " : ""}${titleCase(d.city)}, ${esc(d.state)} ${esc(d.zip) || ""}</div>
      </header>

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
        <h3>Affordability</h3>
        <dl class="kv">
          <dt>LIHTC financed</dt><dd>${d.lihtc === null ? "-" : d.lihtc ? "Yes" : "No"}</dd>
          <dt>Tax credit expires</dt><dd>${esc(d.lihtc_expires) || "-"}</dd>
          <dt>Restrictive clause expires</dt><dd>${esc(d.restrictive_clause_expires) || "-"}</dd>
          <dt>MPR revitalized</dt><dd>${d.revitalized ? "Yes" : "No"}</dd>
        </dl>
      </section>

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

    panel.querySelector(".close").addEventListener("click", closeDrawer);
  }

  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

  return {
    PROGRAMS, RENTAL, STATE_NAMES,
    load, apply, summarize, readFilters, buildFilterBar,
    openDrawer, horizonClass, horizonLabel, titleCase, placeCase, num, pct, money,
    lock, unlock, signOut, sessionEmail,
    normManager, managers, managerParam,
    HAP_DB_URL, hapDeepLink,
    dataUrl, fetchData, download, esc, signInUrl, promptSignIn,
    get index() { return index; },
    get meta() { return meta; },
  };
})();

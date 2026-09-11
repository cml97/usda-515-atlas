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

  const num = (v) => (v === null || v === undefined || v === "" ? "" : Number(v).toLocaleString());
  const pct = (v) => (v === null || v === undefined ? "" : (v * 100).toFixed(0) + "%");
  const money = (v) => (v === null || v === undefined ? "" : "$" + Math.round(v).toLocaleString());
  const dash = (v) => (v === null || v === undefined || v === "" ? "&mdash;".replace("&mdash;", "-") : v);

  function titleCase(text) {
    if (!text) return "";
    return String(text).toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase())
      .replace(/\bLlc\b/g, "LLC").replace(/\bLp\b/g, "LP").replace(/\bInc\b/g, "Inc")
      .replace(/\bLtd\b/g, "Ltd").replace(/\bIi\b/g, "II").replace(/\bIii\b/g, "III")
      .replace(/\bApts?\b/g, (m) => (m.length === 3 ? "Apt" : "Apts"));
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
    return titleCase(parts.slice(0, -1).join(",")) + ", " + parts[parts.length - 1].trim().toUpperCase();
  }

  async function load() {
    const [idx, m, c] = await Promise.all([
      fetch("data/index.json").then((r) => r.json()),
      fetch("data/meta.json").then((r) => r.json()),
      // County names live in their own small file so the build can add them
      // without reissuing the whole index. Absent is survivable.
      fetch("data/counties.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ]);
    index = idx;
    meta = m;
    counties = c || {};
    index.forEach((r) => {
      if (!r.county && r.fips && counties[r.fips]) r.county = counties[r.fips];
    });
    return { index, meta };
  }

  async function detail(record) {
    const state = (record.state || "ZZ").toUpperCase();
    if (!shardCache.has(state)) {
      shardCache.set(state, fetch(`data/by-state/${state}.json`).then((r) => r.json()));
    }
    const shard = await shardCache.get(state);
    const found = shard[record.id] || null;
    if (found && !found.county && found.fips && counties[found.fips]) {
      found.county = counties[found.fips];
    }
    return found;
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
        <div class="where">${titleCase(d.address || "")}${d.address ? ", " : ""}${titleCase(d.city)}, ${d.state} ${d.zip || ""}</div>
      </header>

      <section>
        <h3>Program exit</h3>
        <dl class="kv">
          <dt>Estimated exit year</dt><dd><span class="pill ${cls}">${exitLabel}</span></dd>
          <dt>Estimated exit date</dt><dd>${d.exit_date || "-"}</dd>
          <dt>Loan payoff year</dt><dd>${d.loan_payoff_year || "-"}</dd>
          <dt>Prepay eligible year</dt><dd>${d.prepay_eligible_year || "-"}</dd>
          <dt>Prepay eligible now</dt><dd>${d.prepay_eligible_now === null ? "-" : d.prepay_eligible_now ? "Yes" : "No"}</dd>
          <dt>Natural maturity</dt><dd>${d.natural_maturity || "-"}</dd>
          <dt>UPB maturity</dt><dd>${d.upb_maturity || "-"}</dd>
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
        <h3>Affordability</h3>
        <dl class="kv">
          <dt>LIHTC financed</dt><dd>${d.lihtc === null ? "-" : d.lihtc ? "Yes" : "No"}</dd>
          <dt>Tax credit expires</dt><dd>${d.lihtc_expires || "-"}</dd>
          <dt>Restrictive clause expires</dt><dd>${d.restrictive_clause_expires || "-"}</dd>
          <dt>MPR revitalized</dt><dd>${d.revitalized ? "Yes" : "No"}</dd>
        </dl>
      </section>

      <section>
        <h3>Ownership and loan</h3>
        <dl class="kv">
          <dt>Borrower</dt><dd>${titleCase(d.borrower_name) || "-"}</dd>
          <dt>Borrower type</dt><dd>${d.borrower_type || "-"}</dd>
          <dt>Borrower location</dt><dd>${placeCase(d.borrower_city_state) || "-"}</dd>
          <dt>Management agent</dt><dd>${titleCase(d.management) || "-"}</dd>
          <dt>Profit type</dt><dd>${d.profit_type || "-"}</dd>
          <dt>Loan amount (source)</dt><dd>${money(d.loan_amt) || "-"}</dd>
          <dt>Rate at closing</dt><dd>${d.interest_rate !== null && d.interest_rate !== undefined ? d.interest_rate + "%" : "-"}</dd>
          <dt>Original loan term</dt><dd>${d.orig_loan_term ? Number(d.orig_loan_term).toFixed(2).replace(/\.00$/, "") + " yrs" : "-"}</dd>
          <dt>FY of obligation</dt><dd>${d.fy_loan_obligation || "-"}</dd>
          <dt>Remaining term</dt><dd>${d.remaining_term_days ? Math.round(d.remaining_term_days).toLocaleString() + " days" : "-"}</dd>
          <dt>Date of operation</dt><dd>${d.date_of_operation || "-"}</dd>
        </dl>
      </section>

      <section>
        <h3>Identifiers</h3>
        <dl class="kv">
          <dt>Program</dt><dd>${d.program || "-"}</dd>
          <dt>Tenant type</dt><dd>${d.rental_type || "-"}</dd>
          <dt>Borrower / project / check</dt><dd>${d.borrower_id || "?"} / ${d.project_id || "?"} / ${d.check_digit || "?"}</dd>
          <dt>MFIS project key</dt><dd>${d.id}</dd>
          <dt>County FIPS</dt><dd>${d.fips || "-"}${d.county ? " (" + d.county + ")" : ""}</dd>
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
    get index() { return index; },
    get meta() { return meta; },
  };
})();

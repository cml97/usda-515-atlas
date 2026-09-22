/* Property selection for the table page.
 *
 * A checkbox per row, a select-all that follows the active filter, a tray that
 * holds the running count, and an export shaped to the RD (Input) sheet of the
 * portfolio model.
 *
 * This file is deliberately standalone. It attaches to the table that table.js
 * paints rather than changing how that table is painted, so the two can be
 * edited without stepping on each other. The only contract between them is the
 * markup table.js writes: rows carry data-i, headers carry data-key, and the
 * sorted column shows an arrow.
 *
 * COLUMN MAP, REWRITTEN 21 SEPTEMBER 2026
 * ---------------------------------------
 * The first version of this file was written against the Beacon 515 June 2025
 * portfolio workbook. The blank model the user has since cleaned is not the
 * same sheet: Beacon carried a GP column that the blank does not, and Beacon
 * carried both "RA 521 Units" and "Total RA 521 Units" where the blank carries
 * one consolidated "Total RA 521 Units". Everything from Address onward is
 * shifted, and the middle of the sheet is reordered rather than merely offset.
 * Twenty-one of the twenty-two columns this file used to write were landing in
 * the wrong cell, and two of them were landing on formulas: 4 BR was being
 * written over AG Average BR/Unit, and Total RA 521 Units over AM/AL's
 * RA 521 Rent %. Both of those overwrite a live formula with a constant, which
 * is silent and permanent.
 *
 * The model of record is now the RD (Input) tab of the blank workbook: header
 * row 3, first data row 4. FORMULA_COLUMNS below lists the computed columns,
 * and a boot-time check refuses to let RD_COLUMNS target one of them.
 */

(() => {
  const KEY = "atlas.selection";

  /* Mirrors the constant in table.js. Only used as a sanity check on the page
     size actually rendered, never to compute a row's identity. */
  const PAGE_SIZE = 100;

  const UP = "▲";
  const DOWN = "▼";

  /* The model's first data row. build.py numbers the manifest from here. */
  const FIRST_DATA_ROW = 4;

  /* The blank workbook the handoff tells the next session to fill. The atlas
     has no way to know what the file is called, so this is a stated default.
     Change it here if the blank is renamed. */
  const MODEL_FILE = "Blank USDA 515 Model v4.xlsx";

  /* Served next to this script if someone copies tools/rd/HANDOFF-TEMPLATE.md
     into docs/assets/. When it is not there the embedded copy below is used,
     so the export never depends on a second file being present. */
  const TEMPLATE_URL = "assets/HANDOFF-TEMPLATE.md";

  /* The model calls EL "Senior" where the atlas calls it Elderly. The model's
     spelling wins in the export, because the export exists to be pasted into
     the model. Anything outside these three keeps the atlas label. */
  const PROPERTY_TYPE = { FA: "Family", EL: "Senior", MX: "Mixed" };

  /* Computed by the workbook. Writing a value into any of these replaces a
     formula with a constant, so nothing here may ever appear in RD_COLUMNS.
     Checked at boot, not just documented. */
  const FORMULA_COLUMNS = new Set([
    "AG", // Average BR/Unit
    "AL", // RA 521 Unit %
    "AM", // RA 521 Rent %
    "AN", // Other Income
    "AS", // Projected 2026 Mgmt Fee
    "AT", // NOI
    "AV", // NOI After Reserves
    "AY", // CF After Reserves and Debt
    "AZ", // Original Contribution
    "BB", // Total Profits
    "BR", // Total Debt
  ]);

  /* The source A columns of RD (Input): the half of the model the atlas can
     fill on its own. The letter is the destination cell in the blank model and
     the header is what that column's row 3 says, so a reader can check the two
     against each other without opening the workbook.
     `type` decides how a value is written twice over: as text in the CSV, and
     as a typed JSON value in the handoff manifest, because build.py writes the
     manifest's atlas block into cells and a unit count has to arrive as 31
     rather than "31".
     Everything else in the model is document work or user judgment and is
     deliberately absent here rather than present and empty. */
  const RD_COLUMNS = [
    { col: "C",  header: "Property",                       type: "text",  get: (d) => tc(d.name) },
    { col: "E",  header: "Address",                        type: "text",  get: (d) => tc(d.address) },
    { col: "F",  header: "City",                           type: "text",  get: (d) => tc(d.city) },
    { col: "G",  header: "State",                          type: "text",  get: (d) => str(d.state) },
    /* The county name, and only the name. Atlas.load backfills it from
       counties.json by FIPS, so a blank here means that file had no entry.
       The old file fell back to the raw FIPS code, which puts "28081" into a
       column headed County: a wrong value rather than a missing one. */
    { col: "H",  header: "County",                         type: "text",  get: (d) => str(d.county) },
    { col: "J",  header: "Property Type",                  type: "text",  get: (d) => PROPERTY_TYPE[d.rental_code] || Atlas.RENTAL[d.rental_code] || null },
    { col: "K",  header: "Units",                          type: "int",   get: (d) => d.units },
    /* USDA's date of operation, which is the closest thing the file has to a
       year built and is not the same as construction completion. */
    { col: "L",  header: "Year Built",                     type: "year",  get: (d) => yearOf(d.date_of_operation) },
    { col: "M",  header: "Previous Tax Credit",            type: "yesno", get: (d) => d.lihtc },
    { col: "N",  header: "FY of 515 Loan",                 type: "int",   get: (d) => d.fy_loan_obligation },
    { col: "O",  header: "Orig Loan Term",                 type: "num",   get: (d) => d.orig_loan_term },
    { col: "P",  header: "Year Restrictive Clause Expires", type: "year", get: (d) => yearOf(d.restrictive_clause_expires) },
    { col: "Q",  header: "Prepay Eligible Date",           type: "year",  get: (d) => yearOf(d.prepay_eligible_year) },
    { col: "R",  header: "Loan Payoff Year",               type: "year",  get: (d) => yearOf(d.loan_payoff_year) },
    /* W, X and Y arrive with geo_layers.py. Until that lands in the data build
       the fields are absent on every record and these three export blank,
       which is the same shape as a property the services could not answer for.
       They are listed now so the mapping does not have to be touched again. */
    { col: "W",  header: "QCT",                            type: "yesno", get: (d) => pick(d.qct) },
    { col: "X",  header: "DDA",                            type: "yesno", get: (d) => pick(d.dda) },
    { col: "Y",  header: "USDA RD Eligible Today",         type: "yesno", get: (d) => pick(d.rd_eligible) },
    { col: "Z",  header: "Manager",                        type: "text",  get: (d) => tc(d.management) },
    { col: "AB", header: "1 BR",                           type: "int",   get: (d) => bedCount(d, 1) },
    { col: "AC", header: "2 BR",                           type: "int",   get: (d) => bedCount(d, 2) },
    { col: "AD", header: "3 BR",                           type: "int",   get: (d) => bedCount(d, 3) },
    { col: "AE", header: "4 BR",                           type: "int",   get: (d) => bedCount(d, 4) },
    /* One RA column in the blank model where Beacon had two. The old file
       wrote ra_units twice, into AI and into AL, and AL is now a formula. */
    { col: "AI", header: "Total RA 521 Units",             type: "int",   get: (d) => d.ra_units },
    /* The loan's natural maturity, which is a date in the source. BD, the
       current USDA loan balance, is not here on purpose: the atlas carries
       loan_amt, the original amount, and writing that into a balance column
       would be a wrong number rather than a missing one. */
    { col: "BE", header: "Loan Maturity",                  type: "year",  get: (d) => yearOf(d.natural_maturity) },
  ];

  /* What the old file wrote, kept so the change is auditable from the page
     itself rather than only from a status document. Read as old -> new. */
  const REMAPPED = [
    ["C",  "C",  "Property",                        "unchanged"],
    ["F",  "E",  "Address",                         "shifted one left"],
    ["G",  "F",  "City",                            "shifted one left"],
    ["H",  "G",  "State",                           "shifted one left"],
    ["I",  "H",  "County",                          "shifted one left"],
    ["K",  "J",  "Property Type",                   "shifted one left"],
    ["L",  "K",  "Units",                           "shifted one left"],
    ["M",  "L",  "Year Built",                      "shifted one left"],
    ["N",  "M",  "Previous Tax Credit",             "shifted one left"],
    ["O",  "N",  "FY of 515 Loan",                  "shifted one left"],
    ["P",  "O",  "Orig Loan Term",                  "shifted one left"],
    ["Q",  "P",  "Year Restrictive Clause Expires", "shifted one left"],
    ["R",  "Q",  "Prepay Eligible Date",            "shifted one left"],
    ["S",  "R",  "Loan Payoff Year",                "shifted one left"],
    ["AB", "Z",  "Manager",                         "reordered, two left"],
    ["AD", "AB", "1 BR",                            "reordered, two left"],
    ["AE", "AC", "2 BR",                            "reordered, two left"],
    ["AF", "AD", "3 BR",                            "reordered, two left"],
    ["AG", "AE", "4 BR",                            "was overwriting the Average BR/Unit formula"],
    ["AI", "AI", "Total RA 521 Units",              "same letter, consolidated header"],
    ["AL", "--", "RA 521 Units (duplicate)",        "removed; AL is now the RA 521 Unit % formula"],
    ["BH", "BE", "Loan Maturity",                   "reordered, three left"],
    ["--", "W",  "QCT",                             "new, waits on geo_layers.py"],
    ["--", "X",  "DDA",                             "new, waits on geo_layers.py"],
    ["--", "Y",  "USDA RD Eligible Today",          "new, waits on geo_layers.py"],
  ];

  /* ------------------------------------------------------------ formatting */

  function str(v) {
    return v === null || v === undefined || v === "" ? null : String(v);
  }

  /** null and undefined both mean "the data build has not answered this". */
  function pick(v) {
    return v === null || v === undefined ? null : v;
  }

  /* Atlas.titleCase runs its result through esc(), because everything else in
     the atlas writes into innerHTML. A CSV cell is plain text, so the five
     entities esc() produces have to come back off, or a property called
     "J & A Apts" exports as "J &amp; A Apts". */
  const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

  function unesc(v) {
    return v === null || v === undefined ? "" : String(v).replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m]);
  }

  /** Title case as plain text. */
  function tc(v) {
    return v === null || v === undefined || v === "" ? null : unesc(Atlas.titleCase(v));
  }

  /** A four digit year out of whatever shape the source field takes. */
  function yearOf(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return v >= 1000 && v <= 9999 ? v : null;
    const text = String(v);
    const lead = /^(\d{4})\b/.exec(text);
    if (lead) return Number(lead[1]);
    const tail = /(\d{4})\s*$/.exec(text);
    return tail ? Number(tail[1]) : null;
  }

  function bedCount(d, n) {
    const beds = d.beds || {};
    const v = beds[n] !== undefined ? beds[n] : beds[String(n)];
    return v === null || v === undefined ? null : v;
  }

  /** The value as the CSV should print it. */
  function asText(raw, type) {
    if (raw === null || raw === undefined || raw === "") return "";
    if (type === "yesno") return raw ? "Yes" : "No";
    return String(raw);
  }

  /** The value as the manifest should carry it, or null to leave the key out. */
  function asJson(raw, type) {
    if (raw === null || raw === undefined || raw === "") return null;
    if (type === "yesno") return raw ? "Yes" : "No";
    if (type === "int" || type === "year") {
      const n = Number(raw);
      return Number.isFinite(n) ? Math.round(n) : String(raw);
    }
    if (type === "num") {
      const n = Number(raw);
      return Number.isFinite(n) ? n : String(raw);
    }
    return String(raw);
  }

  function csvCell(v) {
    const text = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  /** Pipe and newline are the two characters that break a markdown cell. */
  function mdCell(v) {
    const text = v === null || v === undefined ? "" : String(v);
    return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim() || "-";
  }

  /* ------------------------------------------------------------- selection */

  let ids = readStored();
  let byId = new Map();
  let pool = [];          // the active filtered set, in Atlas.index order
  let sorted = [];        // pool in the order the table is showing it
  let lastClickedRow = null;

  function readStored() {
    try {
      const raw = sessionStorage.getItem(KEY);
      const list = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(list) ? list.map(String) : []);
    } catch (e) {
      return new Set();
    }
  }

  function writeStored() {
    try { sessionStorage.setItem(KEY, JSON.stringify([...ids])); } catch (e) {}
  }

  function selectedRecords() {
    return [...ids].map((id) => byId.get(id)).filter(Boolean);
  }

  /* ------------------------------------------------- reading the table back */

  const $ = (id) => document.getElementById(id);

  /** Which column the table is sorted on, read off the arrow in the header. */
  function sortState() {
    const ths = document.querySelectorAll("#headrow th[data-key]");
    for (const th of ths) {
      const arrow = (th.querySelector(".arrow") || {}).textContent || "";
      if (arrow.indexOf(UP) !== -1) return { key: th.dataset.key, dir: 1 };
      if (arrow.indexOf(DOWN) !== -1) return { key: th.dataset.key, dir: -1 };
    }
    return { key: "exit_year", dir: 1 };
  }

  /** The same comparator table.js uses, so the same array comes out. */
  function sortRows(rows, sortKey, sortDir) {
    const blank = sortDir === 1 ? Infinity : -Infinity;
    return [...rows].sort((a, b) => {
      let x = a[sortKey], y = b[sortKey];
      if (sortKey === "prime") {
        const sa = Atlas.primeScore(a), sb = Atlas.primeScore(b);
        x = sa ? sa.score : null; y = sb ? sb.score : null;
      }
      if (typeof x === "string" || typeof y === "string") {
        x = (x || "").toString().toLowerCase();
        y = (y || "").toString().toLowerCase();
        return x < y ? -sortDir : x > y ? sortDir : 0;
      }
      x = x === null || x === undefined ? blank : Number(x);
      y = y === null || y === undefined ? blank : Number(y);
      return (x - y) * sortDir;
    });
  }

  /** Column positions in the painted header, by the data-key table.js sets. */
  function columnAt(key) {
    const head = $("headrow");
    if (!head) return -1;
    return [...head.children].findIndex((th) => th.dataset.key === key);
  }

  function cellText(tr, i) {
    const td = i >= 0 ? tr.children[i] : null;
    return td ? td.textContent.replace(/\s+/g, " ").trim() : "";
  }

  /* A row is matched to a record by position first, because position is exact
     whenever the replica of the sort agrees with the table. It is then checked
     against what the row actually says. The check is the point: a silent
     off-by-one here would put one property's units under another property's
     name in the export, which is the kind of error nobody catches by eye. */
  function recordFor(tr, cols) {
    const i = Number(tr.dataset.i);
    const guess = sorted[i];
    if (guess && rowMatches(tr, guess, cols)) return guess;

    const hits = pool.filter((r) => rowMatches(tr, r, cols));
    return hits.length === 1 ? hits[0] : null;
  }

  function rowMatches(tr, rec, cols) {
    if (!rec) return false;
    if (cols.name >= 0 && cellText(tr, cols.name) !== squash(Atlas.titleCase(rec.name))) return false;
    if (cols.state >= 0 && cellText(tr, cols.state) !== squash(rec.state)) return false;
    if (cols.units >= 0 && cellText(tr, cols.units) !== squash(Atlas.num(rec.units))) return false;
    if (cols.city >= 0 && cellText(tr, cols.city) !== squash(Atlas.titleCase(rec.city))) return false;
    return true;
  }

  function squash(v) {
    return unesc(v === null || v === undefined ? "" : String(v)).replace(/\s+/g, " ").trim();
  }

  /* ------------------------------------------------------------- decorating */

  let observer = null;

  function decorate() {
    const head = $("headrow");
    const body = $("rows");
    if (!head || !body || !head.children.length) return;

    pool = Atlas.apply(Atlas.readFilters(document));
    const { key, dir } = sortState();
    sorted = sortRows(pool, key, dir);

    if (!head.querySelector("th.selcell")) {
      const th = document.createElement("th");
      th.className = "selcell";
      th.innerHTML = '<input type="checkbox" id="sel-all" aria-label="Select every property matching the current filters">';
      head.insertBefore(th, head.firstChild);
      th.addEventListener("click", (e) => e.stopPropagation());
      th.querySelector("input").addEventListener("change", toggleAll);
    }

    const cols = {
      name: columnAt("name"),
      city: columnAt("city"),
      state: columnAt("state"),
      units: columnAt("units"),
    };

    [...body.querySelectorAll("tr")].forEach((tr) => {
      if (tr.querySelector("td.selcell")) return;

      const empty = tr.querySelector("td.loading");
      if (empty) {
        // Keep the "no matches" row spanning the full width now that there is
        // one more column than table.js counted.
        empty.colSpan = Number(empty.colSpan || 1) + 1;
        return;
      }
      if (tr.dataset.i === undefined) return;

      const td = document.createElement("td");
      td.className = "selcell";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "rowsel";
      td.appendChild(cb);

      /* The cell goes in before the row is read back, so the column positions
         taken from the header line up with the cells in the row. */
      tr.insertBefore(td, tr.firstChild);

      const rec = recordFor(tr, cols);
      if (rec) {
        cb.checked = ids.has(String(rec.id));
        cb.setAttribute("aria-label", "Select " + Atlas.titleCase(rec.name));
      } else {
        // Never seen in testing. If the table ever paints a row this file
        // cannot identify, the honest move is an inert checkbox rather than
        // one that selects the wrong property.
        cb.disabled = true;
        cb.title = "This row could not be matched to a property record";
      }

      /* The row click opens the property detail. The checkbox cell has to stop
         the click before it reaches the row, or selecting would navigate. */
      td.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!rec || cb.disabled) return;
        if (e.target !== cb) {
          cb.checked = !cb.checked;
          applyRowChange(rec, cb.checked, e.shiftKey, tr);
        }
      });

      cb.addEventListener("click", (e) => {
        if (!rec) return;
        applyRowChange(rec, cb.checked, e.shiftKey, tr);
      });
    });

    paintRowChecks();
    paintTray();
  }

  /** Shift click fills in the run between the last row clicked and this one. */
  function applyRowChange(rec, on, shift, tr) {
    const here = Number(tr.dataset.i);
    if (shift && lastClickedRow !== null && lastClickedRow !== here) {
      const from = Math.min(lastClickedRow, here);
      const to = Math.max(lastClickedRow, here);
      for (let i = from; i <= to; i += 1) {
        const r = sorted[i];
        if (!r) continue;
        if (on) ids.add(String(r.id)); else ids.delete(String(r.id));
      }
    } else if (on) {
      ids.add(String(rec.id));
    } else {
      ids.delete(String(rec.id));
    }
    lastClickedRow = here;
    writeStored();
    paintRowChecks();
    paintTray();
  }

  function toggleAll(e) {
    const on = e.target.checked;
    pool.forEach((r) => {
      if (on) ids.add(String(r.id)); else ids.delete(String(r.id));
    });
    lastClickedRow = null;
    writeStored();
    paintRowChecks();
    paintTray();
  }

  /** Repaint the boxes without rebuilding them, so scroll position is kept. */
  function paintRowChecks() {
    const body = $("rows");
    if (!body) return;
    const cols = {
      name: columnAt("name"),
      city: columnAt("city"),
      state: columnAt("state"),
      units: columnAt("units"),
    };
    [...body.querySelectorAll("tr[data-i]")].forEach((tr) => {
      const cb = tr.querySelector("input.rowsel");
      if (!cb || cb.disabled) return;
      const rec = recordFor(tr, cols);
      if (rec) cb.checked = ids.has(String(rec.id));
    });

    const all = $("sel-all");
    if (all) {
      const hit = pool.reduce((n, r) => n + (ids.has(String(r.id)) ? 1 : 0), 0);
      all.checked = pool.length > 0 && hit === pool.length;
      all.indeterminate = hit > 0 && hit < pool.length;
      all.title = pool.length
        ? `Select all ${pool.length.toLocaleString()} properties matching the current filters`
        : "No properties match the current filters";
    }
  }

  /* ------------------------------------------------------------------ tray */

  function buildTray() {
    if ($("seltray")) return;
    const tray = document.createElement("div");
    tray.className = "seltray";
    tray.id = "seltray";
    tray.hidden = true;
    tray.setAttribute("role", "region");
    tray.setAttribute("aria-label", "Selected properties");
    tray.innerHTML = `
      <div class="seltray-inner">
        <span class="seltray-figs">
          <span class="fig"><b id="sel-count">0</b> selected</span>
          <span class="fig"><b id="sel-units">0</b> total units</span>
        </span>
        <span class="seltray-note" id="sel-note"></span>
        <span class="seltray-acts">
          <input type="text" id="sel-name" class="btn" autocomplete="off"
                 aria-label="Portfolio name for the export">
          <button class="btn" id="sel-clear" type="button">Clear all</button>
          <button class="btn primary" id="sel-export" type="button">Export selected</button>
        </span>
      </div>`;
    document.body.appendChild(tray);

    if (window.ResizeObserver) new ResizeObserver(measureTray).observe(tray);
    window.addEventListener("resize", measureTray);

    $("sel-clear").addEventListener("click", () => {
      ids = new Set();
      lastClickedRow = null;
      writeStored();
      paintRowChecks();
      paintTray();
    });
    $("sel-export").addEventListener("click", exportSelected);
  }

  /* The handoff is addressed to a portfolio, and the atlas has no portfolio
     concept, so the name is derived and then left editable. One manager across
     the whole selection is the common case and gives the best default. */
  function defaultName(rows) {
    const when = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const mgrs = new Set(rows.map((r) => Atlas.normManager(r.management)).filter(Boolean));
    if (mgrs.size === 1) {
      const one = rows.find((r) => Atlas.normManager(r.management));
      return `${unesc(Atlas.titleCase(one.management))} 515 ${when} Portfolio`;
    }
    const states = new Set(rows.map((r) => r.state).filter(Boolean));
    if (states.size === 1) {
      const s = [...states][0];
      return `${Atlas.STATE_NAMES[s] || s} 515 ${when} Portfolio`;
    }
    return `USDA 515 ${when} Portfolio`;
  }

  function paintTray(note) {
    const tray = $("seltray");
    if (!tray) return;
    const rows = selectedRecords();
    const units = rows.reduce((n, r) => n + (r.units || 0), 0);

    $("sel-count").textContent = ids.size.toLocaleString();
    $("sel-units").textContent = units.toLocaleString();
    if (note !== undefined) $("sel-note").textContent = note;

    const name = $("sel-name");
    if (name) name.placeholder = rows.length ? defaultName(rows) : "Portfolio name";

    const show = ids.size > 0;
    tray.hidden = !show;
    document.body.classList.toggle("has-selection", show);
    measureTray();
  }

  /* The tray is fixed, and its height changes with the viewport and with
     whatever note it is carrying. Measuring it beats guessing a clearance in
     the stylesheet and getting it wrong on a phone. */
  function measureTray() {
    const tray = $("seltray");
    if (!tray) return;
    const h = tray.hidden ? 0 : Math.ceil(tray.getBoundingClientRect().height);
    document.body.style.setProperty("--seltray-h", h ? h + 16 + "px" : "0px");
  }

  /* ---------------------------------------------------------------- export */

  /* The slim index record carries enough to fill the table. The model wants
     the address, the bedroom mix, the loan dates and the date of operation,
     which live in the per state detail file, so the export pulls the full
     record for every selected property. Atlas.detail caches a state's file
     after the first hit, so a portfolio in four states costs four fetches. */
  async function fullRecords(rows) {
    const out = [];
    let thin = 0;
    for (const r of rows) {
      let d = null;
      try { d = await Atlas.detail(r); } catch (e) { d = null; }
      if (!d) thin += 1;
      out.push(Object.assign({}, r, d || {}));
    }
    return { out, thin };
  }

  /* Property name is the join key inside the workbook: the loan summary tabs
     find their property by matching the string in RD (Input) column C. Two
     properties exporting under the same name would make that match return the
     first one twice, quietly. Rather than let that happen, a repeated name
     carries its city. */
  function disambiguate(records) {
    const counts = new Map();
    records.forEach((d) => {
      const n = tc(d.name) || "";
      counts.set(n, (counts.get(n) || 0) + 1);
    });

    const taken = new Set();
    let fixed = 0;

    records.forEach((d) => {
      const base = tc(d.name) || "";
      if (counts.get(base) === 1) { d.name = base; taken.add(base); return; }

      /* Same name twice in one export. Qualify it by city, then by city and
         state, and only then by a number. Two phases of the same property in
         the same town are common enough that the number is a real outcome
         rather than a theoretical one. */
      const tries = [
        `${base} (${tc(d.city) || ""})`,
        `${base} (${tc(d.city) || ""}, ${str(d.state) || ""})`,
      ];
      let name = null;
      for (const t of tries) {
        const clean = t.replace(/\(\s*,?\s*\)/g, "").replace(/\s+/g, " ").trim();
        if (clean !== base && !taken.has(clean)) { name = clean; break; }
      }
      if (!name) {
        let n = 2;
        const stem = tries[1].replace(/\(\s*,?\s*\)/g, "").replace(/\s+/g, " ").trim();
        while (taken.has(`${stem} #${n}`)) n += 1;
        name = `${stem} #${n}`;
      }
      taken.add(name);
      d.name = name;
      fixed += 1;
    });

    return fixed;
  }

  /** Every atlas column for one property, as {raw, text, json}. */
  function cellsFor(d) {
    return RD_COLUMNS.map((c) => {
      let raw = null;
      try { raw = c.get(d); } catch (e) { raw = null; }
      return { col: c.col, header: c.header, text: asText(raw, c.type), json: asJson(raw, c.type) };
    });
  }

  function buildCsv(records) {
    /* The atlas fills a scattered two fifths of the sheet, so this is not a
       block that can be pasted at C4 in one go: the gaps between the columns
       are other people's work and several of them are formulas. The letter
       rides in the header so each column has an unambiguous destination, and
       the machine-readable path is the manifest in the handoff, which build.py
       writes cell by cell. */
    const lines = [RD_COLUMNS.map((c) => csvCell(`${c.col} ${c.header}`)).join(",")];
    records.forEach((d) => {
      lines.push(cellsFor(d).map((cell) => csvCell(cell.text)).join(","));
    });
    return lines.join("\n");
  }

  function buildManifest(records) {
    return records.map((d, i) => {
      const atlas = {};
      cellsFor(d).forEach((cell) => {
        if (cell.json !== null) atlas[cell.col] = cell.json;
      });
      return {
        row: FIRST_DATA_ROW + i,
        name: tc(d.name) || "",
        units: typeof d.units === "number" ? d.units : (Number(d.units) || null),
        /* Filled in by the session that picks up the handoff, as it saves each
           document out of Box. Present and null rather than absent, so the
           shape of the work left to do is visible in the file. */
        audit: null,
        budget: null,
        atlas,
      };
    });
  }

  function buildPropertyTable(records) {
    const head = [
      "| Row | Property | City | State | Units | Atlas ID | USDA borrower / project / check | Borrower name |",
      "| ---: | --- | --- | --- | ---: | --- | --- | --- |",
    ];
    const body = records.map((d, i) => {
      const usda = [d.borrower_id, d.project_id, d.check_digit]
        .map((v) => (v === null || v === undefined || v === "" ? "?" : String(v)))
        .join(" / ");
      return "| " + [
        FIRST_DATA_ROW + i,
        mdCell(tc(d.name)),
        mdCell(tc(d.city)),
        mdCell(d.state),
        d.units === null || d.units === undefined ? "-" : Number(d.units).toLocaleString(),
        mdCell(d.id),
        mdCell(usda),
        /* USDA's own spelling, not title cased. This column exists so the next
           session can paste it into search_files_keyword, and Box matches the
           string as it is filed rather than as it reads nicely. */
        mdCell(unesc(d.borrower_name)),
      ].join(" | ") + " |";
    });
    return head.concat(body).join("\n");
  }

  /* The template is fetched so it can be corrected without touching this file.
     When it is not served, the copy below is used. They are meant to be the
     same text; the fallback exists so the export is never blocked by a missing
     asset, and the note it adds says which one was used. */
  async function loadTemplate() {
    try {
      const res = await fetch(TEMPLATE_URL, { cache: "no-cache" });
      if (res.ok) {
        const text = await res.text();
        if (text && text.indexOf("{PROPERTY_TABLE}") !== -1) return { text, local: true };
      }
    } catch (e) { /* fall through to the built-in copy */ }
    return { text: FALLBACK_TEMPLATE, local: false };
  }

  function fillTemplate(text, fields) {
    return text.replace(/\{([A-Z_]+)\}/g, (m, key) =>
      Object.prototype.hasOwnProperty.call(fields, key) ? fields[key] : m);
  }

  /* Two files in one click. Some browsers drop a second programmatic download
     that arrives in the same tick as the first, so they are spaced out. */
  function saveBlob(text, filename, mime) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function slug(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "portfolio";
  }

  async function exportSelected() {
    const btn = $("sel-export");
    if (!btn || btn.disabled) return;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Preparing...";
    paintTray("");

    try {
      const rows = selectedRecords().sort((a, b) => {
        const s = String(a.state || "").localeCompare(String(b.state || ""));
        return s !== 0 ? s : String(a.name || "").localeCompare(String(b.name || ""));
      });
      if (!rows.length) return;

      const { out, thin } = await fullRecords(rows);
      const fixed = disambiguate(out);

      const nameEl = $("sel-name");
      const portfolio = ((nameEl && nameEl.value) || "").trim() || defaultName(out);
      const stamp = new Date().toISOString().slice(0, 10);
      const units = out.reduce((n, d) => n + (Number(d.units) || 0), 0);

      const csv = buildCsv(out);
      saveBlob(csv, `${slug(portfolio)}-rd-input-${stamp}.csv`, "text/csv");

      const { text: template, local } = await loadTemplate();
      const handoff = fillTemplate(template, {
        PORTFOLIO_NAME: portfolio,
        GENERATED_AT: new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC",
        PROPERTY_COUNT: out.length.toLocaleString(),
        UNIT_COUNT: units.toLocaleString(),
        MODEL_FILE: MODEL_FILE,
        MANIFEST: JSON.stringify(buildManifest(out), null, 2),
        PROPERTY_TABLE: buildPropertyTable(out),
      });

      await wait(400);
      saveBlob(handoff, `${slug(portfolio)}-HANDOFF-${stamp}.md`, "text/markdown");

      const notes = ["Two files: the atlas columns as CSV, and the handoff to paste into a new chat."];
      if (!local) notes.push("The handoff used this page's built-in template copy.");
      if (fixed) notes.push(`${fixed} repeated propert${fixed === 1 ? "y name was" : "y names were"} qualified with the city, so the workbook's lookups stay unique.`);
      if (thin) notes.push(`${thin} propert${thin === 1 ? "y" : "ies"} had no detail file, so the address and unit mix are blank there.`);
      paintTray(notes.join(" "));
    } catch (err) {
      paintTray("Export failed: " + (err && err.message ? err.message : String(err)));
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  /* ------------------------------------------------------------------ boot */

  /* A destination that is a formula column, or a letter used twice, is a bug
     that would be discovered as a broken workbook weeks later. Catching it in
     the console on page load is cheap. */
  function checkColumns() {
    const problems = [];
    const seen = new Set();
    RD_COLUMNS.forEach((c) => {
      if (FORMULA_COLUMNS.has(c.col)) problems.push(`${c.col} (${c.header}) is a formula column`);
      if (seen.has(c.col)) problems.push(`${c.col} is targeted twice`);
      seen.add(c.col);
    });
    if (problems.length && window.console) {
      console.error("select.js column map is wrong: " + problems.join("; "));
    }
    return problems;
  }

  function watch() {
    const head = $("headrow");
    const body = $("rows");
    if (!head || !body) return;

    observer = new MutationObserver(() => {
      // Decorating mutates the same nodes being watched, so the observer is
      // detached for the duration and its queue dropped on the way back in.
      observer.disconnect();
      try { decorate(); } finally {
        observer.takeRecords();
        observer.observe(head, { childList: true });
        observer.observe(body, { childList: true });
      }
    });
    observer.observe(head, { childList: true });
    observer.observe(body, { childList: true });
  }

  function start() {
    if (!document.getElementById("grid")) return;   // table page only
    checkColumns();
    buildTray();
    Atlas.load().then(() => {
      byId = new Map(Atlas.index.map((r) => [String(r.id), r]));
      // Anything held over from an earlier data build that no longer exists.
      [...ids].forEach((id) => { if (!byId.has(id)) ids.delete(id); });
      writeStored();
      watch();
      decorate();
      paintTray();
    }).catch(() => {});
  }

  /* ------------------------------------------- the built-in handoff template */

  const FALLBACK_TEMPLATE = [
    "# RD model build: {PORTFOLIO_NAME}",
    "",
    "Paste this whole file into a new Claude chat that has the Box connector.",
    "",
    "Generated {GENERATED_AT} from the USDA Section 515 Atlas.",
    "{PROPERTY_COUNT} properties, {UNIT_COUNT} units.",
    "",
    "---",
    "",
    "## What you are doing",
    "",
    "Filling the financial half of the RD portfolio model. The atlas has already",
    "filled everything it knows: location, unit count, loan dates, QCT/DDA,",
    "management fee cap. What it cannot know is what each property earns and spends.",
    "",
    "**Read SOURCING-RULE.md in the tools folder before you fill anything.** The",
    "short version, and it governs everything below:",
    "",
    "- Every cash flow, expense and reserve figure comes from the **Actual column of",
    "  the audit**, never from a Current Budget or Proposed Budget column.",
    "- Only two things come from the rent schedule: `AH Average In-Place Rent`, and",
    "  the Unit Mix tab's Effective and Pro Forma rent columns.",
    "",
    "Two documents, two jobs. The audit, and specifically the Form RD 3560-7 bound",
    "into the back of it, carries the actuals. The MFIS FIN1000 Proposed Budget",
    "carries the rent schedule. The manifest below has a slot for each.",
    "",
    "## Step 1. Get the tools",
    "",
    "They live in Box, in folder `419038852723` (\"rd-model-tools\", inside \"USDA 515",
    "Atlas - session handoff\", folder `418370845769`). Load the Box connector, list",
    "that folder, and write each file to a local `rd/` directory with",
    "`get_file_content`:",
    "",
    "    rd_budget.py  rd_audit.py  fill_model.py  unitmix.py  styles_rd.py",
    "    write_model.py  build.py  SOURCING-RULE.md  README.md",
    "",
    "Then `mkdir -p rd/budgets rd/audits`.",
    "",
    "## Step 2. Find the documents in Box",
    "",
    "For each property in the table below you want two things: the most recent",
    "**audit**, and the most recent **approved** MFIS Proposed Budget.",
    "",
    "Search `search_files_keyword` on the property name, then the borrower name,",
    "then the USDA borrower ID, all three of which are in the table. An approved",
    "budget prints `Fiscal Year: <year> Version: <date> APPROVED` on its cover page.",
    "",
    "Pull the text with `get_file_content` and save it to `audits/<atlas id>.txt`",
    "and `budgets/<atlas id>.txt`. Do not use `ai_extract_structured` or",
    "`ai_qa_single_file`. They are slower, they paraphrase, and on this account they",
    "have been returning Internal Server Error.",
    "",
    "Some firms bind the 3560-7 as a scanned image with nothing in the text layer.",
    "When `get_file_content` returns a page with no numbers on it, use",
    "`get_preview_page` and read the figures off the image instead.",
    "",
    "A property with no document keeps its `null` and still gets its atlas columns.",
    "",
    "## Step 3. Write the manifest",
    "",
    "Save this as `manifest.json` in the `rd` folder, filling in each `audit` and",
    "`budget` path as you save the file in step 2. The `atlas` block is already",
    "filled and its keys are the model's column letters; do not renumber `row`.",
    "",
    "```json",
    "{MANIFEST}",
    "```",
    "",
    "## Step 4. Build",
    "",
    "```bash",
    "python3 build.py --model \"{MODEL_FILE}\" --manifest manifest.json --out \"{PORTFOLIO_NAME} - RD Model.xlsx\" --report fill-report.md",
    "```",
    "",
    "Never open or save the model with openpyxl. It drops the chart, the printer",
    "settings, the comments and the drawing parts, which is why write_model.py",
    "exists. Send the user both files.",
    "",
    "## Step 5. Read the report before you send it",
    "",
    "**Tie-out.** The rent schedule prints its own totals, the rows imply an annual",
    "figure, and PART I line 1 states rental income. All three should agree to the",
    "dollar. When they do not, a row was misread. Say so rather than shipping it.",
    "",
    "**Row 74.** The portfolio total row recalculates when Excel opens the file.",
    "Check it looks right. LibreOffice will not recalculate it, so do not judge it",
    "from a conversion.",
    "",
    "## What no document fills",
    "",
    "| Column | Where it comes from |",
    "| --- | --- |",
    "| I Parcel Number | county assessor |",
    "| D RENTABLE SF on the Unit Mix tab | rent roll or appraisal |",
    "| AX Other Must-Pay Debt Payments | the audit's debt footnote |",
    "| BA Max. Annual 8% Distribution | the audit's Note B and its supplemental Return to Owner schedule, the Maximum column. PART I line 23 is what was budgeted, which is a different number |",
    "",
    "## Properties",
    "",
    "{PROPERTY_TABLE}",
    "",
  ].join("\n");

  // Exposed for the page's own tests. PAGE_SIZE is here so a change in
  // table.js that this file has not been told about is visible.
  window.AtlasSelect = {
    get ids() { return ids; },
    get pool() { return pool; },
    get sorted() { return sorted; },
    RD_COLUMNS,
    FORMULA_COLUMNS,
    REMAPPED,
    PAGE_SIZE,
    FIRST_DATA_ROW,
    yearOf,
    checkColumns,
    buildCsv,
    buildManifest,
    buildPropertyTable,
    fillTemplate,
  };

  /* Boot last, so every const above it is initialized before start() can run
     on a document that has already finished parsing. */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

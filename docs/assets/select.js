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
 */

(() => {
  const KEY = "atlas.selection";

  /* Mirrors the constant in table.js. Only used as a sanity check on the page
     size actually rendered, never to compute a row's identity. */
  const PAGE_SIZE = 100;

  const UP = "▲";
  const DOWN = "▼";

  /* The model calls EL "Senior" where the atlas calls it Elderly. The model's
     spelling wins in the export, because the export exists to be pasted into
     the model. Anything outside these three keeps the atlas label. */
  const PROPERTY_TYPE = { FA: "Family", EL: "Senior", MX: "Mixed" };

  /* The source A columns of RD (Input): the half of the model the atlas can
     fill on its own. Column letters are carried for readability and for the
     paste order; the header text is what the model's row 3 says, so the CSV
     lines up against it column for column. Everything else in the model is
     document work or user judgment and is deliberately absent here rather
     than present and empty. */
  const RD_COLUMNS = [
    { col: "C",  header: "Property",                        value: (d) => tc(d.name) },
    { col: "F",  header: "Address",                         value: (d) => tc(d.address) },
    { col: "G",  header: "City",                            value: (d) => tc(d.city) },
    { col: "H",  header: "State",                           value: (d) => plain(d.state) },
    { col: "I",  header: "County",                          value: (d) => plain(d.county || d.fips) },
    { col: "K",  header: "Property Type",                   value: (d) => PROPERTY_TYPE[d.rental_code] || Atlas.RENTAL[d.rental_code] || "" },
    { col: "L",  header: "Units",                           value: (d) => plain(d.units) },
    /* USDA's date of operation, which is the closest thing the file has to a
       year built and is not the same as construction completion. */
    { col: "M",  header: "Year Built",                      value: (d) => yearOf(d.date_of_operation) },
    { col: "N",  header: "Previous Tax Credit",             value: (d) => yesNo(d.lihtc) },
    { col: "O",  header: "FY of 515 Loan",                  value: (d) => plain(d.fy_loan_obligation) },
    { col: "P",  header: "Orig Loan Term",                  value: (d) => plain(d.orig_loan_term) },
    { col: "Q",  header: "Year Restrictive Clause Expires",  value: (d) => yearOf(d.restrictive_clause_expires) },
    { col: "R",  header: "Prepay Eligible Date",            value: (d) => plain(d.prepay_eligible_year) },
    { col: "S",  header: "Loan Payoff Year",                value: (d) => plain(d.loan_payoff_year) },
    { col: "AB", header: "Manager",                         value: (d) => tc(d.management) },
    { col: "AD", header: "1 BR",                            value: (d) => bedCount(d, 1) },
    { col: "AE", header: "2 BR",                            value: (d) => bedCount(d, 2) },
    { col: "AF", header: "3 BR",                            value: (d) => bedCount(d, 3) },
    { col: "AG", header: "4 BR",                            value: (d) => bedCount(d, 4) },
    { col: "AI", header: "RA 521 Units",                    value: (d) => plain(d.ra_units) },
    { col: "AL", header: "Total RA 521 Units",              value: (d) => plain(d.ra_units) },
    /* The loan's natural maturity, which is a date in the source. BG, the
       current USDA loan balance, is not here on purpose: the atlas carries
       loan_amt, the original amount, and writing that into a balance column
       would be a wrong number rather than a missing one. */
    { col: "BH", header: "Loan Maturity",                   value: (d) => yearOf(d.natural_maturity) },
  ];

  /* ------------------------------------------------------------ formatting */

  function plain(v) {
    return v === null || v === undefined || v === "" ? "" : String(v);
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
    return unesc(Atlas.titleCase(v || ""));
  }

  function yesNo(v) {
    return v === null || v === undefined || v === "" ? "" : v ? "Yes" : "No";
  }

  /** A four digit year out of whatever shape the source field takes. */
  function yearOf(v) {
    if (v === null || v === undefined || v === "") return "";
    if (typeof v === "number") return v >= 1000 && v <= 9999 ? String(v) : "";
    const text = String(v);
    const lead = /^(\d{4})\b/.exec(text);
    if (lead) return lead[1];
    const tail = /(\d{4})\s*$/.exec(text);
    return tail ? tail[1] : "";
  }

  function bedCount(d, n) {
    const beds = d.beds || {};
    const v = beds[n] !== undefined ? beds[n] : beds[String(n)];
    return v === null || v === undefined ? "" : String(v);
  }

  function csvCell(v) {
    const text = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
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

  function paintTray(note) {
    const tray = $("seltray");
    if (!tray) return;
    const rows = selectedRecords();
    const units = rows.reduce((n, r) => n + (r.units || 0), 0);

    $("sel-count").textContent = ids.size.toLocaleString();
    $("sel-units").textContent = units.toLocaleString();
    if (note !== undefined) $("sel-note").textContent = note;

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
      const n = tc(d.name);
      counts.set(n, (counts.get(n) || 0) + 1);
    });

    const taken = new Set();
    let fixed = 0;

    records.forEach((d) => {
      const base = tc(d.name);
      if (counts.get(base) === 1) { d.name = base; taken.add(base); return; }

      /* Same name twice in one export. Qualify it by city, then by city and
         state, and only then by a number. Two phases of the same property in
         the same town are common enough that the number is a real outcome
         rather than a theoretical one. */
      const tries = [
        `${base} (${tc(d.city)})`,
        `${base} (${tc(d.city)}, ${plain(d.state)})`,
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

      const lines = [RD_COLUMNS.map((c) => csvCell(c.header)).join(",")];
      out.forEach((d) => {
        lines.push(RD_COLUMNS.map((c) => {
          let v = "";
          try { v = c.value(d); } catch (e) { v = ""; }
          return csvCell(v);
        }).join(","));
      });

      const blob = new Blob([lines.join("\n")], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `rd-input-selected-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);

      const notes = [];
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  // Exposed for the page's own tests. PAGE_SIZE is here so a change in
  // table.js that this file has not been told about is visible.
  window.AtlasSelect = {
    get ids() { return ids; },
    get pool() { return pool; },
    get sorted() { return sorted; },
    RD_COLUMNS,
    PAGE_SIZE,
    yearOf,
  };
})();

/* One saved portfolio, on its own page.

   The page is deliberately self contained. The properties are the main view,
   a map of just those properties sits beside them, and clicking a row opens
   the same detail drawer the table uses rather than sending the reader back
   to the main table with a filter applied. Nothing here changes the stored
   selection, so opening a portfolio to read it cannot disturb whatever is
   checked on the Table tab.

   It opens two ways. ?name= reads a portfolio out of this browser's store.
   ?portfolio=&sel= is the share link, which carries the ids themselves, so a
   colleague who has never saved anything still lands on a working page. */

(() => {
  const $ = (id) => document.getElementById(id);
  const COLORS = Atlas.horizonColors();
  const PF_RETURN_KEY = "atlas.pfReturn";

  /* Every way into a property from here (the name link, the drawer's full
     page link) carries the portfolio along, so the property page can offer
     "Back to the portfolio" instead of dropping the reader on the main table. */
  const detailHref = (id) => `detail.html?id=${encodeURIComponent(id)}`
    + `&from=portfolio&pf=${encodeURIComponent(entry ? entry.name : "")}`;

  /* The page's own address, for the way back. A shared portfolio that was
     never saved has no name to look up, so the full share link is kept. */
  function rememberReturn() {
    try {
      sessionStorage.setItem(PF_RETURN_KEY,
        saved ? `portfolio.html?name=${encodeURIComponent(entry.name)}` : location.href);
    } catch (e) { /* storage off, the pf name still works for saved ones */ }
  }

  /* The drawer is drawn by the shared code, which knows nothing of
     portfolios, so its "Open the full page" link is pointed back here once
     it has rendered. */
  function openDrawer(record) {
    return Promise.resolve(Atlas.openDrawer(record)).then(() => {
      const a = document.querySelector(".drawer .drawer-more a");
      if (a) a.setAttribute("href", detailHref(record.id));
    });
  }

  let entry = null;      // {name, ids, savedAt} or a share-link stand-in
  let saved = false;     // is it in this browser's store
  let rows = [];
  let sortKey = "name";
  let sortDir = 1;
  let mapObj = null;

  const COLUMNS = [
    { key: "name", label: "Property", cls: "name",
      fmt: (r) => `<a href="${detailHref(r.id)}">${Atlas.titleCase(r.name)}</a>` },
    { key: "city", label: "City", fmt: (r) => Atlas.esc(Atlas.titleCase(r.city)) },
    { key: "state", label: "St", fmt: (r) => Atlas.esc(r.state) },
    { key: "units", label: "Units", cls: "num", fmt: (r) => Atlas.num(r.units) },
    { key: "ra_units", label: "RA units", cls: "num", fmt: (r) => Atlas.num(r.ra_units) },
    { key: "ra_share", label: "RA %", cls: "num", fmt: (r) => Atlas.pct(r.ra_share) },
    /* The same three formatters the main table uses, including the 202/811
       mark, so a reader moving between the two pages is not reading two
       different conventions for the same field. */
    { key: "s8", label: "Section 8",
      fmt: (r) => (!r.s8
        ? '<span class="no">No</span>'
        : r.s8_is_hap === false
          ? '<span class="yes">Yes<sup class="flagmark" title="Section 202/811 PRAC, not Section 8 - no mark-up-to-market">*</sup></span>'
          : '<span class="yes">Yes</span>') },
    { key: "lihtc", label: "LIHTC",
      fmt: (r) => (r.lihtc ? `<span class="pill lihtc">${r.lihtc_expiry_year || "yes"}</span>` : "") },
    { key: "exit_year", label: "Exit year", cls: "num",
      fmt: (r) => `<span class="pill ${Atlas.horizonClass(r.exit_year)}">${Atlas.horizonLabel(r.exit_year)}</span>` },
    { key: "rental_code", label: "Type", fmt: (r) => Atlas.RENTAL[r.rental_code] || "" },
    { key: "management", label: "Management", cls: "mgmt",
      fmt: (r) => Atlas.esc(Atlas.titleCase(r.management || "")) },
  ];

  /* ------------------------------------------------------------ the subject */

  function wanted() {
    const q = new URLSearchParams(location.search);
    const shared = Atlas.portfolioFromUrl();
    const name = q.get("name");
    if (name) {
      const hit = Atlas.listPortfolios().find(
        (p) => p.name.toLowerCase() === name.trim().toLowerCase());
      if (hit) { saved = true; return hit; }
      // A name with nothing behind it, usually a stale link or a deleted one.
      if (!shared) return null;
    }
    if (shared) {
      const hit = Atlas.listPortfolios().find(
        (p) => p.name.toLowerCase() === shared.name.toLowerCase());
      saved = Boolean(hit);
      return hit || { name: shared.name, ids: shared.ids, savedAt: null };
    }
    return null;
  }

  /* ----------------------------------------------------------------- figures */

  function stats() {
    const units = rows.reduce((a, r) => a + (Number(r.units) || 0), 0);
    const ra = rows.reduce((a, r) => a + (Number(r.ra_units) || 0), 0);
    const exiting = rows.filter(
      (r) => Number(r.years_to_exit) >= 0 && Number(r.years_to_exit) <= 10).length;
    return {
      properties: rows.length,
      units, ra,
      raShare: units ? ra / units : null,
      avgSize: rows.length ? Math.round(units / rows.length) : 0,
      exiting,
      missing: entry.ids.length - rows.length,
    };
  }

  function paintStats() {
    const s = stats();
    $("pf-stats").innerHTML = `
      <div class="stat"><div class="k">Properties</div><div class="v">${s.properties.toLocaleString()}</div></div>
      <div class="stat"><div class="k">Total units</div><div class="v">${s.units.toLocaleString()}</div></div>
      <div class="stat"><div class="k">Rental assistance units</div><div class="v">${s.ra.toLocaleString()}</div></div>
      <div class="stat"><div class="k">RA share of units</div><div class="v">${s.raShare === null ? "-" : Math.round(s.raShare * 100) + "%"}</div></div>
      <div class="stat"><div class="k">Average property size</div><div class="v">${s.avgSize.toLocaleString()}</div></div>
      <div class="stat alert"><div class="k">Exiting within 10 years</div><div class="v">${s.exiting.toLocaleString()}</div></div>`;
  }

  /* -------------------------------------------------------------- the header */

  function paintHead() {
    const when = entry.savedAt ? new Date(entry.savedAt) : null;
    const date = when && !isNaN(when)
      ? when.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      : "";
    $("pf-head").innerHTML = `
      <div class="pf-headmain">
        <h2 id="pf-title">${Atlas.esc(entry.name)}</h2>
        <p class="pf-headwhen">${saved
          ? (date ? `Saved ${Atlas.esc(date)} in this browser` : "Saved in this browser")
          : "Opened from a shared link. It is not saved in this browser yet."}</p>
      </div>
      <div class="pf-headacts">
        ${saved ? "" : '<button type="button" class="btn primary" id="pf-keep">Save to this browser</button>'}
        <button type="button" class="btn" id="pf-link">Copy link</button>
        <button type="button" class="btn" id="pf-full" title="Every field on every property page, as an Excel workbook">Download full info (Excel)</button>
        <button type="button" class="btn" id="pf-csv" title="Just the columns in the table below">Download table (CSV)</button>
        ${saved ? '<button type="button" class="btn" id="pf-rename">Rename</button>' : ""}
        <a class="btn" href="index.html" id="pf-table">Open in the main table</a>
        <a class="btn" href="map.html" id="pf-map-link">Open on the main map</a>
      </div>`;

    $("pf-link").addEventListener("click", copyLink);
    $("pf-csv").addEventListener("click", exportCsv);
    $("pf-full").addEventListener("click", exportFull);
    $("pf-rename")?.addEventListener("click", rename);
    $("pf-keep")?.addEventListener("click", keep);

    /* These two are the only things on the page that touch the stored
       selection, and they do it on the way out rather than on arrival. */
    const hop = (href) => (ev) => {
      ev.preventDefault();
      if (!Atlas.loadPortfolio(entry.name)) Atlas.adoptSelection(entry.ids);
      location.href = href;
    };
    $("pf-table").addEventListener("click", hop("index.html"));
    $("pf-map-link").addEventListener("click", hop("map.html"));
  }

  /* --------------------------------------------------------------- the table */

  function sorted() {
    const col = COLUMNS.find((c) => c.key === sortKey) || COLUMNS[0];
    return [...rows].sort((a, b) => {
      const x = a[col.key], y = b[col.key];
      const xn = x === null || x === undefined || x === "";
      const yn = y === null || y === undefined || y === "";
      if (xn && yn) return 0;
      if (xn) return 1;          // blanks sit at the bottom either way
      if (yn) return -1;
      if (typeof x === "number" && typeof y === "number") return (x - y) * sortDir;
      return String(x).localeCompare(String(y)) * sortDir;
    });
  }

  function paintTable() {
    $("pf-headrow").innerHTML = COLUMNS.map((c) => {
      const on = c.key === sortKey;
      const arrow = on ? `<span class="arrow">${sortDir === 1 ? "▲" : "▼"}</span>` : "";
      return `<th class="${c.cls || ""}" data-key="${c.key}">${c.label} ${arrow}</th>`;
    }).join("") + (saved ? '<th class="dropcell" title="Remove from this portfolio"></th>' : "");

    const list = sorted();
    $("pf-rows").innerHTML = list.length
      ? list.map((r, i) => `<tr data-i="${i}">`
          + COLUMNS.map((c) => `<td class="${c.cls || ""}">${c.fmt(r)}</td>`).join("")
          + (saved ? `<td class="dropcell"><button type="button" class="dropbtn" data-id="${Atlas.esc(String(r.id))}"
               aria-label="Remove ${Atlas.esc(Atlas.titleCase(r.name))} from this portfolio"
               title="Remove from this portfolio">&times;</button></td>` : "")
          + "</tr>").join("")
      : `<tr><td class="loading" colspan="${COLUMNS.length}">None of these properties are in the current USDA build.</td></tr>`;

    /* Built off COLUMNS rather than a hand-counted row of cells, so adding or
       dropping a column cannot silently shift the totals one column left. */
    const s = stats();
    const totals = {
      name: `${list.length} ${list.length === 1 ? "property" : "properties"}`,
      units: Atlas.num(s.units),
      ra_units: Atlas.num(s.ra),
      ra_share: s.raShare === null ? "" : Math.round(s.raShare * 100) + "%",
    };
    $("pf-totals").innerHTML = list.length
      ? COLUMNS.map((c) => `<td class="${c.cls || ""}">${totals[c.key] || ""}</td>`).join("")
        + (saved ? '<td class="dropcell"></td>' : "")
      : "";

    $("pf-headrow").querySelectorAll("th").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.key;
        if (key === sortKey) sortDir = -sortDir;
        else { sortKey = key; sortDir = 1; }
        paintTable();
      });
    });

    /* The drawer is what keeps this page self contained. A click on the
       property name still opens the full page, because that link stops the
       event from reaching the row. */
    $("pf-rows").querySelectorAll("tr[data-i]").forEach((tr) => {
      tr.addEventListener("click", (ev) => {
        if (ev.target.closest("a, button")) return;
        openDrawer(list[Number(tr.dataset.i)]);
      });
    });

    $("pf-rows").querySelectorAll(".dropbtn").forEach((b) => {
      b.addEventListener("click", () => drop(b.dataset.id));
    });

    const s2 = stats();
    $("pf-tablenote").textContent = s2.missing > 0
      ? `${s2.missing} saved ${s2.missing === 1 ? "property is" : "properties are"} no longer in the `
        + `current USDA build and cannot be shown. USDA drops a property from the file once it leaves the program.`
      : "Click any row for the full property detail. Click a column heading to sort.";
  }

  /* Removing a property offers an undo rather than a confirm. The action is
     one click and so is taking it back, which beats a dialog on every row. */
  function drop(id) {
    const out = Atlas.removeFromPortfolio(entry.name, [id]);
    if (!out) return;
    entry = out.entry;
    const gone = rows.find((r) => String(r.id) === String(id));
    rows = rows.filter((r) => String(r.id) !== String(id));
    repaint();
    $("pf-tablenote").innerHTML =
      `Removed ${Atlas.esc(gone ? Atlas.titleCase(gone.name) : "that property")}. `
      + `<button type="button" class="linkish" id="pf-undo">Undo</button>`;
    $("pf-undo").addEventListener("click", () => {
      const back = Atlas.addToPortfolio(entry.name, [id]);
      if (!back) return;
      entry = back.entry;
      if (gone) rows.push(gone);
      repaint();
    });
  }

  function repaint() {
    paintStats();
    paintTable();
    paintMap();
    paintBreakdown();
  }

  /* ----------------------------------------------------------------- the map */

  function paintMap() {
    const host = $("pf-map");
    const pins = rows.filter((r) => r.lat !== null && r.lat !== undefined
                                 && r.lon !== null && r.lon !== undefined);
    /* Leaflet refuses to attach twice to the same element, and clearing the
       HTML does not release it, so the old map is torn down properly first.
       This matters because removing a property repaints the map. */
    if (mapObj) { mapObj.remove(); mapObj = null; }

    if (!pins.length) {
      host.innerHTML = '<p class="loading">USDA publishes no coordinates for these properties.</p>';
      $("pf-mapnote").textContent = "";
      return;
    }

    host.innerHTML = "";
    const map = L.map(host, { scrollWheelZoom: false, zoomControl: true })
      .setView([pins[0].lat, pins[0].lon], 9);
    mapObj = map;
    // Esri's light gray canvas, the same base the property pages use, so the
    // properties read as the subject rather than competing with the streets.
    L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 16,
      attribution: 'Tiles &copy; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 16,
    }).addTo(map);

    pins.forEach((r) => {
      L.circleMarker([r.lat, r.lon], {
        radius: 7,
        weight: 1.5,
        color: "#ffffff",
        fillColor: COLORS[Atlas.horizonClass(r.exit_year)],
        fillOpacity: 0.9,
      })
        .bindTooltip(
          `<b>${Atlas.esc(Atlas.titleCase(r.name))}</b><br>`
          + `${Atlas.esc(Atlas.titleCase(r.city))}, ${Atlas.esc(r.state)}`
          + ` &middot; ${Atlas.num(r.units)} units`,
          { direction: "top", offset: [0, -6] })
        .on("click", () => openDrawer(r))
        .addTo(map);
    });

    if (pins.length > 1) {
      map.fitBounds(L.latLngBounds(pins.map((r) => [r.lat, r.lon])).pad(0.25), { maxZoom: 12 });
    }

    // The panel is sized by CSS after this runs, so Leaflet needs a nudge.
    requestAnimationFrame(() => map.invalidateSize({ animate: false }));
    window.addEventListener("resize", () => map.invalidateSize({ animate: false }));

    const off = rows.length - pins.length;
    $("pf-mapnote").innerHTML = `Color follows the exit horizon. Click a dot for the property.`
      + (off ? ` ${off} ${off === 1 ? "property has" : "properties have"} no coordinates and ${off === 1 ? "is" : "are"} not shown.` : "");
  }

  /* ----------------------------------------------------------- the breakdown */

  function tally(key, label) {
    const counts = new Map();
    rows.forEach((r) => {
      const k = label(r);
      if (!k) return;
      const cur = counts.get(k) || { n: 0, units: 0 };
      cur.n += 1;
      cur.units += Number(r.units) || 0;
      counts.set(k, cur);
    });
    return [...counts.entries()].sort((a, b) => b[1].units - a[1].units);
  }

  function paintBreakdown() {
    const blocks = [
      ["By state", tally("state", (r) => (r.state ? (Atlas.STATE_NAMES[r.state] || r.state) : ""))],
      ["By management", tally("management", (r) => Atlas.titleCase(r.management || ""))],
      ["By exit horizon", tally("exit", (r) => Atlas.horizonLabel(r.exit_year))],
    ];
    $("pf-breakdown").innerHTML = blocks.map(([title, list]) => {
      if (!list.length) return "";
      return `<h3 class="minimap-title">${title}</h3>
        <ul class="pf-tally">` + list.slice(0, 8).map(([k, v]) => `
          <li><span class="pf-tally-k">${Atlas.esc(k)}</span>
              <span class="pf-tally-v">${v.n} &middot; ${Atlas.num(v.units)} units</span></li>`).join("")
        + "</ul>";
    }).join("");
  }

  /* --------------------------------------------------------------- the acts */

  async function copyLink() {
    const url = Atlas.portfolioLink(entry);
    const btn = $("pf-link");
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = "Copied";
      setTimeout(() => { btn.textContent = "Copy link"; }, 1600);
    } catch (e) {
      // Clipboard access is blocked outside a secure context.
      window.prompt("Copy this link", url);
    }
  }

  function rename() {
    const next = window.prompt("Rename this portfolio", entry.name);
    if (next === null) return;
    const out = Atlas.renamePortfolio(entry.name, next);
    if (!out) {
      window.alert("That name is empty or already in use, so nothing was changed.");
      return;
    }
    entry = out;
    history.replaceState(null, "", `portfolio.html?name=${encodeURIComponent(out.name)}`);
    rememberReturn();
    paintHead();
    paintFoot();
  }

  function keep() {
    const out = Atlas.savePortfolio(entry.name, entry.ids);
    if (!out) {
      window.alert("Could not save. Browser storage is full or turned off.");
      return;
    }
    entry = out;
    saved = true;
    rememberReturn();
    paintHead();
    paintFoot();
  }

  function exportCsv() {
    const cols = ["id", "name", "city", "county", "state", "units", "ra_units", "ra_share", "s8",
                  "lihtc", "lihtc_expiry_year", "exit_year", "years_to_exit", "rental_code",
                  "management", "address", "zip"];
    const cell = (v) => {
      const text = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const lines = [cols.join(",")];
    sorted().forEach((r) => lines.push(
      cols.map((c) => cell(c === "county" && !r.county ? r.fips : r[c])).join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = entry.name.replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").toLowerCase()
      + "-" + new Date().toISOString().slice(0, 10) + ".csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  /* ------------------------------------------------------- full info export */

  /* The CSV above is the table and nothing more. This is everything the
     property pages show, for every property in the portfolio, pulled from the
     same per-state files the detail page reads. ExcelJS is loaded only when
     someone asks for a workbook, so the page itself stays light. It is used
     rather than SheetJS because the free SheetJS build cannot write styling. */
  const EXCELJS_SRC = [
    "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js",
    "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js",
  ];
  let excelLoading = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const tag = document.createElement("script");
      tag.src = src;
      tag.onload = resolve;
      tag.onerror = () => { tag.remove(); reject(new Error("could not load " + src)); };
      document.head.append(tag);
    });
  }

  function loadExcel() {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    if (!excelLoading) {
      excelLoading = (async () => {
        for (const src of EXCELJS_SRC) {
          try {
            await loadScript(src);
            if (window.ExcelJS) return window.ExcelJS;
          } catch (e) { /* try the next copy */ }
        }
        excelLoading = null;
        throw new Error("The spreadsheet library did not load. Check the connection and try again.");
      })();
    }
    return excelLoading;
  }

  const unescape = (html) => {
    const t = document.createElement("textarea");
    t.innerHTML = html || "";
    return t.value;
  };
  const tc = (v) => unescape(Atlas.titleCase(v || ""));
  const blank = (v) => v === null || v === undefined || v === "";
  const yn = (v) => (blank(v) ? "" : v ? "Yes" : "No");
  const numOr = (v) => (blank(v) || !Number.isFinite(Number(v)) ? (blank(v) ? "" : v) : Number(v));

  /* One list drives both sheets, so the flat table and the field-by-field
     sheet can never disagree. Each field is [label, getter, number format].
     Keys listed in `uses` are the record fields a field reads, so whatever is
     left over at the end can be appended rather than silently dropped. */
  function fieldGroups() {
    const ranks = Atlas.PRIME_FACTORS.map(({ key, label }) => [
      `Prime rank: ${label}`,
      (d, p) => (p && p.parts[key] !== null && p.parts[key] !== undefined ? Math.round(p.parts[key] * 100) : ""),
      "0",
    ]);
    const beds = [1, 2, 3, 4, 5, 6].map((n) => [
      `${n} BR units`,
      (d) => (d.beds ? (Number(d.beds[n]) || 0) : ""),
      "#,##0",
    ]);
    return [
      { title: "Property", uses: ["name", "address", "city", "county", "state", "zip", "program",
          "rental_type", "rental_code", "id", "borrower_id", "project_id", "check_digit", "fips", "lat", "lon"],
        fields: [
          ["Property", (d) => tc(d.name)],
          ["Address", (d) => tc(d.address)],
          ["City", (d) => tc(d.city)],
          ["County", (d) => d.county || ""],
          ["State", (d) => d.state || ""],
          ["ZIP", (d) => d.zip || ""],
          ["Program", (d) => d.program || ""],
          ["Tenant type", (d) => d.rental_type || Atlas.RENTAL[d.rental_code] || ""],
          ["MFIS project key", (d) => d.id || ""],
          ["Borrower ID", (d) => d.borrower_id || ""],
          ["Project ID", (d) => d.project_id || ""],
          ["Check digit", (d) => d.check_digit || ""],
          ["County FIPS", (d) => d.fips || ""],
          ["Latitude", (d) => numOr(d.lat), "0.00000"],
          ["Longitude", (d) => numOr(d.lon), "0.00000"],
        ] },
      { title: "Prime Score", uses: ["factors"],
        fields: [
          ["Prime Score", (d, p) => (p ? p.score : ""), "0.0"],
          ["Factors scored", (d, p) => (p ? `${p.used} of ${p.possible}` : "")],
          ...ranks,
        ] },
      { title: "Program exit", uses: ["exit_year", "years_to_exit", "exit_date", "loan_payoff_year",
          "prepay_eligible_year", "prepay_eligible_now", "natural_maturity", "upb_maturity", "balloon"],
        fields: [
          ["Estimated exit year", (d) => numOr(d.exit_year), "0"],
          ["Years to exit", (d) => numOr(d.years_to_exit), "0"],
          ["Estimated exit date", (d) => d.exit_date || ""],
          ["Loan payoff year", (d) => numOr(d.loan_payoff_year), "0"],
          ["Prepay eligible year", (d) => numOr(d.prepay_eligible_year), "0"],
          ["Prepay eligible now", (d) => yn(d.prepay_eligible_now)],
          ["Natural maturity", (d) => d.natural_maturity || ""],
          ["UPB maturity", (d) => d.upb_maturity || ""],
          ["Balloon payment", (d) => yn(d.balloon)],
        ] },
      { title: "Units", uses: ["units", "ra_units", "ra_share", "vacant_units", "occupied_units",
          "handicapped_units", "beds"],
        fields: [
          ["Total units", (d) => numOr(d.units), "#,##0"],
          ["Rental assistance units", (d) => numOr(d.ra_units), "#,##0"],
          ["RA share of units", (d) => numOr(d.ra_share), "0%"],
          ["Vacant units", (d) => numOr(d.vacant_units), "#,##0"],
          ["Occupied units", (d) => numOr(d.occupied_units), "#,##0"],
          ["Accessible units", (d) => numOr(d.handicapped_units), "#,##0"],
          ...beds,
        ] },
      { title: "Project-based Section 8", uses: ["s8", "s8_is_hap", "s8_doc_type", "s8_contract", "s8_units",
          "s8_expires", "s8_program_type", "s8_match", "s8_hud_property_id", "s8_hud_name", "s8_hud_city"],
        fields: [
          ["Project-based contract", (d) => yn(Boolean(d.s8))],
          ["Contract family", (d) => (!d.s8 ? "" : d.s8_is_hap === false
            ? `${d.s8_doc_type || "Other"} (not Section 8, no mark-up-to-market)` : "Section 8 HAP")],
          ["Contract number", (d) => (d.s8 ? d.s8_contract || "" : "")],
          ["Contract units", (d) => (d.s8 ? numOr(d.s8_units) : ""), "#,##0"],
          ["Contract expires", (d) => (d.s8 ? d.s8_expires || "" : "")],
          ["HUD program type", (d) => (d.s8 ? d.s8_program_type || "" : "")],
          ["HUD property ID", (d) => (d.s8 ? d.s8_hud_property_id || "" : "")],
          ["HUD property name", (d) => (d.s8 ? tc(d.s8_hud_name) : "")],
          ["PBS8 match evidence", (d) => (d.s8 ? (d.s8_match || {}).evidence || "" : "")],
          ["PBS8 match worth a check", (d) => (d.s8 && d.s8_match ? yn(Boolean(d.s8_match.review)) : "")],
          ["PBS8 Database link", (d) => (d.s8 ? Atlas.hapDeepLink(d) : "")],
        ] },
      { title: "Management fee ceiling", uses: ["mgmt_fee_max", "mgmt_fee_annual_max", "mgmt_fee_offroad",
          "mgmt_fee_source"],
        fields: [
          ["Max fee per occupied unit per month", (d) => numOr(d.mgmt_fee_max), "$#,##0.00"],
          ["Annual fee ceiling", (d) => numOr(d.mgmt_fee_annual_max), "$#,##0"],
          ["Off-road community fee", (d) => numOr(d.mgmt_fee_offroad), "$#,##0.00"],
          ["Fee source", (d) => (d.mgmt_fee_max ? d.mgmt_fee_source || "HB-2-3560 Attachment 3-F" : "")],
        ] },
      { title: "Affordability", uses: ["lihtc", "lihtc_expiry_year", "lihtc_expires",
          "restrictive_clause_expires", "revitalized"],
        fields: [
          ["LIHTC financed", (d) => yn(d.lihtc)],
          ["LIHTC expiry year", (d) => numOr(d.lihtc_expiry_year), "0"],
          ["Tax credit expires", (d) => d.lihtc_expires || ""],
          ["Restrictive clause expires", (d) => d.restrictive_clause_expires || ""],
          ["MPR revitalized", (d) => yn(Boolean(d.revitalized))],
        ] },
      { title: "Ownership and loan", uses: ["borrower_name", "borrower_type", "borrower_city_state",
          "management", "profit_type", "loan_amt", "interest_rate", "orig_loan_term",
          "fy_loan_obligation", "remaining_term_days", "date_of_operation"],
        fields: [
          ["Borrower", (d) => tc(d.borrower_name)],
          ["Borrower type", (d) => d.borrower_type || ""],
          ["Borrower location", (d) => unescape(Atlas.placeCase(d.borrower_city_state || ""))],
          ["Management agent", (d) => tc(d.management)],
          ["Profit type", (d) => d.profit_type || ""],
          ["Loan amount (source)", (d) => numOr(d.loan_amt), "$#,##0"],
          ["Rate at closing (%)", (d) => numOr(d.interest_rate), "0.00"],
          ["Original loan term (yrs)", (d) => numOr(d.orig_loan_term), "0.00"],
          ["FY of obligation", (d) => numOr(d.fy_loan_obligation), "0"],
          ["Remaining term (days)", (d) => (blank(d.remaining_term_days) ? "" : Math.round(d.remaining_term_days)), "#,##0"],
          ["Date of operation", (d) => d.date_of_operation || ""],
        ] },
      { title: "Links", uses: [],
        fields: [
          ["Atlas property page", (d) => new URL(`detail.html?id=${encodeURIComponent(d.id)}`, location.href).toString()],
          ["Google Maps", (d) => (d.lat && d.lon ? `https://www.google.com/maps?q=${d.lat},${d.lon}` : "")],
        ] },
    ];
  }

  /* Anything in the records that no field above reads, so a field the data
     build adds later still reaches the workbook. Nested objects are flattened
     one level, under their parent's name. */
  function extraFields(records, groups) {
    const used = new Set(groups.flatMap((g) => g.uses));
    const extra = new Map();
    records.forEach((d) => {
      Object.keys(d).forEach((k) => {
        const v = d[k];
        if (k === "factors") {
          Object.keys(v || {}).forEach((sub) => {
            if (Atlas.PRIME_FACTORS.some((f) => f.key === sub)) return;
            const lab = sub === "minority" ? "Minority share factor (prepay discount)" : `factors.${sub}`;
            extra.set(`factors.${sub}`, [lab, (r) => numOr((r.factors || {})[sub])]);
          });
          return;
        }
        if (used.has(k)) return;
        if (v && typeof v === "object" && !Array.isArray(v)) {
          Object.keys(v).forEach((sub) => {
            const key = `${k}.${sub}`;
            if (!extra.has(key)) {
              extra.set(key, [key, (r) => {
                const x = (r[k] || {})[sub];
                return x && typeof x === "object" ? JSON.stringify(x) : (typeof x === "boolean" ? yn(x) : numOr(x));
              }]);
            }
          });
        } else if (!extra.has(k)) {
          extra.set(k, [k, (r) => {
            const x = r[k];
            if (Array.isArray(x)) return x.join("; ");
            return typeof x === "boolean" ? yn(x) : numOr(x);
          }]);
        }
      });
    });
    return [...extra.values()];
  }

  /* ------------------------------------------------------ workbook styling */

  /* Greysteel's Penrose palette, so the export reads as a house document. */
  const PEN = {
    navy: "FF081937", seafoam: "FF3B7F83", sorbet: "FFF29651",
    ink: "FF1E2433", muted: "FF66708A", band: "FFF4F7FA", rule: "FFDCE2EA",
    paleSea: "FFE8F1F1", white: "FFFFFFFF",
  };
  const FONT = "Proxima Nova";
  const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
  const font = (o = {}) => ({ name: FONT, size: 10, color: { argb: PEN.ink }, ...o });
  const hair = (argb = PEN.rule) => ({ style: "thin", color: { argb } });

  /* The site's exit horizon colors, as ARGB, so an exit year in the workbook
     carries the same color it does on the page. */
  function horizonArgb() {
    const css = Atlas.horizonColors();
    const out = {};
    Object.keys(css).forEach((k) => {
      const hex = String(css[k] || "").replace("#", "").trim();
      out[k] = /^[0-9a-f]{6}$/i.test(hex) ? "FF" + hex.toUpperCase() : PEN.muted;
    });
    return out;
  }

  /* Navy band across the top of every sheet, with a seafoam subtitle under it. */
  function titleBand(ws, title, subtitle, width) {
    ws.mergeCells(1, 1, 1, width);
    const t = ws.getCell(1, 1);
    t.value = title;
    t.font = font({ size: 16, bold: true, color: { argb: PEN.white } });
    t.fill = fill(PEN.navy);
    t.alignment = { vertical: "middle", indent: 1 };
    ws.getRow(1).height = 34;
    for (let c = 2; c <= width; c++) ws.getCell(1, c).fill = fill(PEN.navy);

    ws.mergeCells(2, 1, 2, width);
    const s = ws.getCell(2, 1);
    s.value = subtitle;
    s.font = font({ size: 10, italic: true, color: { argb: PEN.seafoam } });
    s.alignment = { vertical: "middle", indent: 1 };
    ws.getRow(2).height = 20;
  }

  function headCell(cell, text, opts = {}) {
    cell.value = text;
    cell.font = font({ bold: true, color: { argb: PEN.white }, size: 9.5 });
    cell.fill = fill(opts.argb || PEN.navy);
    cell.alignment = { vertical: "middle", horizontal: opts.align || "left", wrapText: true,
      indent: opts.align === "center" ? 0 : 1 };
    cell.border = { bottom: hair(PEN.navy) };
  }

  /* One value into one cell: links become clickable, numbers keep their
     format and sit right, Yes and No center. */
  function putValue(cell, v, z, horizon) {
    if (v === null || v === undefined || v === "") { cell.value = null; return; }
    if (typeof v === "string" && /^https?:\/\//.test(v)) {
      cell.value = { text: "Open", hyperlink: v, tooltip: v };
      cell.font = font({ color: { argb: PEN.seafoam }, underline: true });
      cell.alignment = { horizontal: "center", vertical: "middle" };
      return;
    }
    cell.value = v;
    if (typeof v === "number") {
      if (z) cell.numFmt = z;
      cell.alignment = { horizontal: "right", vertical: "middle", indent: 1 };
    } else if (v === "Yes" || v === "No") {
      cell.alignment = { horizontal: "center", vertical: "middle" };
      if (v === "Yes") cell.font = font({ bold: true, color: { argb: PEN.seafoam } });
    } else {
      cell.alignment = { vertical: "middle", wrapText: false, indent: 1 };
    }
    if (horizon) cell.font = font({ bold: true, color: { argb: horizon } });
  }

  /* Fit to one page across when the sheet is narrow enough to stay
     readable, otherwise print at a fixed scale and run onto more pages. */
  function landscape(ws, repeatRows, fit = true) {
    ws.pageSetup = {
      orientation: "landscape", paperSize: 1,
      ...(fit ? { fitToPage: true, fitToWidth: 1, fitToHeight: 0 } : { fitToPage: false, scale: 70 }),
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
      printTitlesRow: repeatRows,
    };
    ws.headerFooter = { oddFooter: `&L&8${entry.name}&R&8Page &P of &N` };
  }

  /* -------------------------------------------------------- summary sheet */

  function summarySheet(wb, records) {
    const ws = wb.addWorksheet("Summary", {
      properties: { tabColor: { argb: PEN.navy } },
      views: [{ showGridLines: false }],
    });
    const s = stats();
    const w = Atlas.primeWeights();
    const meta = Atlas.meta || {};
    const us = (iso) => (iso && iso.length >= 10 ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : "");
    ws.columns = [{ width: 3 }, { width: 30 }, ...Array(5).fill(0).map(() => ({ width: 24 }))];
    titleBand(ws, entry.name, "USDA Section 515 Property Atlas  ·  Full property export", 7);

    // Who and when.
    const info = [
      ["Exported", new Date().toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })],
      ["Exported by", Atlas.sessionEmail() || ""],
      ["Property Characteristics as of", us(meta.property_report_date)],
      ["Program Exit Data as of", us(meta.exit_report_date)],
    ];
    let r = 4;
    info.forEach(([k, v]) => {
      ws.getCell(r, 2).value = k;
      ws.getCell(r, 2).font = font({ color: { argb: PEN.muted } });
      ws.mergeCells(r, 3, r, 4);
      ws.getCell(r, 3).value = v;
      ws.getCell(r, 3).font = font({ bold: true });
      r += 1;
    });

    // Six figure tiles, the same six the portfolio page shows.
    r += 1;
    const tiles = [
      ["Properties", s.properties, "#,##0"],
      ["Total units", s.units, "#,##0"],
      ["Rental assistance units", s.ra, "#,##0"],
      ["RA share of units", s.raShare === null ? "" : s.raShare, "0%"],
      ["Average property size", s.avgSize, "#,##0"],
      ["Exiting within 10 years", s.exiting, "#,##0"],
    ];
    tiles.forEach(([k, v, z], i) => {
      const c = 2 + i;
      const accent = i === 5 ? PEN.sorbet : PEN.seafoam;
      const lab = ws.getCell(r, c);
      lab.value = k.toUpperCase();
      lab.font = font({ size: 8, bold: true, color: { argb: PEN.muted } });
      lab.fill = fill(PEN.band);
      lab.border = { top: { style: "medium", color: { argb: accent } }, left: hair(), right: hair() };
      lab.alignment = { indent: 1, vertical: "bottom" };
      const val = ws.getCell(r + 1, c);
      val.value = v;
      val.numFmt = z;
      val.font = font({ size: 20, bold: true, color: { argb: PEN.navy } });
      val.fill = fill(PEN.band);
      val.border = { bottom: hair(), left: hair(), right: hair() };
      val.alignment = { indent: 1, horizontal: "left", vertical: "middle" };
    });
    ws.getRow(r).height = 22;
    ws.getRow(r + 1).height = 34;
    r += 3;
    if (s.missing > 0) {
      ws.mergeCells(r, 2, r, 7);
      ws.getCell(r, 2).value = `${s.missing} saved ${s.missing === 1 ? "property is" : "properties are"} no longer in the current USDA build and ${s.missing === 1 ? "is" : "are"} listed at the foot of this sheet.`;
      ws.getCell(r, 2).font = font({ italic: true, color: { argb: PEN.sorbet } });
      r += 2;
    }

    // A small table: section title, navy header, banded rows, a total.
    const table = (col, row0, title, head, rows, fmts, total) => {
      let rr = row0;
      const span = head.length;
      ws.mergeCells(rr, col, rr, col + span - 1);
      const t = ws.getCell(rr, col);
      t.value = title;
      t.font = font({ size: 11, bold: true, color: { argb: PEN.seafoam } });
      t.border = { bottom: { style: "medium", color: { argb: PEN.seafoam } } };
      for (let c = col + 1; c < col + span; c++) ws.getCell(rr, c).border = { bottom: { style: "medium", color: { argb: PEN.seafoam } } };
      rr += 1;
      head.forEach((h, i) => headCell(ws.getCell(rr, col + i), h, { align: i ? "right" : undefined }));
      rr += 1;
      rows.forEach((vals, n) => {
        vals.forEach((v, i) => {
          const cell = ws.getCell(rr, col + i);
          cell.value = v;
          cell.font = font();
          if (fmts[i]) cell.numFmt = fmts[i];
          cell.alignment = i ? { horizontal: "right", indent: 1 } : { indent: 1 };
          if (n % 2) cell.fill = fill(PEN.band);
          cell.border = { bottom: hair() };
        });
        rr += 1;
      });
      if (total) {
        total.forEach((v, i) => {
          const cell = ws.getCell(rr, col + i);
          cell.value = v;
          cell.font = font({ bold: true });
          if (fmts[i]) cell.numFmt = fmts[i];
          cell.alignment = i ? { horizontal: "right", indent: 1 } : { indent: 1 };
          cell.border = { top: { style: "thin", color: { argb: PEN.navy } } };
        });
        rr += 1;
      }
      return rr;
    };

    const tallyRows = (label) => tally(null, label).map(([k, v]) => [k, v.n, v.units]);
    const tot = ["Total", s.properties, s.units];
    const f3 = [null, "#,##0", "#,##0"];

    // Two columns of tables, so the sheet fits on a landscape page.
    let left = table(2, r, "By state", ["State", "Properties", "Units"],
      tallyRows((x) => (x.state ? (Atlas.STATE_NAMES[x.state] || x.state) : "")), f3, tot);
    let right = table(5, r, "By exit horizon", ["Exit year", "Properties", "Units"],
      tallyRows((x) => Atlas.horizonLabel(x.exit_year)), f3, tot);
    left = table(2, left + 1, "By management", ["Management agent", "Properties", "Units"],
      tallyRows((x) => tc(x.management) || "Not stated"), f3, tot);
    right = table(5, right + 1, "Prime Score weights used", ["Factor", "", "Weight"],
      Atlas.PRIME_FACTORS.map(({ key, label }) => [label, "", w[key]]), [null, null, "0"], null);
    let foot = Math.max(left, right) + 1;

    ws.mergeCells(foot, 2, foot, 7);
    const note = ws.getCell(foot, 2);
    note.value = "Prime Score ranks each property against USDA's whole portfolio, so it shifts a little "
      + "with every data refresh. The Properties sheet carries every field in one row per property. "
      + "Property Detail shows the same fields down the side, one column per property.";
    note.font = font({ size: 9, italic: true, color: { argb: PEN.muted } });
    note.alignment = { wrapText: true, vertical: "top" };
    ws.getRow(foot).height = 40;

    if (s.missing > 0) {
      const have = new Set(records.map((x) => String(x.id)));
      foot += 2;
      foot = table(2, foot, "Saved ids not in the current build", ["MFIS project key"],
        entry.ids.filter((id) => !have.has(String(id))).map((id) => [id]), [null], null);
    }
    landscape(ws, null);
    return ws;
  }

  /* ----------------------------------------------------- properties sheet */

  function propertiesSheet(wb, groups, full, primes, horizons) {
    const flat = groups.flatMap((g) => g.fields.map((f) => ({ group: g.title, label: f[0], get: f[1], z: f[2] })));
    const ws = wb.addWorksheet("Properties", {
      properties: { tabColor: { argb: PEN.seafoam } },
      views: [{ state: "frozen", xSplit: 1, ySplit: 4, showGridLines: false }],
    });
    titleBand(ws, `${entry.name}  ·  Properties`,
      `${full.length} ${full.length === 1 ? "property" : "properties"}, every field on the property page, one row each`,
      Math.min(flat.length, 12));

    // Row 3: the section each column belongs to, merged across its columns.
    let c = 1;
    groups.forEach((g, gi) => {
      const span = g.fields.length;
      if (span > 1) ws.mergeCells(3, c, 3, c + span - 1);
      const cell = ws.getCell(3, c);
      cell.value = g.title;
      const argb = gi % 2 ? PEN.seafoam : "FF2F6A6E";
      for (let k = c; k < c + span; k++) {
        ws.getCell(3, k).fill = fill(argb);
        ws.getCell(3, k).border = { left: k === c ? hair(PEN.white) : undefined };
      }
      cell.font = font({ size: 9, bold: true, color: { argb: PEN.white } });
      cell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
      c += span;
    });
    ws.getRow(3).height = 18;

    // Row 4: the column headings.
    flat.forEach((f, i) => headCell(ws.getCell(4, i + 1), f.label,
      { align: f.z ? "right" : undefined }));
    ws.getRow(4).height = 42;

    const exitCol = flat.findIndex((f) => f.label === "Estimated exit year");
    full.forEach((d, n) => {
      const row = ws.getRow(5 + n);
      flat.forEach((f, i) => {
        const cell = row.getCell(i + 1);
        cell.font = font(i === 0 ? { bold: true, color: { argb: PEN.navy } } : {});
        putValue(cell, f.get(d, primes[n]), f.z,
          i === exitCol ? horizons[Atlas.horizonClass(d.exit_year)] : null);
        if (n % 2) cell.fill = fill(PEN.band);
        cell.border = { bottom: hair() };
      });
      row.height = 18;
    });

    // Totals under the columns where a sum means something.
    const sumLabels = new Set(["Total units", "Rental assistance units", "Vacant units", "Occupied units",
      "Accessible units", "Contract units", "Annual fee ceiling", "Loan amount (source)",
      "1 BR units", "2 BR units", "3 BR units", "4 BR units", "5 BR units", "6 BR units"]);
    const tr = 5 + full.length;
    if (full.length) {
      flat.forEach((f, i) => {
        const cell = ws.getCell(tr, i + 1);
        cell.border = { top: { style: "thin", color: { argb: PEN.navy } } };
        cell.font = font({ bold: true });
        const col = ws.getColumn(i + 1).letter;
        if (i === 0) cell.value = `Total (${full.length})`;
        else if (sumLabels.has(f.label)) {
          cell.value = { formula: `SUM(${col}5:${col}${tr - 1})` };
          cell.numFmt = f.z || "#,##0";
          cell.alignment = { horizontal: "right" };
        } else if (f.label === "RA share of units") {
          const u = ws.getColumn(flat.findIndex((x) => x.label === "Total units") + 1).letter;
          const ra = ws.getColumn(flat.findIndex((x) => x.label === "Rental assistance units") + 1).letter;
          cell.value = { formula: `IFERROR(SUM(${ra}5:${ra}${tr - 1})/SUM(${u}5:${u}${tr - 1}),"")` };
          cell.numFmt = "0%";
          cell.alignment = { horizontal: "right" };
        }
      });
    }

    // Widths from the content, within reason.
    flat.forEach((f, i) => {
      let wch = Math.max(11, Math.min(16, f.label.length * 0.9));
      full.slice(0, 300).forEach((d, n) => {
        const v = f.get(d, primes[n]);
        const len = typeof v === "string" && /^https?:/.test(v) ? 6
          : String(v === null || v === undefined ? "" : v).length + (typeof v === "number" ? 4 : 0);
        wch = Math.max(wch, Math.min(i === 0 ? 34 : 40, len + 2));
      });
      ws.getColumn(i + 1).width = wch;
    });

    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + full.length, column: flat.length } };
    landscape(ws, "4:4", false);
    return ws;
  }

  /* ------------------------------------------------- property detail sheet */

  function detailSheet(wb, groups, full, primes, horizons) {
    const ws = wb.addWorksheet("Property Detail", {
      properties: { tabColor: { argb: PEN.sorbet } },
      views: [{ state: "frozen", xSplit: 1, ySplit: 3, showGridLines: false }],
    });
    const width = 1 + full.length;
    ws.getColumn(1).width = 36;
    for (let c = 2; c <= width; c++) ws.getColumn(c).width = 24;
    titleBand(ws, `${entry.name}  ·  Property Detail`,
      "The property page, one column per property", Math.max(2, Math.min(width, 8)));

    headCell(ws.getCell(3, 1), "Field");
    full.forEach((d, i) => {
      headCell(ws.getCell(3, 2 + i), tc(d.name), { align: "center" });
      ws.getCell(3, 2 + i).value = {
        text: tc(d.name),
        hyperlink: new URL(`detail.html?id=${encodeURIComponent(d.id)}`, location.href).toString(),
        tooltip: "Open the property page in the atlas",
      };
      ws.getCell(3, 2 + i).font = font({ bold: true, size: 9.5, color: { argb: PEN.white } });
    });
    ws.getRow(3).height = 40;

    let r = 4;
    groups.forEach((g) => {
      // Section band.
      for (let c = 1; c <= width; c++) {
        const cell = ws.getCell(r, c);
        cell.fill = fill(PEN.paleSea);
        cell.border = { top: { style: "thin", color: { argb: PEN.seafoam } } };
      }
      const sec = ws.getCell(r, 1);
      sec.value = g.title.toUpperCase();
      sec.font = font({ size: 9, bold: true, color: { argb: PEN.seafoam } });
      sec.alignment = { indent: 1, vertical: "middle" };
      ws.getRow(r).height = 20;
      r += 1;

      g.fields.forEach(([lab, get, z], n) => {
        const head = ws.getCell(r, 1);
        head.value = lab;
        head.font = font({ color: { argb: PEN.muted } });
        head.alignment = { indent: 2, vertical: "middle" };
        head.border = { bottom: hair() };
        if (n % 2) head.fill = fill(PEN.band);
        full.forEach((d, i) => {
          const cell = ws.getCell(r, 2 + i);
          cell.font = font();
          putValue(cell, get(d, primes[i]), z,
            lab === "Estimated exit year" ? horizons[Atlas.horizonClass(d.exit_year)] : null);
          if (typeof cell.value === "string" && cell.alignment && !cell.alignment.horizontal) {
            cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
          } else if (typeof cell.value === "number") {
            cell.alignment = { horizontal: "center", vertical: "middle" };
          }
          if (lab === "Prime Score" && typeof cell.value === "number") {
            cell.font = font({ size: 12, bold: true, color: { argb: PEN.navy } });
          }
          cell.border = { bottom: hair() };
          if (n % 2) cell.fill = fill(PEN.band);
        });
        r += 1;
      });
    });
    landscape(ws, "3:3", full.length <= 6);
    return ws;
  }

  async function exportFull() {
    const btn = $("pf-full");
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Preparing...";
    try {
      const ExcelJS = await loadExcel();
      /* One shard per state, cached by the shared loader, so a portfolio
         spread over a few states costs a few requests, not one per property. */
      const list = sorted();
      const full = await Promise.all(list.map(async (r) => {
        try { return { ...r, ...((await Atlas.detail(r)) || {}) }; }
        catch (e) { return { ...r }; }
      }));
      const weights = Atlas.primeWeights();
      const primes = full.map((d) => Atlas.primeScore(d, weights));

      const groups = fieldGroups();
      const extras = extraFields(full, groups);
      if (extras.length) groups.push({ title: "Other fields in the data", uses: [], fields: extras });
      const horizons = horizonArgb();

      const wb = new ExcelJS.Workbook();
      wb.creator = Atlas.sessionEmail() || "USDA Section 515 Property Atlas";
      wb.title = entry.name;
      wb.created = new Date();
      summarySheet(wb, full);
      propertiesSheet(wb, groups, full, primes, horizons);
      detailSheet(wb, groups, full, primes, horizons);

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = entry.name.replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").toLowerCase()
        + "-full-" + new Date().toISOString().slice(0, 10) + ".xlsx";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      btn.textContent = "Downloaded";
      setTimeout(() => { btn.textContent = label; }, 1800);
    } catch (err) {
      btn.textContent = label;
      window.alert(`Could not build the workbook. ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  }

  function paintFoot() {
    $("pf-foot").innerHTML = saved
      ? `This portfolio is stored in this browser, on this machine. <b>Copy link</b> sends it to a
         colleague or opens it on another device.`
      : `This portfolio came in on a link and is not stored here. <b>Save to this browser</b> keeps it.`;
  }

  function missingPage(msg) {
    $("pf-head").innerHTML = `<div class="pf-headmain"><h2>Portfolio not found</h2>
      <p class="pf-headwhen">${Atlas.esc(msg)}</p></div>
      <div class="pf-headacts"><a class="btn primary" href="portfolios.html">All portfolios</a></div>`;
    $("pf-rows").innerHTML = "";
    $("pf-stats").innerHTML = "";
    document.querySelector(".pf-detail")?.setAttribute("hidden", "");
  }

  entry = wanted();
  if (!entry) {
    missingPage("The link points at a portfolio that is not saved in this browser. "
      + "Portfolios do not sync between machines, so ask whoever made it for a share link.");
    return;
  }

  document.title = `${entry.name} - USDA Section 515 Property Atlas`;
  rememberReturn();
  paintHead();
  paintFoot();

  Atlas.load().then(() => {
    const byId = new Map(Atlas.index.map((r) => [String(r.id), r]));
    rows = entry.ids.map((id) => byId.get(String(id))).filter(Boolean);
    paintStats();
    paintTable();
    paintMap();
    paintBreakdown();
  }).catch((err) => {
    $("pf-rows").innerHTML =
      `<tr><td class="loading" colspan="${COLUMNS.length}">Could not load the property data. ${Atlas.esc(err.message)}</td></tr>`;
  });
})();

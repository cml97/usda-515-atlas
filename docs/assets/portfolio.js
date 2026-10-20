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

  let entry = null;      // {name, ids, savedAt} or a share-link stand-in
  let saved = false;     // is it in this browser's store
  let rows = [];
  let sortKey = "name";
  let sortDir = 1;
  let mapObj = null;

  const COLUMNS = [
    { key: "name", label: "Property", cls: "name",
      fmt: (r) => `<a href="detail.html?id=${encodeURIComponent(r.id)}">${Atlas.esc(Atlas.titleCase(r.name))}</a>` },
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
        <button type="button" class="btn" id="pf-csv">Download CSV</button>
        ${saved ? '<button type="button" class="btn" id="pf-rename">Rename</button>' : ""}
        <a class="btn" href="index.html" id="pf-table">Open in the main table</a>
        <a class="btn" href="map.html" id="pf-map-link">Open on the main map</a>
      </div>`;

    $("pf-link").addEventListener("click", copyLink);
    $("pf-csv").addEventListener("click", exportCsv);
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
        Atlas.openDrawer(list[Number(tr.dataset.i)]);
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
        .on("click", () => Atlas.openDrawer(r))
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

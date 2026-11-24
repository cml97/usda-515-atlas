/* Companies page: every management company in the portfolio, rolled up. */

(() => {
  const COLUMNS = [
    {
      key: "label", label: "Management company", cls: "name",
      fmt: (c) => `${Atlas.titleCase(c.label)}<a class="rowmap" data-key="${Atlas.esc(c.key)}"`
        + ` title="See this company's properties on the map" aria-label="Map view">`
        + `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"`
        + ` stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">`
        + `<path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0z"/>`
        + `<circle cx="12" cy="10" r="3"/></svg></a>`,
    },
    { key: "properties", label: "Properties", cls: "num" },
    { key: "units", label: "Units", cls: "num", fmt: (c) => Atlas.num(c.units) },
    { key: "ra", label: "RA units", cls: "num", fmt: (c) => Atlas.num(c.ra) },
    { key: "raShare", label: "RA %", cls: "num", fmt: (c) => Atlas.pct(c.raShare) },
    { key: "avgSize", label: "Avg size", cls: "num" },
    { key: "lihtc", label: "LIHTC", cls: "num" },
    { key: "exiting", label: "Exiting ≤10 yrs", cls: "num" },
    { key: "s8", label: "Section 8", cls: "num" },
    {
      key: "stateCount", label: "States",
      fmt: (c) => (c.stateList.length <= 4
        ? Atlas.esc(c.stateList.join(", "))
        : `${c.stateList.length} states`),
    },
  ];

  let sortKey = "units";
  let sortDir = -1;
  let all = [];
  let current = [];
  let stateField = null;
  let scopeField = null;

  const $ = (id) => document.getElementById(id);

  function sortRows(rows) {
    return [...rows].sort((a, b) => {
      let x = a[sortKey], y = b[sortKey];
      if (sortKey === "stateCount") { x = a.stateList.length; y = b.stateList.length; }
      if (typeof x === "string" || typeof y === "string") {
        x = (x || "").toLowerCase(); y = (y || "").toLowerCase();
        return x < y ? -sortDir : x > y ? sortDir : 0;
      }
      x = x === null || x === undefined ? -Infinity : x;
      y = y === null || y === undefined ? -Infinity : y;
      return (x - y) * sortDir;
    });
  }

  function renderHead() {
    $("headrow").innerHTML = COLUMNS.map((c) => {
      const arrow = sortKey === c.key ? (sortDir === 1 ? " &#9650;" : " &#9660;") : "";
      return `<th data-key="${c.key}" class="${c.cls === "num" ? "num" : ""}">${c.label}<span class="arrow">${arrow}</span></th>`;
    }).join("");

    $("headrow").querySelectorAll("th").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.key;
        if (sortKey === key) sortDir *= -1;
        else { sortKey = key; sortDir = key === "label" ? 1 : -1; }
        paint();
      });
    });
  }

  function paintStats() {
    const props = current.reduce((n, c) => n + c.properties, 0);
    const units = current.reduce((n, c) => n + c.units, 0);
    const solo = current.filter((c) => c.properties === 1).length;
    const big = [...current].sort((a, b) => b.units - a.units).slice(0, 10)
      .reduce((n, c) => n + c.units, 0);

    $("stats").innerHTML = `
      <div class="stat"><div class="k">Companies</div><div class="v">${current.length.toLocaleString()}</div></div>
      <div class="stat"><div class="k">Properties covered</div><div class="v">${props.toLocaleString()}</div></div>
      <div class="stat"><div class="k">Units covered</div><div class="v">${units.toLocaleString()}</div></div>
      <div class="stat"><div class="k">Single-property firms</div><div class="v">${solo.toLocaleString()}</div></div>
      <div class="stat alert"><div class="k">Top 10 share of units</div><div class="v">${units ? Math.round((big / units) * 100) : 0}%</div></div>
    `;
  }

  function paint() {
    current = sortRows(current);
    renderHead();

    $("rows").innerHTML = current.length
      ? current.slice(0, 400).map((c, i) => `<tr data-i="${i}">` + COLUMNS.map((col) => {
          const v = col.fmt ? col.fmt(c) : (c[col.key] === null || c[col.key] === undefined ? "" : c[col.key]);
          return `<td class="${col.cls || ""}">${v}</td>`;
        }).join("") + "</tr>").join("")
      : `<tr><td class="loading" colspan="${COLUMNS.length}">No companies match that search.</td></tr>`;

    function destination(key, page) {
      const picked = stateField ? stateField.values : [];
      const scoped = picked.length && scopeField.value !== "all";
      return `${page}?mgmt=${encodeURIComponent(key)}`
        + (scoped ? `&state=${encodeURIComponent(picked.join(","))}` : "");
    }

    $("rows").querySelectorAll("a.rowmap").forEach((a) => {
      a.addEventListener("click", (e) => {
        // Stop the row's own handler, which would send them to the table.
        e.preventDefault();
        e.stopPropagation();
        location.href = destination(a.dataset.key, "map.html");
      });
    });

    $("rows").querySelectorAll("tr[data-i]").forEach((tr) => {
      tr.addEventListener("click", () => {
        location.href = destination(current[Number(tr.dataset.i)].key, "index.html");
      });
    });

    const shown = Math.min(current.length, 400);
    $("count").textContent = current.length > 400
      ? `Showing the top ${shown} of ${current.length.toLocaleString()} companies by ${sortKey === "label" ? "name" : sortKey}`
      : `${current.length.toLocaleString()} companies`;
  }

  function refresh() {
    const q = ($("c-q").value || "").trim().toLowerCase();
    const min = parseInt($("c-min").value || "0", 10) || 0;
    const picked = stateField ? stateField.values : [];
    const nationwide = scopeField ? scopeField.value === "all" : false;

    // The counting basis only means something once a state is picked.
    $("c-scope-wrap").hidden = picked.length === 0;

    if (!picked.length) {
      all = Atlas.managers();
    } else {
      const want = new Set(picked);
      if (nationwide) {
        // Firms present in any chosen state, showing their whole footprint.
        const present = new Set(
          Atlas.index.filter((r) => want.has(r.state))
            .map((r) => Atlas.normManager(r.management)).filter(Boolean));
        all = Atlas.managers().filter((c) => present.has(c.key));
      } else {
        // Counted only on what they hold in the chosen states.
        all = Atlas.managers(Atlas.index.filter((r) => want.has(r.state)));
      }
    }

    current = all.filter((c) =>
      (!q || c.label.toLowerCase().includes(q) || c.key.toLowerCase().includes(q)) &&
      c.properties >= min);
    paintStats();
    paint();
    paintScopeNote(picked, nationwide);
    paintClear(picked, q, min);
  }

  function paintScopeNote(picked, nationwide) {
    const el = $("scopenote");
    if (!picked.length) { el.hidden = true; return; }
    const where = picked.length === 1 ? picked[0]
      : picked.slice(0, -1).join(", ") + " or " + picked[picked.length - 1];
    el.hidden = false;
    el.textContent = nationwide
      ? `Firms with at least one property in ${where}, counted across every state they operate in.`
      : `Firms with at least one property in ${where}, counted only on their ${picked.length === 1 ? picked[0] : "properties in those states"}.`;
  }

  function paintClear(picked, q, min) {
    const btn = $("c-reset");
    if (!btn) return;
    const n = (picked.length ? 1 : 0) + (q ? 1 : 0) + (min ? 1 : 0);
    btn.classList.toggle("armed", n > 0);
    btn.textContent = n > 0 ? `Clear all (${n})` : "Clear all";
  }

  Atlas.load().then(() => {
    const present = new Set(Atlas.index.map((r) => r.state).filter(Boolean));

    // The same chip control the table uses, so a state is entered the same way
    // on both pages and several can be held at once.
    stateField = Atlas.chipField(document.querySelector("#cw-state .chipbox"), {
      placeholder: "VA, Virginia",
      label: (code) => code,
      onChange: refresh,
      search: (term, chosen) => Atlas.stateMatches(term)
        .filter((c) => !chosen.includes(c) && present.has(c))
        .map((c) => ({ value: c, label: c, hint: Atlas.STATE_NAMES[c] })),
    });

    scopeField = Atlas.segField(document.querySelector("#cw-scope"), refresh);

    // Arrive with states already chosen when another page sends them over.
    const wanted = Atlas.statesFromUrl().filter((c) => present.has(c));
    if (wanted.length) stateField.set(wanted);

    refresh();

    $("c-q").addEventListener("input", refresh);
    $("c-min").addEventListener("input", refresh);
    $("c-reset").addEventListener("click", () => {
      $("c-q").value = ""; $("c-min").value = "";
      stateField.clear(); scopeField.clear();
      refresh();
    });

    $("sourcenote").innerHTML =
      `Management company as recorded by USDA, grouped after folding case, punctuation and ` +
      `the trailing corporate suffix. Firms that operate under more than one name in USDA's ` +
      `records will still appear separately. Click any row for that company's properties, or the ` +
      `pin beside a name to open them on the map.`;
  }).catch((err) => {
    $("rows").innerHTML = `<tr><td class="loading" colspan="9">Could not load the data. ${Atlas.esc(err.message)}</td></tr>`;
  });
})();

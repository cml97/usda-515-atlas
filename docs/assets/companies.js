/* Companies page: every management company in the portfolio, rolled up. */

(() => {
  const COLUMNS = [
    { key: "label", label: "Management company", cls: "name", fmt: (c) => Atlas.titleCase(c.label) },
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

    $("rows").querySelectorAll("tr[data-i]").forEach((tr) => {
      tr.addEventListener("click", () => {
        const c = current[Number(tr.dataset.i)];
        const st = $("c-state").value;
        const scoped = st && !$("c-scope").checked;
        location.href = `index.html?mgmt=${encodeURIComponent(c.key)}`
          + (scoped ? `&state=${encodeURIComponent(st)}` : "");
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
    const state = $("c-state").value;
    const nationwide = $("c-scope").checked;

    // The scope switch only means something once a state is picked.
    $("c-scope-wrap").hidden = !state;

    if (!state) {
      all = Atlas.managers();
    } else if (nationwide) {
      // Firms present in the state, but showing their whole footprint.
      const present = new Set(
        Atlas.index.filter((r) => r.state === state)
          .map((r) => Atlas.normManager(r.management)).filter(Boolean));
      all = Atlas.managers().filter((c) => present.has(c.key));
    } else {
      // Firms present in the state, counted only on what they hold there.
      all = Atlas.managers(Atlas.index.filter((r) => r.state === state));
    }

    current = all.filter((c) =>
      (!q || c.label.toLowerCase().includes(q) || c.key.toLowerCase().includes(q)) &&
      c.properties >= min);
    paintStats();
    paint();
    paintScopeNote(state, nationwide);
  }

  function paintScopeNote(state, nationwide) {
    const el = $("scopenote");
    if (!state) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = nationwide
      ? `Showing firms with at least one property in ${state}, counted across every state they operate in.`
      : `Showing firms with at least one property in ${state}, counted only on their ${state} properties.`;
  }

  Atlas.load().then(({ meta }) => {
    const states = (meta && meta.states && meta.states.length)
      ? meta.states
      : [...new Set(Atlas.index.map((r) => r.state).filter(Boolean))].sort();
    $("c-state").insertAdjacentHTML("beforeend",
      states.map((s) => `<option value="${Atlas.esc(s)}">${Atlas.esc(s)}</option>`).join(""));

    // Arrive with a state already chosen when the table page sends one over.
    const wanted = new URLSearchParams(location.search).get("state");
    if (wanted && states.includes(wanted.toUpperCase())) {
      $("c-state").value = wanted.toUpperCase();
    }

    refresh();

    $("c-q").addEventListener("input", refresh);
    $("c-min").addEventListener("input", refresh);
    $("c-state").addEventListener("change", refresh);
    $("c-scope").addEventListener("change", refresh);
    $("c-reset").addEventListener("click", () => {
      $("c-q").value = ""; $("c-min").value = "";
      $("c-state").value = ""; $("c-scope").checked = false;
      refresh();
    });

    $("sourcenote").innerHTML =
      `Management company as recorded by USDA, grouped after folding case, punctuation and ` +
      `the trailing corporate suffix. Firms that operate under more than one name in USDA's ` +
      `records will still appear separately. Click any row to see that company's properties.`;
  }).catch((err) => {
    $("rows").innerHTML = `<tr><td class="loading" colspan="9">Could not load the data. ${Atlas.esc(err.message)}</td></tr>`;
  });
})();

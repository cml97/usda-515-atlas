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
        location.href = `index.html?mgmt=${encodeURIComponent(c.key)}`;
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
    current = all.filter((c) =>
      (!q || c.label.toLowerCase().includes(q) || c.key.toLowerCase().includes(q)) &&
      c.properties >= min);
    paintStats();
    paint();
  }

  Atlas.load().then(({ meta }) => {
    all = Atlas.managers();
    refresh();

    $("c-q").addEventListener("input", refresh);
    $("c-min").addEventListener("input", refresh);
    $("c-reset").addEventListener("click", () => {
      $("c-q").value = ""; $("c-min").value = ""; refresh();
    });

    $("sourcenote").innerHTML =
      `Management company as recorded by USDA, grouped after folding case, punctuation and ` +
      `the trailing corporate suffix. Firms that operate under more than one name in USDA's ` +
      `records will still appear separately. Click any row to see that company's properties.`;
  }).catch((err) => {
    $("rows").innerHTML = `<tr><td class="loading" colspan="9">Could not load the data. ${Atlas.esc(err.message)}</td></tr>`;
  });
})();

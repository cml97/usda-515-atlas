/* Table page: sortable, paged grid over the filtered property set. */

(() => {
  const PAGE_SIZE = 100;

  const COLUMNS = [
    { key: "name", label: "Property", cls: "name", fmt: (r) => Atlas.titleCase(r.name) },
    { key: "city", label: "City", fmt: (r) => Atlas.titleCase(r.city) },
    { key: "county", label: "County", fmt: (r) => Atlas.esc(r.county || r.fips || "") },
    { key: "state", label: "St", fmt: (r) => Atlas.esc(r.state) },
    { key: "units", label: "Units", cls: "num", fmt: (r) => Atlas.num(r.units) },
    { key: "ra_units", label: "RA units", cls: "num", fmt: (r) => Atlas.num(r.ra_units) },
    { key: "ra_share", label: "RA %", cls: "num", fmt: (r) => Atlas.pct(r.ra_share) },
    {
      key: "exit_year", label: "Exit year", cls: "num",
      fmt: (r) => r.exit_year
        ? `<span class="pill ${Atlas.horizonClass(r.exit_year)}">${r.exit_year}</span>`
        : '<span class="pill none">n/a</span>',
    },
    { key: "years_to_exit", label: "Yrs out", cls: "num", fmt: (r) => (r.years_to_exit === null ? "" : r.years_to_exit < 0 ? "past" : r.years_to_exit) },
    {
      key: "lihtc", label: "LIHTC",
      fmt: (r) => (r.lihtc ? `<span class="pill lihtc">${r.lihtc_expiry_year || "yes"}</span>` : ""),
    },
    { key: "rental_code", label: "Type", fmt: (r) => Atlas.RENTAL[r.rental_code] || "" },
    { key: "management", label: "Management", fmt: (r) => Atlas.titleCase(r.management) },
  ];

  let sortKey = "exit_year";
  let sortDir = 1;
  let page = 0;
  let current = [];

  const $ = (id) => document.getElementById(id);

  function renderHead() {
    $("headrow").innerHTML = COLUMNS.map((c) => {
      const arrow = sortKey === c.key ? (sortDir === 1 ? " &#9650;" : " &#9660;") : "";
      return `<th data-key="${c.key}" class="${c.cls === "num" ? "num" : ""}">${c.label}<span class="arrow">${arrow}</span></th>`;
    }).join("");

    $("headrow").querySelectorAll("th").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.key;
        if (sortKey === key) sortDir *= -1;
        else { sortKey = key; sortDir = 1; }
        page = 0;
        sortAndPaint();
      });
    });
  }

  function sortRows(rows) {
    const blank = sortDir === 1 ? Infinity : -Infinity;
    return [...rows].sort((a, b) => {
      let x = a[sortKey], y = b[sortKey];
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

  function paintStats(rows) {
    const s = Atlas.summarize(rows);
    $("stats").innerHTML = `
      <div class="stat"><div class="k">Properties</div><div class="v">${s.properties.toLocaleString()}</div></div>
      <div class="stat"><div class="k">Total units</div><div class="v">${s.units.toLocaleString()}</div></div>
      <div class="stat"><div class="k">Rental assistance units</div><div class="v">${s.ra.toLocaleString()}</div></div>
      <div class="stat"><div class="k">RA share of units</div><div class="v">${s.raShare === null ? "-" : (s.raShare * 100).toFixed(0) + "%"}</div></div>
      <div class="stat"><div class="k">Average property size</div><div class="v">${s.avgSize}</div></div>
      <div class="stat alert"><div class="k">Exiting within 10 years</div><div class="v">${s.exiting.toLocaleString()}</div></div>
    `;
  }

  function paintRows() {
    const start = page * PAGE_SIZE;
    const slice = current.slice(start, start + PAGE_SIZE);

    $("rows").innerHTML = slice.length
      ? slice.map((r, i) => `<tr data-i="${start + i}">` + COLUMNS.map((c) => {
          const value = c.fmt ? c.fmt(r) : (r[c.key] === null || r[c.key] === undefined ? "" : r[c.key]);
          return `<td class="${c.cls || ""}">${value}</td>`;
        }).join("") + "</tr>").join("")
      : `<tr><td class="loading" colspan="${COLUMNS.length}">No properties match these filters.</td></tr>`;

    $("rows").querySelectorAll("tr[data-i]").forEach((tr) => {
      tr.addEventListener("click", () => Atlas.openDrawer(current[Number(tr.dataset.i)]));
    });

    const pages = Math.max(1, Math.ceil(current.length / PAGE_SIZE));
    $("count").textContent = `${current.length.toLocaleString()} of ${Atlas.index.length.toLocaleString()} properties`;
    $("pageinfo").textContent = `Page ${page + 1} of ${pages}`;
    $("prev").disabled = page === 0;
    $("next").disabled = page >= pages - 1;
  }

  function sortAndPaint() {
    current = sortRows(current);
    renderHead();
    paintRows();
  }

  function refresh() {
    current = Atlas.apply(Atlas.readFilters(document));
    paintStats(current);
    page = 0;
    sortAndPaint();
  }

  function exportCsv() {
    const cols = ["id", "name", "address_city", "county", "state", "units", "ra_units", "ra_share",
                  "exit_year", "years_to_exit", "lihtc", "lihtc_expiry_year", "rental_code", "management"];
    const esc = (v) => {
      const text = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const lines = [cols.join(",")];
    current.forEach((r) => lines.push([
      r.id, r.name, r.city, r.county || r.fips, r.state, r.units, r.ra_units, r.ra_share,
      r.exit_year, r.years_to_exit, r.lihtc, r.lihtc_expiry_year, r.rental_code, r.management,
    ].map(esc).join(",")));

    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `usda-515-filtered-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  Atlas.load().then(({ meta }) => {
    Atlas.buildFilterBar(document, refresh);
    refresh();

    $("prev").addEventListener("click", () => { if (page > 0) { page -= 1; paintRows(); window.scrollTo({ top: 0, behavior: "smooth" }); } });
    $("next").addEventListener("click", () => { page += 1; paintRows(); window.scrollTo({ top: 0, behavior: "smooth" }); });
    $("export").addEventListener("click", exportCsv);

    document.getElementById("sourcenote").innerHTML =
      `Property Characteristics as of ${meta.property_report_date}, Program Exit Data as of ${meta.exit_report_date}. ` +
      `${meta.joined_count.toLocaleString()} of ${meta.property_count.toLocaleString()} properties carry Program Exit Data. ` +
      `Built ${meta.built} from USDA Rural Development open data. ` +
      `<a href="#" id="full-csv">Download the full dataset</a>.`;

    document.getElementById("full-csv").addEventListener("click", (e) => {
      e.preventDefault();
      Atlas.download("properties.csv", "usda-515-full.csv").catch((err) => {
        document.getElementById("sourcenote").insertAdjacentHTML("beforeend",
          ` <span style="color:#c0392b">Download failed: ${Atlas.esc(err.message)}</span>`);
      });
    });
  }).catch((err) => {
    document.getElementById("rows").innerHTML =
      `<tr><td class="loading" colspan="12">Could not load the data files. ${err}</td></tr>`;
  });
})();

/* Table page: sortable, paged grid over the filtered property set. */

(() => {
  const PAGE_SIZE = 100;

  const COLUMNS = [
    {
      key: "prime", label: "Prime", cls: "num",
      fmt: (r) => { const s = Atlas.primeScore(r); return s ? s.score.toFixed(0) : "&ndash;"; },
    },
    { key: "name", label: "Property", cls: "name", fmt: (r) => Atlas.titleCase(r.name) },
    { key: "city", label: "City", fmt: (r) => Atlas.titleCase(r.city) },
    { key: "county", label: "County", fmt: (r) => Atlas.esc(r.county || r.fips || "") },
    { key: "state", label: "St", fmt: (r) => Atlas.esc(r.state) },
    { key: "units", label: "Units", cls: "num", fmt: (r) => Atlas.num(r.units) },
    { key: "ra_units", label: "RA units", cls: "num", fmt: (r) => Atlas.num(r.ra_units) },
    { key: "ra_share", label: "RA %", cls: "num", fmt: (r) => Atlas.pct(r.ra_share) },
    {
      key: "s8", label: "Section 8",
      /* A minority of these are Section 202/811 PRAC rather than Section 8.
         They stay a Yes, because they are project-based assistance all the
         same, but they are marked so a mark-up-to-market read is not made off
         a contract that has no MU2M path. */
      fmt: (r) => (!r.s8
        ? '<span class="no">No</span>'
        : r.s8_is_hap === false
          ? '<span class="yes">Yes<sup class="flagmark" title="Section 202/811 PRAC, not Section 8 - no mark-up-to-market">*</sup></span>'
          : '<span class="yes">Yes</span>'),
    },
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
        // A score column is most useful best-first on the first click.
        else { sortKey = key; sortDir = key === "prime" ? -1 : 1; }
        page = 0;
        sortAndPaint();
      });
    });
  }

  function sortRows(rows) {
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
      tr.addEventListener("click", () => Atlas.openDetail(current[Number(tr.dataset.i)]));
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

  /** Weight sliders. They rescore in place, so the ranking moves as you drag. */
  function buildWeights(onChange) {
    const host = document.getElementById("weights");
    if (!host) return;

    function paint() {
      const w = Atlas.primeWeights();
      host.innerHTML = Atlas.PRIME_FACTORS.map(({ key, label }) => `
        <div class="w">
          <label for="w-${key}">${label}<b id="wv-${key}">${w[key]}</b></label>
          <input type="range" id="w-${key}" data-key="${key}" min="0" max="6" step="0.5" value="${w[key]}">
        </div>`).join("");

      host.querySelectorAll('input[type="range"]').forEach((el) => {
        el.addEventListener("input", () => {
          const next = Atlas.primeWeights();
          next[el.dataset.key] = parseFloat(el.value);
          Atlas.setPrimeWeights(next);
          document.getElementById("wv-" + el.dataset.key).textContent = el.value;
          note();
          onChange();
        });
      });
      note();
    }

    function note() {
      const w = Atlas.primeWeights();
      const changed = Atlas.PRIME_FACTORS
        .filter(({ key }) => w[key] !== Atlas.PRIME_DEFAULTS[key]).length;
      const el = document.getElementById("w-note");
      if (el) {
        el.textContent = changed
          ? `${changed} weight${changed === 1 ? "" : "s"} changed from the original model.`
          : "Matching the original Excel model.";
      }
    }

    document.getElementById("w-reset")?.addEventListener("click", () => {
      Atlas.setPrimeWeights({ ...Atlas.PRIME_DEFAULTS });
      paint();
      onChange();
    });

    paint();
  }

  function refresh() {
    current = Atlas.apply(Atlas.readFilters(document));
    paintStats(current);
    Atlas.paintManagerBanner(document);
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
    Atlas.carryParamsIntoNav(document);
    buildWeights(sortAndPaint);
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

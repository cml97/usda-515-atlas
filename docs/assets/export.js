/* The formatted Excel export, shared by the portfolio page and the property
   page. Everything the property pages show, for every property asked for,
   pulled from the same per-state files the detail page reads, and laid out in
   the style of Greysteel's BOV books.

     AtlasExport.download({ name, records, ids, summary, button })

   records are index rows (each needs at least id and state). summary adds the
   portfolio summary sheet, which only means something for more than one
   property. ids, when given, lets the summary list saved ids that are no
   longer in the USDA build. */

window.AtlasExport = (() => {
  /* Set for the length of one export. The sheet builders read these rather
     than taking them as arguments, which keeps them as they were written on
     the portfolio page. */
  let entry = { name: "", ids: [] };
  let rows = [];

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
      missing: entry.ids.length ? entry.ids.length - rows.length : 0,
    };
  }

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

  /* Labels set the way the book sets them: title case, with initialisms
     (LIHTC, HUD, PBS8, BR) and short joining words left alone. */
  const SMALL = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "per", "the", "to", "vs"]);
  const UPPER = new Set(["ami", "dda", "fips", "fmr", "fy", "hap", "hud", "id", "lihtc", "mfi", "mfis",
    "mpr", "pbs8", "qct", "ra", "rd", "upb", "usda", "zip", "br", "hmfa", "ami"]);
  function bookCase(text) {
    return String(text || "").split(" ").map((word, i) => word.split("-").map((part) => {
      const m = part.match(/^([^A-Za-z0-9]*)([A-Za-z0-9]+)(.*)$/);
      if (!m) return part;
      const [, pre, core, post] = m;
      const low = core.toLowerCase();
      if (UPPER.has(low)) return pre + core.toUpperCase() + post;
      if (/[A-Z].*[A-Z]/.test(core) || /\d/.test(core)) return part;
      if (i > 0 && !pre && SMALL.has(low)) return pre + low + post;
      return pre + low.charAt(0).toUpperCase() + low.slice(1) + post;
    }).join("-")).join(" ");
  }
  /* A raw data key, such as hmfa_ami or factors.minority, as a readable label. */
  const prettyKey = (key) => bookCase(String(key).replace(/[._]+/g, " ").trim());

  /* One list drives both sheets, so the flat table and the field-by-field
     sheet can never disagree. Each field is [label, getter, number format].
     Keys listed in `uses` are the record fields a field reads, so whatever is
     left over at the end can be appended rather than silently dropped. */
  function fieldGroups() {
    const ranks = Atlas.PRIME_FACTORS.map(({ key, label }) => [
      label,
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
            ? `${d.s8_doc_type || "Other"} (Not Section 8)` : "Section 8 HAP")],
          ["Contract number", (d) => (d.s8 ? d.s8_contract || "" : "")],
          ["Contract units", (d) => (d.s8 ? numOr(d.s8_units) : ""), "#,##0"],
          ["Contract expires", (d) => (d.s8 ? d.s8_expires || "" : "")],
          ["HUD program type", (d) => (d.s8 ? d.s8_program_type || "" : "")],
          ["HUD property ID", (d) => (d.s8 ? d.s8_hud_property_id || "" : "")],
          ["HUD property name", (d) => (d.s8 ? tc(d.s8_hud_name) : "")],
          ["PBS8 match evidence", (d) => (d.s8 ? (d.s8_match || {}).evidence || "" : "")],
          ["PBS8 match flagged for review", (d) => (d.s8 && d.s8_match ? yn(Boolean(d.s8_match.review)) : "")],
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
      { title: "QCT, DDA and USDA rural", uses: ["tract", "zcta", "qct", "qct_next", "dda", "dda_next",
          "dda_basis", "dda_next_basis", "dda_area", "desig_year", "desig_next_year",
          "tract_poverty_rate", "tract_median_income", "rd_eligible", "rd_checked", "basis_rank"],
        fields: (() => {
          const y = Atlas.desigYears();
          return [
            ["Census tract", (d) => d.tract || ""],
            ["ZCTA", (d) => d.zcta || ""],
            [`QCT ${y.now || ""}`.trim(), (d) => yn(d.qct)],
            ...(y.next ? [[`QCT ${y.next}`, (d) => yn(d.qct_next)]] : []),
            [`DDA ${y.now || ""}`.trim(), (d) => yn(d.dda)],
            ...(y.next ? [[`DDA ${y.next}`, (d) => yn(d.dda_next)]] : []),
            ["DDA basis", (d) => [d.dda_basis, d.dda_area].filter(Boolean).join(", ")],
            ...(y.next ? [[`New QCT or DDA in ${y.next}`, (d) => { const k = Atlas.basisRank(d); return k === null ? "" : yn(k === 3); }]] : []),
            ["Tract poverty rate", (d) => numOr(d.tract_poverty_rate), "0.0%"],
            ["Tract median household income", (d) => numOr(d.tract_median_income), "$#,##0"],
            ["USDA rural eligible", (d) => yn(d.rd_eligible)],
            ["USDA eligibility checked", (d) => d.rd_checked || ""],
          ];
        })() },
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
            const lab = sub === "minority" ? "Minority share" : prettyKey(`factors.${sub}`);
            extra.set(`factors.${sub}`, [lab, (r) => numOr((r.factors || {})[sub]), sub === "minority" ? "0%" : undefined]);
          });
          return;
        }
        if (used.has(k)) return;
        if (v && typeof v === "object" && !Array.isArray(v)) {
          Object.keys(v).forEach((sub) => {
            const key = `${k}.${sub}`;
            if (!extra.has(key)) {
              extra.set(key, [prettyKey(key), (r) => {
                const x = (r[k] || {})[sub];
                return x && typeof x === "object" ? JSON.stringify(x) : (typeof x === "boolean" ? yn(x) : numOr(x));
              }]);
            }
          });
        } else if (!extra.has(k)) {
          extra.set(k, [prettyKey(k), (r) => {
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

  /* Styled after Greysteel's BOV books: a navy serif page title on white, a
     small gray running head, navy table title bars, slate column headings
     with a seafoam rule beneath, a light gray label column and thin gray
     rules between rows. Navy, slate and seafoam only. */
  const PEN = {
    navy: "FF081937", slate: "FF5A5C65", seafoam: "FF3B7F83",
    ink: "FF262626", gray: "FF7F7F7F", label: "FFF2F2F2", rule: "FFD9D9D9",
    white: "FFFFFFFF",
  };
  const FONT = "Proxima Nova";
  const TITLE_FONT = "Larken";
  const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
  const font = (o = {}) => ({ name: FONT, size: 10, color: { argb: PEN.ink }, ...o });
  const line = (argb = PEN.rule, style = "thin") => ({ style, color: { argb } });
  const RUNNING = () => `USDA SECTION 515 PROPERTY ATLAS : ${entry.name.toUpperCase()}`;

  /* Running head, page title and subtitle, the way each page of the book
     opens. Returns the first free row. */
  function pageHead(ws, title, subtitle, width) {
    ws.mergeCells(1, 1, 1, width);
    const run = ws.getCell(1, 1);
    run.value = RUNNING();
    run.font = font({ size: 8, color: { argb: PEN.gray } });
    run.alignment = { horizontal: "right", vertical: "middle" };
    ws.getRow(1).height = 18;

    ws.mergeCells(2, 1, 2, width);
    const t = ws.getCell(2, 1);
    t.value = title;
    t.font = { name: TITLE_FONT, size: 26, bold: true, color: { argb: PEN.navy } };
    t.alignment = { vertical: "bottom" };
    ws.getRow(2).height = 40;

    ws.mergeCells(3, 1, 3, width);
    const s = ws.getCell(3, 1);
    s.value = subtitle;
    s.font = font({ size: 12 });
    s.alignment = { vertical: "top" };
    ws.getRow(3).height = 22;
    ws.getRow(4).height = 10;
    return 5;
  }

  /* Navy bar with a centered white title, across a table's width. */
  function titleBar(ws, row, col, width, text) {
    if (width > 1) ws.mergeCells(row, col, row, col + width - 1);
    const cell = ws.getCell(row, col);
    cell.value = text;
    cell.font = font({ size: 11, color: { argb: PEN.white } });
    cell.alignment = { horizontal: "center", vertical: "middle" };
    for (let c = col; c < col + width; c++) ws.getCell(row, c).fill = fill(PEN.navy);
    ws.getRow(row).height = 20;
  }

  /* Slate column heading with the seafoam rule under it. */
  function headCell(cell, text, opts = {}) {
    cell.value = text;
    cell.font = font({ size: 10, color: { argb: PEN.white } });
    cell.fill = fill(PEN.slate);
    cell.alignment = { vertical: "middle", horizontal: opts.align || "center", wrapText: true,
      indent: opts.align === "left" ? 1 : 0 };
    cell.border = {
      bottom: line(PEN.seafoam, "medium"),
      left: line(PEN.white), right: line(PEN.white),
    };
  }

  /* A label cell in the gray first column. */
  function labelCell(cell, text, bold = false) {
    cell.value = text;
    cell.font = font({ bold });
    cell.fill = fill(PEN.label);
    cell.alignment = { vertical: "middle", indent: 1 };
    cell.border = { bottom: line(), right: line(PEN.rule) };
  }

  /* One value into one cell: links become clickable, numbers keep their
     format, everything sits centered the way the book's tables do. */
  function putValue(cell, v, z) {
    cell.border = { bottom: line() };
    if (v === null || v === undefined || v === "") { cell.value = null; return; }
    if (typeof v === "string" && /^https?:\/\//.test(v)) {
      cell.value = { text: "Open", hyperlink: v, tooltip: v };
      cell.font = font({ color: { argb: PEN.seafoam }, underline: true });
      cell.alignment = { horizontal: "center", vertical: "middle" };
      return;
    }
    cell.value = v;
    cell.font = font();
    if (typeof v === "number" && z) cell.numFmt = z;
    cell.alignment = { horizontal: "center", vertical: "middle" };
  }

  /* fit: "page" squeezes onto one page, true fits the width and runs
     down, false prints at a fixed scale across as many pages as it needs. */
  function printSetup(ws, repeatRows, fit = true) {
    ws.pageSetup = {
      orientation: "landscape", paperSize: 1,
      ...(fit === "page" ? { fitToPage: true, fitToWidth: 1, fitToHeight: 1 }
        : fit ? { fitToPage: true, fitToWidth: 1, fitToHeight: 0 } : { fitToPage: false, scale: 70 }),
      margins: { left: 0.45, right: 0.45, top: 0.55, bottom: 0.55, header: 0.3, footer: 0.3 },
      printTitlesRow: repeatRows,
      horizontalCentered: true,
    };
    ws.headerFooter = {
      oddFooter: `&L&"${FONT},Regular"&7&K7F7F7F© ${new Date().getFullYear()} GREYSTEEL  |  PROPRIETARY && CONFIDENTIAL INFORMATION`
        + `&R&"${FONT},Bold"&8&K081937&P`,
    };
  }

  /* -------------------------------------------------------- summary sheet */

  function summarySheet(wb, records) {
    const ws = wb.addWorksheet("Summary", {
      properties: { tabColor: { argb: PEN.navy } },
      views: [{ showGridLines: false }],
    });
    const s = stats();
    const meta = Atlas.meta || {};
    const us = (iso) => (iso && iso.length >= 10 ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : "");
    const today = new Date();
    const stamp = `${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}/${today.getFullYear()}`;

    // Two tables side by side, with a narrow gutter between.
    ws.columns = [
      { width: 30 }, { width: 14 }, { width: 14 }, { width: 4 },
      { width: 34 }, { width: 18 }, { width: 12 },
    ];
    let r = pageHead(ws, "Portfolio Summary", entry.name, 7);

    // Where the numbers come from, in one quiet line under the title.
    ws.mergeCells(4, 1, 4, 7);
    const src = ws.getCell(4, 1);
    const by = Atlas.sessionEmail();
    src.value = [
      `Exported ${stamp}${by ? ` by ${by}` : ""}`,
      meta.property_report_date ? `Property Characteristics as of ${us(meta.property_report_date)}` : "",
      meta.exit_report_date ? `Program Exit Data as of ${us(meta.exit_report_date)}` : "",
    ].filter(Boolean).join("   |   ");
    src.font = font({ size: 8, color: { argb: PEN.gray } });
    src.alignment = { vertical: "top" };
    ws.getRow(4).height = 18;
    r += 1;

    // A book-style table: navy title bar, slate headings, gray labels.
    const table = (col, row0, title, head, rows, fmts, total) => {
      let rr = row0;
      titleBar(ws, rr, col, head ? head.length : rows[0].length, title);
      rr += 1;
      if (head) {
        head.forEach((h, i) => headCell(ws.getCell(rr, col + i), h, { align: i ? "center" : "left" }));
        ws.getRow(rr).height = 18;
        rr += 1;
      }
      rows.forEach((vals) => {
        vals.forEach((v, i) => {
          const cell = ws.getCell(rr, col + i);
          if (i === 0) { labelCell(cell, v, !head); return; }
          putValue(cell, v, fmts[i]);
        });
        ws.getRow(rr).height = 17;
        rr += 1;
      });
      if (total) {
        total.forEach((v, i) => {
          const cell = ws.getCell(rr, col + i);
          cell.value = v;
          cell.font = font({ bold: true });
          if (fmts[i]) cell.numFmt = fmts[i];
          cell.alignment = i ? { horizontal: "center" } : { indent: 1 };
          cell.border = { top: line(PEN.ink), bottom: line() };
        });
        rr += 1;
      }
      return rr;
    };

    const tallyRows = (label) => tally(null, label).map(([k, v]) => [k, v.n, v.units]);
    const tot = ["Total", s.properties, s.units];
    const f3 = [null, "#,##0", "#,##0"];

    // The headline figures as a plain two-column table, the way the book
    // sets its pricing summary. The value spans the last two columns.
    const overview = [
      ["Properties", s.properties, "#,##0"],
      ["Total Units", s.units, "#,##0"],
      ["Rental Assistance Units", s.ra, "#,##0"],
      ["RA Share of Units", s.raShare === null ? "" : s.raShare, "0%"],
      ["Average Property Size", s.avgSize, "#,##0"],
      ["Exiting Within 10 Years", s.exiting, "#,##0"],
    ];
    let left = r;
    titleBar(ws, left, 1, 3, "Portfolio Overview");
    left += 1;
    overview.forEach(([k, v, z]) => {
      labelCell(ws.getCell(left, 1), k, true);
      ws.mergeCells(left, 2, left, 3);
      putValue(ws.getCell(left, 2), v, z);
      ws.getCell(left, 3).border = { bottom: line() };
      ws.getRow(left).height = 17;
      left += 1;
    });
    left = table(1, left + 1, "By State", ["State", "Properties", "Units"],
      tallyRows((x) => (x.state ? (Atlas.STATE_NAMES[x.state] || x.state) : "")), f3, tot);
    left = table(1, left + 1, "By Management", ["Management Agent", "Properties", "Units"],
      tallyRows((x) => tc(x.management) || "Not Stated"), f3, tot);

    let right = table(5, r, "By Exit Horizon", ["Exit Year", "Properties", "Units"],
      tallyRows((x) => (x.exit_year ? Atlas.horizonLabel(x.exit_year) : "Not Reported")), f3, tot);
    // The smallest and largest property by unit count. Where several tie,
    // the first by name is shown and the rest are counted beside it.
    const sized = rows.filter((x) => Number(x.units) > 0);
    if (sized.length) {
      const byName = (a, b) => tc(a.name).localeCompare(tc(b.name));
      const pick = (target) => {
        const hits = sized.filter((x) => Number(x.units) === target).sort(byName);
        const name = tc(hits[0].name) + (hits.length > 1 ? ` (+${hits.length - 1} tied)` : "");
        return [name, `${tc(hits[0].city)}, ${hits[0].state || ""}`.replace(/^, /, ""), target];
      };
      const min = Math.min(...sized.map((x) => Number(x.units)));
      const max = Math.max(...sized.map((x) => Number(x.units)));
      right = table(5, right + 1, "Property Size Range", ["Property", "Location", "Units"],
        [["Smallest", ...pick(min)], ["Largest", ...pick(max)]].map(([lab, name, place, units]) =>
          [`${lab}: ${name}`, place, units]), [null, null, "#,##0"], null);
    }

    if (s.missing > 0) {
      const have = new Set(records.map((x) => String(x.id)));
      table(1, Math.max(left, right) + 1, "Saved IDs Not in the Current Build", ["MFIS Project Key"],
        entry.ids.filter((id) => !have.has(String(id))).map((id) => [id]), [null], null);
    }
    printSetup(ws, null, "page");
    return ws;
  }

  /* ----------------------------------------------------- properties sheet */

  function propertiesSheet(wb, groups, full, primes) {
    const flat = groups.flatMap((g) => g.fields.map((f) => ({ group: g.title, label: f[0], get: f[1], z: f[2] })));
    const ws = wb.addWorksheet("Properties", {
      properties: { tabColor: { argb: PEN.seafoam } },
      views: [{ state: "frozen", xSplit: 1, ySplit: 6, showGridLines: false }],
    });
    pageHead(ws, "Properties", entry.name, Math.min(flat.length, 10));

    // Row 5: navy group bars over their columns, the way the book heads
    // "Year Ending" and "T-12" over their pairs of columns.
    let c = 1;
    groups.forEach((g) => {
      const span = g.fields.length;
      titleBar(ws, 5, c, span, g.title);
      for (let k = c; k < c + span; k++) {
        ws.getCell(5, k).border = { left: k === c ? line(PEN.white) : undefined, right: k === c + span - 1 ? line(PEN.white) : undefined };
      }
      c += span;
    });

    // Row 6: the column headings.
    flat.forEach((f, i) => headCell(ws.getCell(6, i + 1), f.label, { align: i === 0 ? "left" : "center" }));
    ws.getRow(6).height = 42;

    full.forEach((d, n) => {
      const row = ws.getRow(7 + n);
      flat.forEach((f, i) => {
        const cell = row.getCell(i + 1);
        const v = f.get(d, primes[n]);
        if (i === 0) labelCell(cell, v, true);
        else putValue(cell, v, f.z);
      });
      row.height = 18;
    });

    // Totals under the columns where a sum means something.
    const sumLabels = new Set(["Total units", "Rental assistance units", "Vacant units", "Occupied units",
      "Accessible units", "Contract units", "Annual fee ceiling", "Loan amount (source)",
      "1 BR units", "2 BR units", "3 BR units", "4 BR units", "5 BR units", "6 BR units"].map(bookCase));
    const first = 7;
    const tr = first + full.length;
    if (full.length) {
      flat.forEach((f, i) => {
        const cell = ws.getCell(tr, i + 1);
        cell.border = { top: line(PEN.ink) };
        cell.font = font({ bold: true });
        cell.alignment = { horizontal: "center" };
        const col = ws.getColumn(i + 1).letter;
        if (i === 0) {
          cell.value = "Total";
          cell.alignment = { indent: 1 };
        } else if (sumLabels.has(f.label)) {
          cell.value = { formula: `SUM(${col}${first}:${col}${tr - 1})` };
          cell.numFmt = f.z || "#,##0";
        } else if (f.label === bookCase("RA share of units")) {
          const u = ws.getColumn(flat.findIndex((x) => x.label === bookCase("Total units")) + 1).letter;
          const ra = ws.getColumn(flat.findIndex((x) => x.label === bookCase("Rental assistance units")) + 1).letter;
          cell.value = { formula: `IFERROR(SUM(${ra}${first}:${ra}${tr - 1})/SUM(${u}${first}:${u}${tr - 1}),"")` };
          cell.numFmt = "0%";
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

    ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6 + full.length, column: flat.length } };
    printSetup(ws, "5:6", false);
    return ws;
  }

  /* ------------------------------------------------- property detail sheet */

  function detailSheet(wb, groups, full, primes) {
    const ws = wb.addWorksheet("Property Detail", {
      properties: { tabColor: { argb: PEN.slate } },
      views: [{ state: "frozen", xSplit: 1, ySplit: 5, showGridLines: false }],
    });
    const width = 1 + full.length;
    ws.getColumn(1).width = 36;
    for (let c = 2; c <= width; c++) ws.getColumn(c).width = full.length === 1 ? 44 : 24;
    pageHead(ws, "Property Detail", entry.name, Math.max(2, Math.min(width, 6)));

    headCell(ws.getCell(5, 1), "", { align: "left" });
    full.forEach((d, i) => {
      const cell = ws.getCell(5, 2 + i);
      headCell(cell, tc(d.name));
      cell.value = {
        text: tc(d.name),
        hyperlink: new URL(`detail.html?id=${encodeURIComponent(d.id)}`, location.href).toString(),
        tooltip: "Open the property page in the atlas",
      };
      cell.font = font({ size: 10, color: { argb: PEN.white } });
    });
    ws.getRow(5).height = 36;

    let r = 6;
    groups.forEach((g) => {
      // Navy section bar, set in bold capitals like "GENERAL INFORMATION".
      for (let c = 1; c <= width; c++) ws.getCell(r, c).fill = fill(PEN.navy);
      const sec = ws.getCell(r, 1);
      sec.value = g.title.toUpperCase();
      sec.font = font({ size: 10, bold: true, color: { argb: PEN.white } });
      sec.alignment = { indent: 1, vertical: "middle" };
      ws.getRow(r).height = 19;
      r += 1;

      g.fields.forEach(([lab, get, z]) => {
        labelCell(ws.getCell(r, 1), lab, true);
        full.forEach((d, i) => {
          const cell = ws.getCell(r, 2 + i);
          putValue(cell, get(d, primes[i]), z);
          if (cell.alignment) cell.alignment = { ...cell.alignment, wrapText: true };
          if (lab === bookCase("Prime Score") && typeof cell.value === "number") {
            cell.font = font({ bold: true });
          }
        });
        r += 1;
      });
      ws.getRow(r).height = 8;
      r += 1;
    });
    printSetup(ws, "5:5", full.length <= 6);
    return ws;
  }

  async function download({ name, records, ids = [], summary = true, button = null }) {
    const label = button ? button.textContent : "";
    if (button) { button.disabled = true; button.textContent = "Preparing..."; }
    try {
      const ExcelJS = await loadExcel();
      entry = { name, ids };
      rows = records;
      /* One shard per state, cached by the shared loader, so a portfolio
         spread over a few states costs a few requests, not one per property. */
      const full = await Promise.all(records.map(async (r) => {
        try { return { ...r, ...((await Atlas.detail(r)) || {}) }; }
        catch (e) { return { ...r }; }
      }));
      const weights = Atlas.primeWeights();
      const primes = full.map((d) => Atlas.primeScore(d, weights));

      const groups = fieldGroups();
      const extras = extraFields(full, groups);
      if (extras.length) groups.push({ title: "Other Data", uses: [], fields: extras });
      groups.forEach((g) => {
        g.title = bookCase(g.title);
        g.fields = g.fields.map(([lab, get, z]) => [bookCase(lab), get, z]);
      });

      const wb = new ExcelJS.Workbook();
      wb.creator = Atlas.sessionEmail() || "USDA Section 515 Property Atlas";
      wb.title = name;
      wb.created = new Date();
      if (summary) {
        summarySheet(wb, full);
        propertiesSheet(wb, groups, full, primes);
        detailSheet(wb, groups, full, primes);
      } else {
        // One property: the page itself first, then the same one-row sheet a
        // portfolio export carries, so the two can be stacked.
        detailSheet(wb, groups, full, primes);
        propertiesSheet(wb, groups, full, primes);
      }

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name.replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").toLowerCase()
        + "-full-" + new Date().toISOString().slice(0, 10) + ".xlsx";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      if (button) {
        button.textContent = "Downloaded";
        setTimeout(() => { button.textContent = label; }, 1800);
      }
    } catch (err) {
      if (button) button.textContent = label;
      window.alert(`Could not build the workbook. ${err.message}`);
    } finally {
      if (button) button.disabled = false;
    }
  }

  return { download, loadExcel };
})();

/* The Portfolios tab.

   A portfolio is a saved list of property ids. The store itself lives in
   app.js (listPortfolios, savePortfolio, renamePortfolio, removePortfolio),
   which is also where the localStorage decision and the share link are
   explained. This file is the page that shows them.

   The list renders from the store alone, so it is still useful when the data
   files fail to load or the session has lapsed. The atlas index, when it does
   load, fills in the figures underneath each name: units, states, how many of
   the saved ids no longer exist in the current build. That last one matters,
   because USDA drops exited properties from the source file and a portfolio
   saved in March can quietly lose a property by June. */

(function () {
  const $ = (id) => document.getElementById(id);
  const host = $("pf-cards");
  if (!host) return;

  let byId = null;          // null until the index loads, Map after
  let loadError = "";

  function when(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }

  function plural(n, one, many) { return n === 1 ? one : many; }

  /* Everything the card prints under the name. Returns null while the index
     is still loading or failed, which the card reads as "ids only". */
  function figures(p) {
    if (!byId) return null;
    const rows = p.ids.map((id) => byId.get(String(id))).filter(Boolean);
    const units = rows.reduce((a, r) => a + (Number(r.units) || 0), 0);
    const ra = rows.reduce((a, r) => a + (Number(r.ra_units) || 0), 0);
    const states = [...new Set(rows.map((r) => r.state).filter(Boolean))].sort();
    const exiting = rows.filter((r) => Number(r.years_to_exit) >= 0 && Number(r.years_to_exit) <= 10).length;
    return { rows, units, ra, states, exiting, missing: p.ids.length - rows.length };
  }

  function propertyLine(f) {
    if (!f || !f.rows.length) return "";
    const names = f.rows.slice(0, 4).map((r) => Atlas.titleCase(r.name));
    const rest = f.rows.length - names.length;
    return Atlas.esc(names.join(", ")) +
      (rest > 0 ? ` <span class="pf-more">and ${rest} more</span>` : "");
  }

  function statLine(p, f) {
    const n = p.ids.length;
    const bits = [`<b>${n}</b> ${plural(n, "property", "properties")}`];
    if (f) {
      if (f.units) bits.push(`<b>${Atlas.num(f.units)}</b> units`);
      if (f.ra) bits.push(`<b>${Atlas.num(f.ra)}</b> RA units`);
      if (f.states.length) bits.push(Atlas.esc(f.states.join(", ")));
      if (f.exiting) bits.push(`<b>${f.exiting}</b> exiting within 10 years`);
    }
    return bits.map((b) => `<span class="pf-stat">${b}</span>`).join("");
  }

  function card(p) {
    const f = figures(p);
    const name = Atlas.esc(p.name);
    const gone = f && f.missing > 0
      ? `<p class="pf-warn">${f.missing} of these ${plural(f.missing, "is", "are")} no longer in the
         current USDA build, so ${plural(f.missing, "it", "they")} will not appear when you open it.</p>`
      : "";
    return `
      <article class="pf-card" data-name="${name}">
        <div class="pf-card-main">
          <h3 class="pf-name">${name}</h3>
          <p class="pf-stats">${statLine(p, f)}</p>
          <p class="pf-props">${propertyLine(f)}</p>
          ${gone}
          <p class="pf-when">Saved ${Atlas.esc(when(p.savedAt))}</p>
        </div>
        <div class="pf-card-acts">
          <button type="button" class="btn primary" data-act="table">Open in table</button>
          <button type="button" class="btn" data-act="map">Open on map</button>
          <button type="button" class="btn" data-act="link">Copy link</button>
          <button type="button" class="btn" data-act="rename">Rename</button>
          <button type="button" class="btn danger" data-act="delete">Delete</button>
        </div>
      </article>`;
  }

  function empty() {
    return `
      <div class="panel pf-empty">
        <h3>Nothing saved yet</h3>
        <p>On the <a href="index.html">Table</a> tab, tick the properties you want, name the set in the
        box at the bottom of the window and click <b>Save</b>. It shows up here.</p>
      </div>`;
  }

  function paint() {
    const list = Atlas.listPortfolios();
    if (!list.length) { host.innerHTML = empty(); return; }
    host.innerHTML = `<div class="pf-grid">${list.map(card).join("")}</div>`;
    host.querySelectorAll(".pf-card").forEach(wire);
  }

  /* Opening sets the stored selection and the selected-only flag, then moves
     to the page that shows it. Both pages read the same session storage, so
     the destination needs nothing passed to it. */
  function open(name, page) {
    const hit = Atlas.loadPortfolio(name);
    if (!hit) return;
    location.href = page;
  }

  async function copyLink(entry, btn) {
    const url = Atlas.portfolioLink(entry);
    try {
      await navigator.clipboard.writeText(url);
      const was = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(() => { btn.textContent = was; }, 1600);
    } catch (e) {
      // Clipboard access is blocked outside a secure context, so fall back to
      // something the reader can still copy by hand.
      window.prompt("Copy this link", url);
    }
  }

  function rename(entry) {
    const next = window.prompt("Rename this portfolio", entry.name);
    if (next === null) return;
    const out = Atlas.renamePortfolio(entry.name, next);
    if (!out) {
      window.alert("That name is empty or already in use, so nothing was changed.");
      return;
    }
    paint();
  }

  function wire(el) {
    const name = el.dataset.name;
    el.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const entry = Atlas.listPortfolios().find((p) => p.name === name);
        if (!entry) { paint(); return; }
        switch (btn.dataset.act) {
          case "table":  open(entry.name, "index.html"); break;
          case "map":    open(entry.name, "map.html"); break;
          case "link":   copyLink(entry, btn); break;
          case "rename": rename(entry); break;
          case "delete":
            if (!window.confirm(`Delete "${entry.name}"? This cannot be undone.`)) return;
            Atlas.removePortfolio(entry.name);
            paint();
            break;
        }
      });
    });
  }

  // The store needs no network, so the list is up before the data call runs.
  paint();

  Atlas.load().then(() => {
    byId = new Map(Atlas.index.map((r) => [String(r.id), r]));
    paint();
  }).catch((err) => {
    loadError = err && err.message ? err.message : "";
    const sub = $("pf-sub");
    if (sub && loadError) {
      sub.insertAdjacentHTML("beforeend",
        ` <span class="pf-warn-inline">The property data did not load, so the figures below are
          hidden. ${Atlas.esc(loadError)}</span>`);
    }
  });
})();

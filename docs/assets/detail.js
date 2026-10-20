/* Property detail page. Reads ?id= from the URL, renders the same sections the
   drawer uses, and draws a small map of the property with its neighbors. */

(() => {
  const $ = (id) => document.getElementById(id);
  const MILES_SHOWN = 25;
  const MAX_NEIGHBORS = 60;
  const PF_RETURN_KEY = "atlas.pfReturn";

  /* Where the reader came from. A property opened from a portfolio carries
     from=portfolio and pf=<name>, and that context rides along on every
     neighbor link so the way back survives a hop to the property next door. */
  const params = new URLSearchParams(location.search);
  const from = params.get("from");
  const pfName = params.get("pf");
  const ctx = (() => {
    const q = new URLSearchParams();
    if (from === "map") q.set("from", "map");
    if (from === "portfolio") {
      q.set("from", "portfolio");
      if (pfName) q.set("pf", pfName);
    }
    const s = q.toString();
    return s ? "&" + s : "";
  })();
  const detailHref = (id) => `detail.html?id=${encodeURIComponent(id)}${ctx}`;

  /* The portfolio page records its own address on the way out, which is the
     only way back to a portfolio that arrived on a share link and was never
     saved. A saved one can always be found again by name. */
  function portfolioReturn() {
    let stored = null;
    try { stored = sessionStorage.getItem(PF_RETURN_KEY); } catch (e) {}
    if (stored) {
      try {
        const u = new URL(stored, location.href);
        const name = u.searchParams.get("name") || u.searchParams.get("portfolio");
        if (u.origin === location.origin && /portfolio\.html$/.test(u.pathname)
            && (!pfName || (name || "").toLowerCase() === pfName.toLowerCase())) {
          return u.pathname.split("/").pop() + u.search;
        }
      } catch (e) { /* malformed, fall through */ }
    }
    return pfName ? `portfolio.html?name=${encodeURIComponent(pfName)}` : "portfolios.html";
  }

  function paintBackLink() {
    const link = $("backlink");
    if (from === "map") {
      link.setAttribute("href", "map.html");
      link.textContent = "← Back to the map";
      return;
    }
    if (from === "portfolio") {
      link.setAttribute("href", portfolioReturn());
      link.textContent = "← Back to the portfolio";
      if (pfName) {
        const tag = document.createElement("span");
        tag.className = "backname";
        tag.textContent = pfName;
        link.after(tag);
      }
      $("nav-portfolios")?.classList.add("active");
    }
  }
  paintBackLink();

  /** Great-circle distance in miles. Good enough at this scale. */
  function milesBetween(a, b) {
    const R = 3958.8;
    const toRad = (v) => (v * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const s = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function neighbors(subject) {
    if (subject.lat === null || subject.lon === null) return [];
    return Atlas.index
      .filter((r) => r.id !== subject.id && r.lat !== null && r.lon !== null)
      // Cheap box test before the trigonometry, so this stays fast over 12,000 rows.
      .filter((r) => Math.abs(r.lat - subject.lat) < 0.6
                  && Math.abs(r.lon - subject.lon) < 0.7)
      .map((r) => ({ ...r, miles: milesBetween(subject, r) }))
      .filter((r) => r.miles <= MILES_SHOWN)
      .sort((a, b) => a.miles - b.miles)
      .slice(0, MAX_NEIGHBORS);
  }

  /* The same five horizon colors the table pills and the main map use, read
     off the stylesheet. This used to collapse past, far and not reported into
     one color, so two properties a decade apart on the exit clock drew
     identically. */
  const COLORS = Atlas.horizonColors();

  function dot(record, subject) {
    const isSubject = record.id === subject.id;
    const cls = Atlas.horizonClass(record.exit_year);
    const marker = L.circleMarker([record.lat, record.lon], {
      radius: isSubject ? 9 : 6,
      weight: isSubject ? 3 : 1.5,
      color: isSubject ? "#081937" : "#ffffff",
      fillColor: COLORS[cls],
      fillOpacity: isSubject ? 1 : 0.85,
    });

    const miles = isSubject ? "" : ` &middot; ${record.miles.toFixed(1)} mi`;
    marker.bindTooltip(
      `<b>${Atlas.esc(Atlas.titleCase(record.name))}</b><br>`
      + `${Atlas.esc(Atlas.titleCase(record.city))}, ${Atlas.esc(record.state)}`
      + ` &middot; ${Atlas.num(record.units)} units${miles}`,
      { direction: "top", offset: [0, -6] });

    if (!isSubject) {
      marker.on("click", () => {
        location.href = detailHref(record.id);
      });
    }
    return marker;
  }

  function drawMap(subject, near) {
    const host = $("minimap");
    if (subject.lat === null || subject.lon === null) {
      host.innerHTML = '<p class="loading">USDA publishes no coordinates for this property.</p>';
      $("nearnote").textContent = "";
      return;
    }

    const map = L.map(host, { scrollWheelZoom: false, zoomControl: true })
      .setView([subject.lat, subject.lon], 11);
    // Esri's light gray canvas rather than standard OpenStreetMap, so the
    // neighbors read as the subject of the picture instead of competing with
    // the streets underneath them.
    L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 16,
      attribution: 'Tiles &copy; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 16,
    }).addTo(map);

    const layer = L.layerGroup([subject, ...near].map((r) => dot(r, subject))).addTo(map);

    if (near.length) {
      const pts = [subject, ...near].map((r) => [r.lat, r.lon]);
      map.fitBounds(L.latLngBounds(pts).pad(0.2), { maxZoom: 12 });
    }

    // The panel is sized by CSS after this runs, so Leaflet needs a nudge.
    requestAnimationFrame(() => map.invalidateSize({ animate: false }));
    window.addEventListener("resize", () => map.invalidateSize({ animate: false }));

    $("nearnote").innerHTML = near.length
      ? `${near.length} other ${near.length === 1 ? "property" : "properties"} within `
        + `${MILES_SHOWN} miles. Click a dot to open it. Color follows the exit horizon.`
      : `No other USDA properties within ${MILES_SHOWN} miles.`;
    return layer;
  }

  function drawList(near) {
    const host = $("nearlist");
    if (!near.length) {
      host.innerHTML = '<li class="none">Nothing else nearby.</li>';
      return;
    }
    host.innerHTML = near.slice(0, 12).map((r) => `
      <li>
        <a href="${detailHref(r.id)}">${Atlas.esc(Atlas.titleCase(r.name))}</a>
        <span class="meta">${Atlas.esc(Atlas.titleCase(r.city))}, ${Atlas.esc(r.state)}
          &middot; ${Atlas.num(r.units)} units
          &middot; <b>${r.miles.toFixed(1)} mi</b></span>
      </li>`).join("");
  }

  function drawHead(d) {
    const cls = Atlas.horizonClass(d.exit_year);
    $("dhead").innerHTML = `
      <h2>${Atlas.titleCase(d.name)}</h2>
      <p class="where">${Atlas.titleCase(d.address || "")}${d.address ? ", " : ""}${Atlas.titleCase(d.city)}, ${Atlas.esc(d.state)} ${Atlas.esc(d.zip) || ""}</p>
      <div class="headfacts">
        <div><span>Units</span><b>${Atlas.num(d.units)}</b></div>
        <div><span>RA units</span><b>${Atlas.num(d.ra_units)}</b></div>
        <div><span>Section 8</span><b>${d.s8 ? "Yes" : "No"}</b></div>
        <div><span>LIHTC</span><b>${d.lihtc ? "Yes" : "No"}</b></div>
        ${d.basis_rank === null || d.basis_rank === undefined ? ""
          : `<div><span>QCT / DDA</span><b>${d.basis_rank === 0 ? "No" : Atlas.basisLabel(d)}</b></div>`}
        ${d.rd_eligible === false ? '<div><span>USDA rural</span><b>Ineligible</b></div>' : ""}
        <div><span>Exit</span><b><span class="pill ${cls}">${Atlas.horizonLabel(d.exit_year)}</span></b></div>
      </div>`;
    document.title = `${Atlas.titleCase(d.name)} - USDA Section 515 Property Atlas`;
  }

  Atlas.load().then(async () => {
    const id = params.get("id");
    const stub = Atlas.index.find((r) => String(r.id) === String(id));

    if (!stub) {
      $("dhead").innerHTML = `<h2>Property not found</h2>
        <p class="where">No property in the atlas carries the id
        <code>${Atlas.esc(id || "(none given)")}</code>.</p>`;
      $("dbody").innerHTML = "";
      $("minimap").innerHTML = "";
      return;
    }

    const full = { ...stub, ...((await Atlas.detail(stub)) || {}) };
    full.basis_rank = Atlas.basisRank(full);
    drawHead(full);
    $("dbody").innerHTML = Atlas.detailSections(full);

    const near = neighbors(stub);
    drawMap(stub, near);
    drawList(near);
  }).catch((err) => {
    $("dhead").innerHTML = `<h2>Could not load</h2><p class="where">${Atlas.esc(err.message)}</p>`;
  });
})();

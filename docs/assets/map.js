/* Map page: clustered points colored by how soon the property exits the program.

   Program exit is ordered data, so the three future buckets are one hue that
   darkens as the exit gets closer and the ramp itself carries the ordering.
   "Projected date passed" is a state rather than a rank, so it keeps a status
   color and always ships with a written label in the legend. The values live
   in the stylesheet, next to the table pills that use the same five, and are
   read back here because Leaflet needs them as colors rather than classes. */

(() => {
  const BUCKETS = [
    { key: "past", label: "Projected date passed" },
    { key: "near", label: "Within 5 years" },
    { key: "mid", label: "6 to 10 years" },
    { key: "far", label: "More than 10 years" },
    { key: "none", label: "Not reported" },
  ];

  /* The basemap. CARTO's muted tiles now want an API key and stamp a watermark
     without one, so the quiet option here is Esri's light gray canvas, which
     needs no key. OpenStreetMap stays available as a second choice: it is much
     busier, and useful exactly when the busyness is the point and you want
     street names and buildings under a pin. */
  const BASEMAPS = {
    muted: {
      label: "Muted",
      url: "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      attribution: 'Tiles &copy; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 16,
      reference: "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
    },
    standard: {
      label: "Detailed",
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
      reference: null,
    },
  };

  const BASEMAP_KEY = "atlas.basemap";

  let map;
  let cluster;
  let COLORS = {};
  let baseLayer = null;
  let refLayer = null;
  let legendBody = null;
  let currentBasemap = "muted";

  function storedBasemap() {
    try {
      const v = sessionStorage.getItem(BASEMAP_KEY);
      return BASEMAPS[v] ? v : "muted";
    } catch (e) { return "muted"; }
  }

  function paintStats(rows) {
    const s = Atlas.summarize(rows);
    document.getElementById("stats").innerHTML = `
      <div class="stat"><div class="k">Mapped properties</div><div class="v">${s.properties.toLocaleString()}</div></div>
      <div class="stat"><div class="k">Total units</div><div class="v">${s.units.toLocaleString()}</div></div>
      <div class="stat"><div class="k">Rental assistance units</div><div class="v">${s.ra.toLocaleString()}</div></div>
      <div class="stat alert"><div class="k">Exiting within 10 years</div><div class="v">${s.exiting.toLocaleString()}</div></div>
    `;
  }

  /* Area, not radius, carries unit count, so a property twice the size draws
     twice the ink rather than four times it. */
  function radiusFor(units) {
    return Math.max(4, Math.min(12, Math.sqrt(units || 1) * 1.15));
  }

  function marker(r) {
    const cls = Atlas.horizonClass(r.exit_year);
    const dot = L.circleMarker([r.lat, r.lon], {
      radius: radiusFor(r.units),
      // A surface ring keeps two overlapping properties readable as two.
      color: "#ffffff",
      weight: 1.5,
      opacity: 0.95,
      fillColor: COLORS[cls],
      fillOpacity: 0.9,
    });

    dot.horizon = cls;

    dot.bindPopup(`
      <strong>${Atlas.titleCase(r.name)}</strong><br>
      ${Atlas.titleCase(r.city)}, ${r.state}<br>
      ${Atlas.num(r.units)} units, ${Atlas.num(r.ra_units)} with rental assistance<br>
      Exit: ${Atlas.horizonLabel(r.exit_year)}<br>
      <a href="#" data-id="${r.id}" class="popup-detail">Full detail</a>
    `);

    dot.on("popupopen", (e) => {
      const link = e.popup.getElement().querySelector(".popup-detail");
      if (link) link.addEventListener("click", (ev) => { ev.preventDefault(); Atlas.openDetail(r); });
    });

    return dot;
  }

  /* A cluster wears the mix of its members as a ring, with the count in the
     middle. Painting it a single color means whichever bucket happens to be
     largest, which at national zoom is always "more than 10 years" and leaves
     the map one flat shade of blue with the near-term properties, the ones
     worth finding, hidden inside it. The ring keeps them visible at every
     zoom. The default markercluster bubble is a stock green/yellow/red that
     means density, a second encoding that contradicts this one, so it is
     replaced rather than recolored. */
  function clusterIcon(c) {
    const children = c.getAllChildMarkers();
    const tally = {};
    children.forEach((m) => { tally[m.horizon] = (tally[m.horizon] || 0) + 1; });

    const n = children.length;
    const size = n < 10 ? 32 : n < 100 ? 40 : n < 1000 ? 48 : 56;
    const label = n < 1000 ? n : Math.round(n / 100) / 10 + "k";

    // Segments run soonest first, so the ring reads clockwise from urgent.
    const order = ["past", "near", "mid", "far", "none"];
    const stops = [];
    let at = 0;
    order.forEach((key) => {
      const share = (tally[key] || 0) / n;
      if (!share) return;
      const end = at + share * 100;
      stops.push(`${COLORS[key]} ${at.toFixed(2)}% ${end.toFixed(2)}%`);
      at = end;
    });
    // One bucket only, so there is nothing to divide.
    if (stops.length === 1) stops.push(stops[0]);

    const mix = BUCKETS
      .filter(({ key }) => tally[key])
      .map(({ key, label: text }) => `${tally[key]} ${text.toLowerCase()}`)
      .join(", ");

    return L.divIcon({
      html: `<div class="ring" style="background:conic-gradient(${stops.join(",")})"
                  title="${Atlas.esc(n.toLocaleString() + " properties: " + mix)}"
             ><span style="font-size:${n < 100 ? 12 : 12.5}px">${label}</span></div>`,
      className: "hcluster",
      iconSize: L.point(size, size),
    });
  }

  /* Counts beside each color, recomputed on every filter change. A legend that
     only names the colors leaves the reader guessing how much of the map is in
     each bucket, which is most of what they want to know. */
  function paintLegend(rows) {
    if (!legendBody) return;
    const tally = {};
    rows.forEach((r) => {
      const k = Atlas.horizonClass(r.exit_year);
      tally[k] = (tally[k] || 0) + 1;
    });
    legendBody.innerHTML = BUCKETS.map(({ key, label }) => `
      <div class="row">
        <i style="background:${COLORS[key]}"></i>
        <span>${label}</span>
        <span class="n">${(tally[key] || 0).toLocaleString()}</span>
      </div>`).join("");
  }

  function setBasemap(key) {
    const conf = BASEMAPS[key] || BASEMAPS.muted;
    currentBasemap = BASEMAPS[key] ? key : "muted";
    try { sessionStorage.setItem(BASEMAP_KEY, currentBasemap); } catch (e) {}

    if (baseLayer) map.removeLayer(baseLayer);
    if (refLayer) { map.removeLayer(refLayer); refLayer = null; }

    baseLayer = L.tileLayer(conf.url, {
      attribution: conf.attribution,
      maxZoom: conf.maxZoom,
      pane: "tilePane",
    }).addTo(map);

    // Place names ride in their own pane under the data, so a label never
    // lands on top of a property.
    if (conf.reference) {
      refLayer = L.tileLayer(conf.reference, {
        maxZoom: conf.maxZoom,
        pane: "basemapLabels",
      }).addTo(map);
    }

    document.querySelectorAll(".basemap-switch button").forEach((b) => {
      b.classList.toggle("on", b.dataset.base === currentBasemap);
    });
  }

  function refresh() {
    const rows = Atlas.apply(Atlas.readFilters(document));
    paintStats(rows);
    paintLegend(rows);
    Atlas.paintManagerBanner(document);

    // The stat tiles above the map change height as they fill in, which leaves
    // Leaflet holding the container width it measured at init. Without this the
    // tile grid is laid out against the old size and slides off to one side.
    map.invalidateSize({ animate: false });

    cluster.clearLayers();
    const points = rows.filter((r) => r.lat !== null && r.lon !== null);
    cluster.addLayers(points.map(marker));

    if (points.length && rows.length < Atlas.index.length) {
      map.fitBounds(L.latLngBounds(points.map((r) => [r.lat, r.lon])).pad(0.12));
    }
  }

  Atlas.load().then(({ meta }) => {
    map = L.map("map", { preferCanvas: true }).setView([38.5, -96], 4);
    COLORS = Atlas.horizonColors();

    // Between the tiles and the markers: basemap place names.
    map.createPane("basemapLabels");
    map.getPane("basemapLabels").style.zIndex = 250;
    map.getPane("basemapLabels").style.pointerEvents = "none";

    setBasemap(storedBasemap());

    cluster = L.markerClusterGroup({
      chunkedLoading: true,
      spiderfyOnMaxZoom: true,
      maxClusterRadius: 45,
      // Past this zoom every property draws as its own pin. Without it the
      // cluster survives to max zoom and a town's properties stay hidden
      // behind one number until you spiderfy them.
      disableClusteringAtZoom: 12,
      iconCreateFunction: clusterIcon,
    });
    map.addLayer(cluster);

    const legend = L.control({ position: "bottomright" });
    legend.onAdd = () => {
      const div = L.DomUtil.create("div", "legend");
      div.innerHTML = `
        <span class="legend-title">Program exit</span>
        <div class="legend-body"></div>
        <span class="legend-foot">
          Circle size is unit count.
          <span class="sizekey">
            <span style="width:9px;height:9px"></span>
            <span style="width:15px;height:15px"></span>
            <span style="width:23px;height:23px"></span>
          </span>
        </span>`;
      L.DomEvent.disableClickPropagation(div);
      legendBody = div.querySelector(".legend-body");
      return div;
    };
    legend.addTo(map);

    const switcher = L.control({ position: "topright" });
    switcher.onAdd = () => {
      const div = L.DomUtil.create("div", "basemap-switch");
      div.innerHTML = Object.entries(BASEMAPS)
        .map(([key, conf]) => `<button type="button" data-base="${key}">${conf.label}</button>`)
        .join("");
      L.DomEvent.disableClickPropagation(div);
      div.querySelectorAll("button").forEach((b) => {
        b.addEventListener("click", () => setBasemap(b.dataset.base));
      });
      return div;
    };
    switcher.addTo(map);
    document.querySelectorAll(".basemap-switch button").forEach((b) => {
      b.classList.toggle("on", b.dataset.base === currentBasemap);
    });

    Atlas.carryParamsIntoNav(document);
    Atlas.buildFilterBar(document, refresh);
    refresh();

    // Re-measure once more after the browser has finished its first paint, and
    // again if the window changes shape.
    requestAnimationFrame(() => map.invalidateSize({ animate: false }));
    window.addEventListener("resize", () => map.invalidateSize({ animate: false }));

    document.getElementById("sourcenote").innerHTML =
      `Property Characteristics as of ${meta.property_report_date}, Program Exit Data as of ${meta.exit_report_date}. ` +
      `Built ${meta.built} from USDA Rural Development open data.`;
  }).catch((err) => {
    document.getElementById("map").innerHTML = `<div class="loading">Could not load the data files. ${err}</div>`;
  });
})();

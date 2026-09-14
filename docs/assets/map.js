/* Map page: clustered points colored by how soon the property exits the program. */

(() => {
  const COLORS = { past: "#6b3fa0", near: "#c0392b", mid: "#e08a2e", far: "#3b7f83", none: "#98a2b8" };

  let map;
  let cluster;

  function paintStats(rows) {
    const s = Atlas.summarize(rows);
    document.getElementById("stats").innerHTML = `
      <div class="stat"><div class="k">Mapped properties</div><div class="v">${s.properties.toLocaleString()}</div></div>
      <div class="stat"><div class="k">Total units</div><div class="v">${s.units.toLocaleString()}</div></div>
      <div class="stat"><div class="k">Rental assistance units</div><div class="v">${s.ra.toLocaleString()}</div></div>
      <div class="stat alert"><div class="k">Exiting within 10 years</div><div class="v">${s.exiting.toLocaleString()}</div></div>
    `;
  }

  function marker(r) {
    const cls = Atlas.horizonClass(r.exit_year);
    const dot = L.circleMarker([r.lat, r.lon], {
      radius: Math.max(4, Math.min(11, Math.sqrt(r.units || 1) * 1.1)),
      color: "#fff",
      weight: 1,
      fillColor: COLORS[cls],
      fillOpacity: 0.85,
    });

    dot.bindPopup(`
      <strong>${Atlas.titleCase(r.name)}</strong><br>
      ${Atlas.titleCase(r.city)}, ${r.state}<br>
      ${Atlas.num(r.units)} units, ${Atlas.num(r.ra_units)} with rental assistance<br>
      Exit: ${Atlas.horizonLabel(r.exit_year)}<br>
      <a href="#" data-id="${r.id}" class="popup-detail">Full detail</a>
    `);

    dot.on("popupopen", (e) => {
      const link = e.popup.getElement().querySelector(".popup-detail");
      if (link) link.addEventListener("click", (ev) => { ev.preventDefault(); Atlas.openDrawer(r); });
    });

    return dot;
  }

  function refresh() {
    const rows = Atlas.apply(Atlas.readFilters(document));
    paintStats(rows);

    // The stat tiles above the map change height as they fill in, which leaves
    // Leaflet holding the container width it measured at init. Without this the
    // tile grid is laid out against the old size and slides off to one side.
    map.invalidateSize({ animate: false });

    cluster.clearLayers();
    const points = rows.filter((r) => r.lat !== null && r.lon !== null);
    cluster.addLayers(points.map(marker));

    if (points.length && points.length < Atlas.index.length) {
      map.fitBounds(L.latLngBounds(points.map((r) => [r.lat, r.lon])).pad(0.12));
    }
  }

  Atlas.load().then(({ meta }) => {
    map = L.map("map", { preferCanvas: true }).setView([38.5, -96], 4);

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(map);

    cluster = L.markerClusterGroup({
      chunkedLoading: true,
      spiderfyOnMaxZoom: true,
      maxClusterRadius: 45,
    });
    map.addLayer(cluster);

    const legend = L.control({ position: "bottomright" });
    legend.onAdd = () => {
      const div = L.DomUtil.create("div", "legend");
      div.innerHTML = `
        <strong>Program exit</strong><br>
        <i style="background:${COLORS.past}"></i>Projected date passed<br>
        <i style="background:${COLORS.near}"></i>Within 5 years<br>
        <i style="background:${COLORS.mid}"></i>6 to 10 years<br>
        <i style="background:${COLORS.far}"></i>More than 10 years<br>
        <i style="background:${COLORS.none}"></i>Not reported
      `;
      return div;
    };
    legend.addTo(map);

    Atlas.buildFilterBar(document, refresh);
    refresh();

    // Re-measure once more after the browser has finished its first paint, and
    // again if the window changes shape.
    requestAnimationFrame(() => map.invalidateSize({ animate: false }));
    window.addEventListener("resize", () => map.invalidateSize({ animate: false }));

    document.getElementById("sourcenote").innerHTML =
      `Property Characteristics as of ${meta.property_report_date}, Program Exit Data as of ${meta.exit_report_date}. ` +
      `Marker size reflects unit count. Built ${meta.built} from USDA Rural Development open data.`;
  }).catch((err) => {
    document.getElementById("map").innerHTML = `<div class="loading">Could not load the data files. ${err}</div>`;
  });
})();

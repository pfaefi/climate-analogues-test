// Detail screen «Resultate im Detail» (user, 2026-11-03; data_and_tests.md §33, §34): a world
// map of the normal summer climate 1991-2020, every land cell in one of five classes compared
// with the place's summer 2026 (analogue area, warmer / cooler and wetter / drier), the image
// locations and guesses of the five rounds, and per round the points, the climate sentence
// and the panorama again (only on a tap, so that no Street View quota is used unasked).
//
// The classes are computed here in the browser from two world images of script 43 (mean T
// and mean P on a 16 km grid, 16-bit numbers in the red and green channel). Analogue areas
// outside the tropics come from the bundle's world images of script 23 (any analogue share in
// an 8 km block), in the tropics from detail/tropics/bundle_<n>.json (script 43).

import { t, withElevation } from "./i18n.js";
import { loadGoogleMaps } from "./google.js";
import { fetchProduct, loadRegions } from "./data.js";
import { imagePixels, MIDDLE_MAP } from "./results.js";
import { climateSentence } from "./play.js";

const PRODUCTS = window.APP_SETTINGS.products;

// Colours of the classes (chosen with the user and checked for colour vision deficiencies,
// script 42, data_and_tests.md §33): [red, green, blue].
const CLASS_COLOURS = {
  analogue: [241, 105, 19],      // #F16913 orange
  warmerWetter: [60, 110, 42],   // #3C6E2A dark green
  warmerDrier: [156, 42, 123],   // #9C2A7B purple (stripes)
  coolerWetter: [42, 159, 166],  // #2A9FA6 petrol (stripes)
  coolerDrier: [221, 213, 197]   // #DDD5C5 sand grey
};
const LEGEND_ORDER = ["analogue", "warmerWetter", "warmerDrier", "coolerWetter", "coolerDrier"];

// The map shows the world down to 85° S (Google's map ends there).
const SOUTH_LIMIT = -85;

// Map style: as the results map, but white land, so that the sand grey of «cooler and drier»
// does not look like the map's own (uncoloured) land.
const DETAIL_MAP = [
  ...MIDDLE_MAP.filter(style => style.featureType !== "landscape"),
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#ffffff" }] }
];

// West edges of the three map pieces of 120° (see drawDetailMap).
const PIECE_WEST_EDGES = [-170, -50, 70];
const PIECE_DEGREES = 120;

// Overlap of neighbouring pieces (cells of 16 km; 4 cells are about 1.5 pixels at zoom 2) and
// the transparency of each piece there: with the overlay opacity o = 0.85, two layers of
// alpha a cover 1 - (1 - o a)^2, which equals o for a = (1 - sqrt(1 - o)) / o = 0.72.
const OVERLAY_OPACITY = 0.85;
const OVERLAP_CELLS = 4;
const OVERLAP_ALPHA = Math.round(255 * (1 - Math.sqrt(1 - OVERLAY_OPACITY)) / OVERLAY_OPACITY);

let detailMap = null;            // made once, reused
let mapObjects = [];             // overlays and markers of the last detail map
let panorama = null;             // the Street View panorama that is open, if any
let climateGrid = null;          // { index, t, p }: decoded once per visit


// Fill and show the detail screen. game is null when the game was skipped (then only the map).
export async function showDetailScreen(place, game) {
  document.getElementById("detail-place").textContent = withElevation(place.phrase, place.cell.elevation);
  document.getElementById("detail-map-intro").textContent = t("detail_map_intro", { home: place.phrase });
  fillLegend(place, game);
  closePanorama();
  const regions = await loadRegions();
  fillRounds(place, game, regions);

  const status = document.getElementById("detail-map-status");
  status.textContent = t("detail_map_loading");
  try {
    await loadGoogleMaps();
    await drawDetailMap(place, game);
    status.textContent = "";
  } catch (error) {
    console.error(error);
    status.textContent = t("results_map_error");
  }
}


// ---------------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------------

function fillLegend(place, game) {
  const list = document.getElementById("detail-legend");
  list.replaceChildren();
  for (const name of LEGEND_ORDER) {
    const item = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = "rgb(" + CLASS_COLOURS[name].join(",") + ")";
    const label = document.createElement("span");
    label.textContent = t("detail_class_" + name, { home: place.phrase });
    item.append(swatch, label);
    list.append(item);
  }
  // Image locations and guesses (as on the results map), numbered by round; not when the
  // game was skipped.
  if (game === null) return;
  const markers = document.createElement("li");
  markers.className = "legend-markers";
  markers.innerHTML = '<span class="dot" style="background:#1a9850"></span><span></span>' +
                      '<span class="dot" style="background:#6b6b6b"></span><span></span>';
  markers.children[1].textContent = t("detail_legend_images");
  markers.children[3].textContent = t("detail_legend_guesses");
  list.append(markers);
}


// ---------------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------------

async function drawDetailMap(place, game) {
  const box = document.getElementById("detail-map");
  if (detailMap === null) {
    detailMap = new google.maps.Map(box, {
      center: { lat: 25, lng: 10 }, zoom: 1,
      streetViewControl: false, mapTypeControl: false, clickableIcons: false, fullscreenControl: false,
      gestureHandling: "cooperative",
      styles: DETAIL_MAP
    });
  }
  // The map box was hidden until now: tell Google its size, then set the view (as the
  // reveal map of play.js, where a map in a box that was hidden sometimes stayed grey). A
  // timeout instead of requestAnimationFrame, which does not fire while the page is not drawn.
  await new Promise(resolve => setTimeout(resolve, 0));
  google.maps.event.trigger(detailMap, "resize");
  detailMap.setCenter({ lat: 25, lng: 10 });
  detailMap.setZoom(window.innerWidth < 700 ? 1 : 2);
  for (const object of mapObjects) object.setMap(null);
  mapObjects = [];

  // The five classes as three image overlays of 120° each. Google cannot stretch one image over
  // the whole 360°, and an image whose edge lies at ±180° was drawn one world further east,
  // outside the view (test 2026-11-03); so the edges are at 170° W, 50° W and 70° E, and the
  // third piece crosses the date line (west 70°, east -170°), which Google handles.
  const bundleNumber = place.cell.bundle;
  const bundle = await fetchProduct("bundles/bundle_" + String(bundleNumber).padStart(5, "0") + ".json");
  const grid = await loadClimateGrid();
  const analogue = await analogueCells(grid.index, bundle);
  for (const westEdge of PIECE_WEST_EDGES) {
    const image = classImage(grid, analogue, place.cell, westEdge);
    mapObjects.push(new google.maps.GroundOverlay(image.url, image.bounds,
                                                  { map: detailMap, clickable: false, opacity: OVERLAY_OPACITY }));
  }

  // The place itself, the image locations (green) and the guesses (grey), numbered by round.
  mapObjects.push(new google.maps.Marker({ position: { lat: place.lat, lng: place.lon }, map: detailMap,
    title: place.name, label: { text: "★", color: "white" }, zIndex: 30 }));
  if (game === null) return;
  game.results.forEach((result, k) => {
    const truth = { lat: result.pano.lat, lng: result.pano.lon };
    const guess = { lat: result.guess.lat, lng: result.guess.lon };
    const label = String(k + 1);
    mapObjects.push(new google.maps.Marker({ position: truth, map: detailMap, icon: numberIcon("#1a9850"),
      label: { text: label, color: "white", fontSize: "11px", fontWeight: "700" }, zIndex: 20 }));
    mapObjects.push(new google.maps.Marker({ position: guess, map: detailMap, icon: numberIcon("#6b6b6b"),
      label: { text: label, color: "white", fontSize: "11px", fontWeight: "700" },
      title: t("results_your_guess"), zIndex: 20 }));
    mapObjects.push(new google.maps.Polyline({ path: [guess, truth], geodesic: true, map: detailMap,
      strokeColor: "#333", strokeOpacity: 0.7, strokeWeight: 2, zIndex: 10 }));
  });
}

// Zoom the map to one round (image location and guess).
function showRoundOnMap(result) {
  if (detailMap === null) return;
  const bounds = new google.maps.LatLngBounds();
  bounds.extend({ lat: result.pano.lat, lng: result.pano.lon });
  bounds.extend({ lat: result.guess.lat, lng: result.guess.lon });
  detailMap.fitBounds(bounds, 60);
  document.getElementById("detail-map").scrollIntoView({ behavior: "smooth", block: "center" });
}

function numberIcon(colour) {
  return { path: google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: colour, fillOpacity: 1,
           strokeColor: "white", strokeWeight: 2 };
}


// ---------------------------------------------------------------------------------
// Data of the map (script 43)
// ---------------------------------------------------------------------------------

// Mean T and mean P of every 16 km cell, decoded from the two PNGs (value = red * 256 + green,
// 0 = no data). Returns { index, t: Float32Array, p: Float32Array } with NaN where no data.
async function loadClimateGrid() {
  if (climateGrid !== null) return climateGrid;
  const index = await fetchProduct("detail/index.json");
  const [tPixels, pPixels] = await Promise.all([imagePixels(PRODUCTS + "detail/" + index.t.file),
                                                imagePixels(PRODUCTS + "detail/" + index.p.file)]);
  const cells = index.rows * index.columns;
  const meanT = new Float32Array(cells);
  const meanP = new Float32Array(cells);
  for (let cell = 0; cell < cells; cell++) {
    const tValue = tPixels.data[cell * 4] * 256 + tPixels.data[cell * 4 + 1];
    const pValue = pPixels.data[cell * 4] * 256 + pPixels.data[cell * 4 + 1];
    meanT[cell] = tValue === 0 ? NaN : tValue / index.t.scale - index.t.offset;
    meanP[cell] = pValue === 0 ? NaN : pValue - index.p.offset;
  }
  climateGrid = { index: index, t: meanT, p: meanP };
  return climateGrid;
}

// The 16 km cells with analogue area (Uint8Array, 1 = analogue): outside the tropics every
// cell that contains a non-transparent pixel of the bundle's world images (8 km blocks of
// script 23), in the tropics the cells of detail/tropics/bundle_<n>.json.
async function analogueCells(index, bundle) {
  const analogue = new Uint8Array(index.rows * index.columns);
  for (const image of [bundle.images.west, bundle.images.east]) {
    const pixels = await imagePixels(PRODUCTS + "maps/" + image.file);
    const lonStep = (image.east - image.west) / pixels.width;
    const latStep = (image.north - image.south) / pixels.height;
    for (let y = 0; y < pixels.height; y++) {
      const lat = image.north - (y + 0.5) * latStep;
      const row = Math.floor((index.north - lat) / index.resolution);
      if (row < 0 || row >= index.rows) continue;
      for (let x = 0; x < pixels.width; x++) {
        if (pixels.data[(y * pixels.width + x) * 4 + 3] === 0) continue;   // transparent: not analogue
        const lon = image.west + (x + 0.5) * lonStep;
        const column = Math.min(Math.floor((lon - index.west) / index.resolution), index.columns - 1);
        analogue[row * index.columns + column] = 1;
      }
    }
  }

  // Tropics: runs of cells as [gap, length, gap, length, ...] (script 43).
  const tropics = await fetchProduct("detail/tropics/bundle_" + String(bundle.bundle).padStart(5, "0") + ".json");
  let cell = 0;
  for (let k = 0; k < tropics.runs.length; k += 2) {
    cell += tropics.runs[k];
    for (let n = 0; n < tropics.runs[k + 1]; n++) analogue[cell + n] = 1;
    cell += tropics.runs[k + 1];
  }
  return analogue;
}

// One piece of the world (120° from westEdge eastwards, across the date line if needed) as
// an image: each 16 km cell gets the colour of its class compared with the place's summer 2026
// (the cell's numbers, as the sentences of the rounds), land only (sea transparent).
// Returns { url, bounds } for a Google GroundOverlay.
function classImage(grid, analogue, cell, westEdge) {
  const index = grid.index;
  // The pieces overlap by a few cells: Google rounds the position of each image on its own,
  // and without the overlap a thin white line showed between the pieces (user, 2026-11-03;
  // 0.3 pixels at zoom 2 with one cell of overlap). In the overlap both pieces are drawn
  // half transparent (OVERLAP_ALPHA), so that together they cover as much as one piece and the
  // strip does not look darker.
  const baseColumns = Math.round(PIECE_DEGREES / index.resolution);
  const pieceColumns = baseColumns + OVERLAP_CELLS;
  const firstColumn = Math.round((westEdge - index.west) / index.resolution);
  const rows = Math.floor((index.north - SOUTH_LIMIT) / index.resolution);

  const canvas = document.createElement("canvas");
  canvas.width = pieceColumns;
  canvas.height = rows;
  const context = canvas.getContext("2d");
  const image = context.createImageData(pieceColumns, rows);
  for (let row = 0; row < rows; row++) {
    for (let x = 0; x < pieceColumns; x++) {
      const column = (firstColumn + x) % index.columns;      // past 180° E: on from 180° W
      const gridCell = row * index.columns + column;
      const meanT = grid.t[gridCell];
      if (Number.isNaN(meanT)) continue;                  // sea: stays transparent
      let colour;
      if (analogue[gridCell] === 1) {
        colour = CLASS_COLOURS.analogue;
      } else {
        const warmer = meanT > cell.t_2026;
        const wetter = grid.p[gridCell] > cell.p_2026;
        if (warmer) colour = wetter ? CLASS_COLOURS.warmerWetter : CLASS_COLOURS.warmerDrier;
        else colour = wetter ? CLASS_COLOURS.coolerWetter : CLASS_COLOURS.coolerDrier;
      }
      const pixel = (row * pieceColumns + x) * 4;
      image.data[pixel] = colour[0];
      image.data[pixel + 1] = colour[1];
      image.data[pixel + 2] = colour[2];
      const inOverlap = x < OVERLAP_CELLS || x >= baseColumns;
      image.data[pixel + 3] = inOverlap ? OVERLAP_ALPHA : 255;
    }
  }
  context.putImageData(image, 0, 0);
  // Edges of the cells actually drawn (the grid starts at 180.0001° W), as longitudes
  // between -180 and 180.
  const west = index.west + firstColumn * index.resolution;
  let east = west + pieceColumns * index.resolution;
  if (east > 180) east -= 360;
  return {
    url: canvas.toDataURL("image/png"),
    bounds: { north: index.north, south: index.north - rows * index.resolution, west: west, east: east }
  };
}


// ---------------------------------------------------------------------------------
// The five rounds
// ---------------------------------------------------------------------------------

function fillRounds(place, game, regions) {
  const box = document.getElementById("detail-rounds-box");
  const list = document.getElementById("detail-rounds");
  list.replaceChildren();
  box.hidden = game === null;
  if (game === null) return;

  game.results.forEach((result, k) => {
    const item = document.createElement("li");
    item.className = "detail-round";

    const title = document.createElement("p");
    title.className = "round-title";
    title.textContent = t("detail_round_title", { round: k + 1, region: regionName(regions, result.pano.region_id) });

    const points = document.createElement("p");
    points.className = "round-points";
    points.textContent = t("detail_round_points", {
      km: formatNumber(result.distance), points: formatNumber(result.points),
      climate: formatNumber(result.climate.points), date: formatDate(result.pano.date)
    });

    const climate = document.createElement("p");
    climate.className = "round-climate";
    const guessRegion = result.guessRegionId === undefined || result.guessRegionId === null
      ? null : regionName(regions, result.guessRegionId);
    climate.textContent = climateSentence(result.climate, place, guessRegion);

    const actions = document.createElement("p");
    actions.className = "round-actions";
    const mapButton = smallButton(t("detail_show_on_map"), () => showRoundOnMap(result));
    const panoramaBox = document.createElement("div");
    panoramaBox.className = "round-panorama";
    panoramaBox.hidden = true;
    const panoramaButton = smallButton(t("detail_show_panorama"), () => togglePanorama(result, panoramaBox, panoramaButton));
    actions.append(mapButton, panoramaButton);

    item.append(title, points, climate, actions, panoramaBox);
    list.append(item);
  });
}

// One panorama at a time: a tap opens it below its round (and closes any other), a second tap
// closes it. Each opening is one Street View load (Google quota).
async function togglePanorama(result, box, button) {
  const wasOpen = !box.hidden;
  closePanorama();
  if (wasOpen) return;
  box.hidden = false;
  button.textContent = t("detail_hide_panorama");
  await loadGoogleMaps();
  panorama = {
    box: box, button: button,
    view: new google.maps.StreetViewPanorama(box, {
      pano: result.pano.pano_id, addressControl: false, fullscreenControl: false,
      motionTracking: false, motionTrackingControl: false, showRoadLabels: false
    })
  };
}

function closePanorama() {
  if (panorama === null) return;
  panorama.view.setVisible(false);
  panorama.box.replaceChildren();
  panorama.box.hidden = true;
  panorama.button.textContent = t("detail_show_panorama");
  panorama = null;
}

function smallButton(text, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "small-button";
  button.textContent = text;
  button.addEventListener("click", onClick);
  return button;
}


// ---------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------

function regionName(regions, regionId) {
  const region = regions.get(regionId);
  if (region === undefined) return "?";
  return region.name === region.country ? region.name : region.name + ", " + region.country;
}

// "2025-07" -> "Juli 2025"
function formatDate(date) {
  const [year, month] = String(date).split("-");
  if (!month) return year;
  return t("month_" + Number(month)) + " " + year;
}

function formatNumber(value) {
  return Math.round(value).toLocaleString("de-CH");
}

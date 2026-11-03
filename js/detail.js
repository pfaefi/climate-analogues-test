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
import { imagePixels, MIDDLE_MAP, makeEnlargeButton, enlargeMap } from "./results.js";
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

// Map style: as the results map, but white land, so that the sand grey of «cooler and drier»
// does not look like the map's own (uncoloured) land.
const DETAIL_MAP = [
  ...MIDDLE_MAP.filter(style => style.featureType !== "landscape"),
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#ffffff" }] }
];

// Transparency of the colours, so that borders and labels of the map still show faintly.
const OVERLAY_ALPHA = Math.round(255 * 0.85);
// Class numbers in the class grid (0 = sea or no data).
const CLASS_NUMBERS = { analogue: 1, warmerWetter: 2, warmerDrier: 3, coolerWetter: 4, coolerDrier: 5 };

let detailMap = null;            // made once, reused
let mapObjects = [];             // markers and lines of the last detail map
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
    // «Karte vergrössern» as on the results map (user, 2026-11-03).
    detailMap.controls[google.maps.ControlPosition.TOP_RIGHT].push(makeEnlargeButton(box));
  }
  enlargeMap(box, false);
  // The map box was hidden until now: tell Google its size, then set the view (as the
  // reveal map of play.js, where a map in a box that was hidden sometimes stayed grey). A
  // timeout instead of requestAnimationFrame, which does not fire while the page is not drawn.
  await new Promise(resolve => setTimeout(resolve, 0));
  google.maps.event.trigger(detailMap, "resize");
  detailMap.setCenter({ lat: 25, lng: 10 });
  detailMap.setZoom(window.innerWidth < 700 ? 1 : 2);
  for (const object of mapObjects) object.setMap(null);
  mapObjects = [];

  // The five classes as map tiles that are coloured in the browser (ClassTiles below). Before,
  // the classes were three image overlays of 120°; Google sometimes drew one of them in the
  // wrong copy of the world, so that a part of the map stayed white until it was moved, and a
  // thin line showed between the pieces (user, 2026-11-03). Tiles are drawn by Google for
  // exactly the part of the map that is visible.
  const bundleNumber = place.cell.bundle;
  const bundle = await fetchProduct("bundles/bundle_" + String(bundleNumber).padStart(5, "0") + ".json");
  const grid = await loadClimateGrid();
  const analogue = await analogueCells(grid.index, bundle);
  const classes = classGrid(grid, analogue, place.cell);
  detailMap.overlayMapTypes.clear();
  detailMap.overlayMapTypes.push(new ClassTiles(grid.index, classes));

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
  const box = document.getElementById("detail-map");
  if (box.classList.contains("enlarged")) return;     // already fills the window
  box.scrollIntoView({ behavior: "smooth", block: "center" });
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

// The class of every 16 km cell compared with the place's summer 2026 (the cell's numbers, as
// the sentences of the rounds): Uint8Array with the numbers of CLASS_NUMBERS, 0 = sea.
function classGrid(grid, analogue, cell) {
  const classes = new Uint8Array(grid.t.length);
  for (let gridCell = 0; gridCell < grid.t.length; gridCell++) {
    const meanT = grid.t[gridCell];
    if (Number.isNaN(meanT)) continue;                    // sea: stays 0
    if (analogue[gridCell] === 1) {
      classes[gridCell] = CLASS_NUMBERS.analogue;
      continue;
    }
    const warmer = meanT > cell.t_2026;
    const wetter = grid.p[gridCell] > cell.p_2026;
    if (warmer) classes[gridCell] = wetter ? CLASS_NUMBERS.warmerWetter : CLASS_NUMBERS.warmerDrier;
    else classes[gridCell] = wetter ? CLASS_NUMBERS.coolerWetter : CLASS_NUMBERS.coolerDrier;
  }
  return classes;
}

// Map tiles of 256 x 256 pixels for Google's overlayMapTypes. Google asks for the tiles that
// are visible (in every copy of the world), and each pixel gets the colour of the 16 km cell
// under it: the pixel's position in Google's map projection (Web Mercator) is turned into
// longitude and latitude, then into the row and column of the grid.
class ClassTiles {
  constructor(index, classes) {
    this.tileSize = new google.maps.Size(256, 256);
    this.index = index;
    this.classes = classes;
    // Colour of each class number as [red, green, blue].
    this.colours = [null];
    for (const name of Object.keys(CLASS_NUMBERS)) this.colours[CLASS_NUMBERS[name]] = CLASS_COLOURS[name];
  }

  getTile(coord, zoom, ownerDocument) {
    const index = this.index;
    const tiles = 2 ** zoom;                             // tiles across the world at this zoom
    const tileX = ((coord.x % tiles) + tiles) % tiles;   // copies of the world: same tile
    const worldPixels = 256 * tiles;

    // Grid column of each pixel column of the tile, and grid row of each pixel row (-1 =
    // outside the grid).
    const columns = new Int32Array(256);
    for (let x = 0; x < 256; x++) {
      const lon = (tileX * 256 + x + 0.5) / worldPixels * 360 - 180;
      const column = Math.floor((lon - index.west) / index.resolution);
      columns[x] = ((column % index.columns) + index.columns) % index.columns;
    }
    const rows = new Int32Array(256);
    for (let y = 0; y < 256; y++) {
      const mercatorY = Math.PI * (1 - 2 * (coord.y * 256 + y + 0.5) / worldPixels);
      const lat = Math.atan(Math.sinh(mercatorY)) * 180 / Math.PI;
      const row = Math.floor((index.north - lat) / index.resolution);
      rows[y] = row >= 0 && row < index.rows ? row : -1;
    }

    const canvas = ownerDocument.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    canvas.style.imageRendering = "pixelated";           // sharp cell edges when zoomed in
    if (coord.y < 0 || coord.y >= tiles) return canvas;  // above or below the world: empty
    const context = canvas.getContext("2d");
    const image = context.createImageData(256, 256);
    for (let y = 0; y < 256; y++) {
      if (rows[y] < 0) continue;
      const rowStart = rows[y] * index.columns;
      for (let x = 0; x < 256; x++) {
        const classNumber = this.classes[rowStart + columns[x]];
        if (classNumber === 0) continue;                 // sea: transparent
        const colour = this.colours[classNumber];
        const pixel = (y * 256 + x) * 4;
        image.data[pixel] = colour[0];
        image.data[pixel + 1] = colour[1];
        image.data[pixel + 2] = colour[2];
        image.data[pixel + 3] = OVERLAY_ALPHA;
      }
    }
    context.putImageData(image, 0, 0);
    return canvas;
  }

  releaseTile() {}
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

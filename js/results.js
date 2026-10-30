// Results screen (app_plan.md §10, §11c; visualisation_literature.md §2-3): what the summer
// 2026 was like at the place (absolute values against the 1991-2020 normal, heat days), the
// points of the game, the world map with the analogue areas (where such a summer is normal
// today), the five image locations and the guesses, the nearest analogue region, the
// compound stripes 1961-2026, and a short explanation of what this means and what it does not.
// The map is a Google map (same as the play screen; our layers are image overlays in plain
// longitude / latitude, which Google stretches evenly, app_plan.md §7).

import { t, withElevation } from "./i18n.js";
import { loadGoogleMaps } from "./google.js";
import { loadBundle, loadRegions, loadStripes, isUrban } from "./data.js";
import { drawStripes } from "./stripes.js";
import { updateRecord } from "./memory.js";

const PRODUCTS = window.APP_SETTINGS.products;
let resultsMap = null;          // made once, reused
let mapObjects = [];            // overlays, markers and lines of the last results
let zoomListener = null;        // switches between dots (zoomed out) and areas (zoomed in)

// Fill and show the results of a place; game is null when the game was skipped.
export async function showResultsScreen(place, game) {
  const cell = place.cell;
  document.getElementById("results-place").textContent = withElevation(place.phrase, cell.elevation);
  fillNumbers(cell);
  document.getElementById("results-urban").hidden = !isUrban(cell);
  fillScore(game);
  document.getElementById("play-again").hidden = place.panoramas.length === 0;

  // The parts that need more data are filled when the data have arrived.
  const [regions, bundle, stripes] = await Promise.all([loadRegions(), loadBundle(cell.bundle),
                                                        loadStripes(cell).catch(() => null)]);
  fillNearest(cell, regions);
  fillStripes(place, stripes);
  try {
    await loadGoogleMaps();
    await drawMap(place, bundle, game);
  } catch (error) {
    console.error(error);
    document.getElementById("results-map").textContent = t("results_map_error");
  }
}


// ---------------------------------------------------------------------------------
// The summer 2026 at the place
// ---------------------------------------------------------------------------------

function fillNumbers(cell) {
  const box = document.getElementById("results-numbers");
  box.replaceChildren();
  addNumber(box, formatDecimal(cell.t_2026) + " °C", t("number_t", { normal: formatDecimal(cell.t_normal) }));
  addNumber(box, formatNumber(cell.p_2026) + " mm", t("number_p", { normal: formatNumber(cell.p_normal) }));
  // Heat days only where there are any (not in the high mountains).
  if (cell.heat_days_2026 >= 1) {
    addNumber(box, String(cell.heat_days_2026), t("number_heat_days", { normal: formatDecimal(cell.heat_days_normal) }));
  }
  // Tropical nights only where there were any in 2026 (most places have none).
  if (cell.tropical_nights_2026 >= 1) {
    addNumber(box, String(cell.tropical_nights_2026),
              t("number_tropical_nights", { normal: formatDecimal(cell.tropical_nights_normal) }));
  }
}

function addNumber(box, value, label) {
  const item = document.createElement("div");
  item.className = "number";
  const valueElement = document.createElement("span");
  valueElement.className = "number-value";
  valueElement.textContent = value;
  const labelElement = document.createElement("span");
  labelElement.className = "number-label";
  labelElement.textContent = label;
  item.append(valueElement, labelElement);
  box.append(item);
}

// Points of the game (distance and climate points) and the personal record on this device.
// The record is updated once per game (not again when the results are shown a second time).
function fillScore(game) {
  const score = document.getElementById("results-score");
  const record = document.getElementById("results-record");
  score.hidden = game === null;
  record.hidden = game === null;
  if (game === null) return;
  const geo = game.results.reduce((sum, r) => sum + r.points, 0);
  const climate = game.results.reduce((sum, r) => sum + r.climate.points, 0);
  const total = geo + climate;
  score.textContent = t("results_score", {
    points: formatNumber(total), max: formatNumber(2 * 5000 * game.results.length),
    geo: formatNumber(geo), climate: formatNumber(climate)
  });

  if (game.record === undefined) game.record = updateRecord(total, game.place.name);
  const previous = game.record.previous;
  record.hidden = previous === null;              // the first game on this device: no line
  if (previous === null) {
    record.textContent = "";
  } else if (game.record.isNew) {
    record.textContent = t("results_new_record") + " " + t("results_old_record", { points: formatNumber(previous.points) });
  } else {
    record.textContent = t("results_record", { points: formatNumber(previous.points), place: previous.place,
                                               date: formatDate(previous.date) });
  }
}

// "2026-10-30" -> "30.10.2026"
function formatDate(isoDate) {
  const [year, month, day] = isoDate.split("-");
  return Number(day) + "." + Number(month) + "." + year;
}

function fillNearest(cell, regions) {
  const sentence = document.getElementById("results-nearest");
  const region = regions.get(cell.nearest_region_id);
  if (cell.nearest_km === null || region === undefined) {
    sentence.textContent = "";
    return;
  }
  sentence.textContent = t("results_nearest", { region: regionName(region), km: formatNumber(cell.nearest_km) });
}

function fillStripes(place, stripes) {
  const box = document.getElementById("stripes-box");
  box.hidden = stripes === null;
  if (stripes === null) return;
  document.getElementById("stripes-title").textContent = t("stripes_title", {
    place: place.phrase, first: stripes.years[0], last: stripes.years[stripes.years.length - 1] });
  drawStripes(document.getElementById("stripes-chart"), stripes,
              { low: t("stripes_low"), high: t("stripes_high") });
}


// ---------------------------------------------------------------------------------
// World map: analogue areas, the place, image locations and guesses
// ---------------------------------------------------------------------------------

async function drawMap(place, bundle, game) {
  const narrow = window.innerWidth < 700;
  if (resultsMap === null) {
    resultsMap = new google.maps.Map(document.getElementById("results-map"), {
      streetViewControl: false, mapTypeControl: false, clickableIcons: false,
      // Our own «Karte vergrössern» instead of Google's full-screen button: after the browser's
      // full screen, the Street View of the next game was drawn small in a corner
      // (app_test_notes 29.10 point 6). Enlarging the map box with CSS avoids the full screen.
      fullscreenControl: false,
      gestureHandling: "cooperative",    // on phones: two fingers move the map, one scrolls the page
      styles: MIDDLE_MAP                 // grey land, blue water: the orange areas stand out
    });
    resultsMap.controls[google.maps.ControlPosition.TOP_RIGHT].push(makeEnlargeButton());
  }
  enlargeMap(false);
  resultsMap.setCenter({ lat: 25, lng: 10 });
  resultsMap.setZoom(narrow ? 1 : 2);
  for (const object of mapObjects) object.setMap(null);
  mapObjects = [];

  // Analogue areas: image overlays of script 23 (west and east half of the world; the
  // Swiss 1 km image only if the bundle has one). Shown only when zoomed in; zoomed out, the
  // same areas are shown as dots (app_test_notes 29.10 point 4: always dots or always areas,
  // not a mix).
  const images = [bundle.images.west, bundle.images.east];
  if (bundle.images.switzerland && bundle.images.switzerland.file) images.push(bundle.images.switzerland);
  const overlays = [];
  for (const image of images) {
    overlays.push(new google.maps.GroundOverlay(PRODUCTS + "maps/" + image.file,
      { north: image.north, south: image.south, east: image.east, west: image.west },
      { map: resultsMap, clickable: false }));
  }
  mapObjects.push(...overlays);

  // Dots: one per grid cell that contains analogue area, read from the same two world images
  // (each dot at the mean position of its analogue pixels, so on land). The grid cell is
  // larger when zoomed out, so that the dots keep about the same spacing on the screen
  // instead of merging into bands.
  const dotsByZoom = new Map();          // zoom -> markers
  const positions = await gridDots([bundle.images.west, bundle.images.east], [...DOT_CELL_KM.values()]);
  for (const [zoom, km] of DOT_CELL_KM) {
    const markers = positions.get(km).map(position => new google.maps.Marker({ position: position,
      map: resultsMap, visible: false, clickable: false, zIndex: 1,
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 3.5, fillColor: "#f16913", fillOpacity: 1,
              strokeColor: "#7a1f00", strokeWeight: 1.5 } }));
    dotsByZoom.set(zoom, markers);
    mapObjects.push(...markers);
  }

  // Zoomed out: dots only (of the grid for this zoom); zoomed in: areas only. The legend follows.
  const switchLayers = () => {
    const zoom = Math.max(resultsMap.getZoom(), Math.min(...DOT_CELL_KM.keys()));
    const zoomedOut = zoom <= DOTS_UP_TO_ZOOM;
    for (const [dotZoom, markers] of dotsByZoom) {
      for (const marker of markers) marker.setVisible(dotZoom === zoom);
    }
    for (const overlay of overlays) overlay.setMap(zoomedOut ? null : resultsMap);
    document.getElementById("legend-dots").hidden = !zoomedOut;
    document.getElementById("legend-areas").hidden = zoomedOut;
    if (zoomedOut) {
      document.getElementById("legend-dots-text").textContent = t("legend_dots", { km: DOT_CELL_KM.get(zoom) });
    }
  };
  if (zoomListener !== null) zoomListener.remove();
  zoomListener = resultsMap.addListener("zoom_changed", switchLayers);
  switchLayers();

  // The place itself.
  mapObjects.push(new google.maps.Marker({ position: { lat: place.lat, lng: place.lon }, map: resultsMap,
    title: place.name, label: { text: "★", color: "white" }, zIndex: 30 }));

  // The five image locations (green) and the guesses (?), each with a line; in front of the
  // dots of the analogue regions (zIndex), so that they are not hidden in a cloud of dots.
  if (game !== null) {
    for (const result of game.results) {
      const truth = { lat: result.pano.lat, lng: result.pano.lon };
      const guess = { lat: result.guess.lat, lng: result.guess.lon };
      mapObjects.push(new google.maps.Marker({ position: truth, map: resultsMap, icon: circleIcon("#1a9850"),
                                               zIndex: 20 }));
      mapObjects.push(new google.maps.Marker({ position: guess, map: resultsMap, icon: circleIcon("#6b6b6b"),
                                               title: t("results_your_guess"), zIndex: 20 }));
      mapObjects.push(new google.maps.Polyline({ path: [guess, truth], geodesic: true, map: resultsMap,
                                                 strokeColor: "#555", strokeOpacity: 0.7, strokeWeight: 2,
                                                 zIndex: 10 }));
    }
  }
  document.getElementById("legend-game").hidden = game === null;
}

// Up to this zoom the map shows dots, from the next one on the areas (at zoom 4 Europe about
// fills a wide screen).
const DOTS_UP_TO_ZOOM = 4;

// Grid cell of the dots per zoom (km). Each zoom step halves the km per screen pixel, so the
// cell halves too: the dots are always about 10 pixels apart (at zoom 4, 100 km are about
// 10 pixels in mid-latitudes). Zoom 1 is the world view on phones.
const DOT_CELL_KM = new Map([[1, 800], [2, 400], [3, 200], [4, 100]]);

// Dot positions from the world map images (indexed PNGs of script 23 in plain longitude /
// latitude; every pixel that is not transparent is analogue area), for several grid sizes
// at once. The grid has rows of `km` in latitude and, in each row, columns of `km` in
// longitude (wider in degrees towards the poles), so every dot stands for about the same
// area. Returns a Map km -> list of { lat, lng }, one per grid cell with analogue pixels, at
// the mean position of those pixels. Reading the two images (about 2700 x 2500 pixels each)
// takes some tens of milliseconds.
async function gridDots(images, cellKms) {
  const sums = new Map(cellKms.map(km => [km, new Map()]));   // km -> "row,column" -> { lat, lon, n }
  for (const image of images) {
    const pixels = await imagePixels(PRODUCTS + "maps/" + image.file);
    const lonStep = (image.east - image.west) / pixels.width;
    const latStep = (image.north - image.south) / pixels.height;
    for (let y = 0; y < pixels.height; y++) {
      const lat = image.north - (y + 0.5) * latStep;
      // Row and column width of this image row, for each grid size.
      const grids = cellKms.map(km => {
        const rowDegrees = km / 111.2;
        const row = Math.floor((lat + 90) / rowDegrees);
        const rowCentre = (row + 0.5) * rowDegrees - 90;
        const columnDegrees = rowDegrees / Math.max(Math.cos(rowCentre * Math.PI / 180), 0.05);
        return { cells: sums.get(km), row: row, columnDegrees: columnDegrees };
      });
      for (let x = 0; x < pixels.width; x++) {
        if (pixels.data[(y * pixels.width + x) * 4 + 3] === 0) continue;   // transparent
        const lon = image.west + (x + 0.5) * lonStep;
        for (const grid of grids) {
          const key = grid.row + "," + Math.floor((lon + 180) / grid.columnDegrees);
          const cell = grid.cells.get(key);
          if (cell === undefined) {
            grid.cells.set(key, { lat: lat, lon: lon, n: 1 });
          } else {
            cell.lat += lat;
            cell.lon += lon;
            cell.n += 1;
          }
        }
      }
    }
  }
  const result = new Map();
  for (const [km, cells] of sums) {
    result.set(km, [...cells.values()].map(cell => ({ lat: cell.lat / cell.n, lng: cell.lon / cell.n })));
  }
  return result;
}

// The RGBA pixels of an image (same origin, so the canvas may be read).
async function imagePixels(url) {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

// Google map style: grey land, pale water, light labels (no colours that compete with the
// orange analogue areas).
const GREY_MAP = [
  { stylers: [{ saturation: -100 }, { lightness: 15 }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#dfe5ea" }] },
  { featureType: "administrative.country", elementType: "geometry.stroke", stylers: [{ color: "#9a9a9a" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#6f6f6f" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] }
];

// Middle way (app_test_notes 29.10 point 3): light grey land without vegetation colours, but
// light blue water and clearer country borders, so that the map looks less washed out.
const MIDDLE_MAP = [
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#eeedea" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#bfd8ea" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#5d7f99" }] },
  { featureType: "administrative.country", elementType: "geometry.stroke", stylers: [{ color: "#7d7d7d" }] },
  { featureType: "administrative.province", elementType: "geometry.stroke", stylers: [{ color: "#c4c4c4" }] },
  { featureType: "road", stylers: [{ saturation: -100 }, { lightness: 30 }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#5f5f5f" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] }
];

// Button on the map that enlarges it to the whole window and back (Escape also shrinks it).
function makeEnlargeButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.id = "map-size-button";
  button.className = "map-size-button";
  button.textContent = t("map_enlarge");
  button.addEventListener("click", () => {
    enlargeMap(!document.getElementById("results-map").classList.contains("enlarged"));
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") enlargeMap(false);
  });
  return button;
}

function enlargeMap(enlarged) {
  document.getElementById("results-map").classList.toggle("enlarged", enlarged);
  document.body.classList.toggle("map-enlarged", enlarged);   // the page behind must not scroll
  const button = document.getElementById("map-size-button");
  if (button !== null) button.textContent = t(enlarged ? "map_shrink" : "map_enlarge");
}

function circleIcon(colour) {
  return { path: google.maps.SymbolPath.CIRCLE, scale: 6, fillColor: colour, fillOpacity: 1,
           strokeColor: "white", strokeWeight: 2 };
}


// ---------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------

function regionName(region) {
  return region.name === region.country ? region.name : region.name + " (" + region.country + ")";
}

function formatNumber(value) {
  return Math.round(value).toLocaleString("de-CH");
}

function formatDecimal(value) {
  return value.toLocaleString("de-CH", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

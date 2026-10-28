// Results screen (app_plan.md §10, §11c; visualisation_literature.md §2-3): what the summer
// 2026 was like at the place (absolute values against the 1991-2020 normal, heat days), the
// points of the game, the world map with the analogue areas (where such a summer is normal
// today), the five image locations and the guesses, the nearest analogue region, the
// compound stripes 1961-2026, and a short explanation of what this means and what it does not.
// The map is a Google map (same as the play screen; our layers are image overlays in plain
// longitude / latitude, which Google stretches evenly, app_plan.md §7).

import { t } from "./i18n.js";
import { loadGoogleMaps } from "./google.js";
import { loadBundle, loadRegions, loadStripes } from "./data.js";
import { drawStripes } from "./stripes.js";

const PRODUCTS = window.APP_SETTINGS.products;
let resultsMap = null;          // made once, reused
let mapObjects = [];            // overlays, markers and lines of the last results

// Fill and show the results of a place; game is null when the game was skipped.
export async function showResultsScreen(place, game) {
  const cell = place.cell;
  document.getElementById("results-place").textContent = place.name;
  fillNumbers(cell);
  fillScore(game);
  document.getElementById("play-again").hidden = place.panoramas.length === 0;

  // The parts that need more data are filled when the data have arrived.
  const [regions, bundle, stripes] = await Promise.all([loadRegions(), loadBundle(cell.bundle),
                                                        loadStripes(cell).catch(() => null)]);
  fillNearest(cell, regions);
  fillStripes(place, stripes);
  try {
    await loadGoogleMaps();
    drawMap(place, bundle, game);
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

function fillScore(game) {
  const score = document.getElementById("results-score");
  score.hidden = game === null;
  if (game === null) return;
  const total = game.results.reduce((sum, r) => sum + r.points, 0);
  score.textContent = t("results_score", { points: formatNumber(total), max: formatNumber(5000 * game.results.length) });
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
    place: place.name, first: stripes.years[0], last: stripes.years[stripes.years.length - 1] });
  drawStripes(document.getElementById("stripes-chart"), stripes,
              { low: t("stripes_low"), high: t("stripes_high") });
}


// ---------------------------------------------------------------------------------
// World map: analogue areas, the place, image locations and guesses
// ---------------------------------------------------------------------------------

function drawMap(place, bundle, game) {
  const narrow = window.innerWidth < 700;
  if (resultsMap === null) {
    resultsMap = new google.maps.Map(document.getElementById("results-map"), {
      streetViewControl: false, mapTypeControl: false, fullscreenControl: true, clickableIcons: false,
      gestureHandling: "cooperative"     // on phones: two fingers move the map, one scrolls the page
    });
  }
  resultsMap.setCenter({ lat: 25, lng: 10 });
  resultsMap.setZoom(narrow ? 1 : 2);
  for (const object of mapObjects) object.setMap(null);
  mapObjects = [];

  // Analogue areas: image overlays of script 23 (west and east half of the world; the
  // Swiss 1 km image only if the bundle has one).
  const images = [bundle.images.west, bundle.images.east];
  if (bundle.images.switzerland && bundle.images.switzerland.file) images.push(bundle.images.switzerland);
  for (const image of images) {
    mapObjects.push(new google.maps.GroundOverlay(PRODUCTS + "maps/" + image.file,
      { north: image.north, south: image.south, east: image.east, west: image.west },
      { map: resultsMap, clickable: false }));
  }

  // The place itself.
  mapObjects.push(new google.maps.Marker({ position: { lat: place.lat, lng: place.lon }, map: resultsMap,
    title: place.name, label: { text: "★", color: "white" } }));

  // The five image locations (green) and the guesses (?), each with a line.
  if (game !== null) {
    for (const result of game.results) {
      const truth = { lat: result.pano.lat, lng: result.pano.lon };
      const guess = { lat: result.guess.lat, lng: result.guess.lon };
      mapObjects.push(new google.maps.Marker({ position: truth, map: resultsMap, icon: circleIcon("#1a9850") }));
      mapObjects.push(new google.maps.Marker({ position: guess, map: resultsMap, icon: circleIcon("#6b6b6b"),
                                               title: t("results_your_guess") }));
      mapObjects.push(new google.maps.Polyline({ path: [guess, truth], geodesic: true, map: resultsMap,
                                                 strokeColor: "#555", strokeOpacity: 0.7, strokeWeight: 2 }));
    }
  }
  document.getElementById("legend-game").hidden = game === null;
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

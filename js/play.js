// Play screen (app_plan.md §7, §10): five rounds for the chosen place. Each round shows a
// Street View panorama from the place's analogue regions (where a summer like the place's
// 2026 is a normal summer); the player guesses the location on a world map.
// Points per round: 5,000 x exp(-distance / 2,000 km) (GeoGuessr-like, §7).
// Phone first: Street View fills the screen, the guess map opens as a panel from below;
// on wide screens the guess map stays small in the corner.
// All maps here are Google maps: Google's terms do not allow Street View next to another
// map provider (maps_and_imagery.md §4). Each map object is made once and reused, because
// every new map or panorama object counts as a (billed) load.

import { t } from "./i18n.js";
import { loadGoogleMaps } from "./google.js";
import { loadPool, loadRegions, loadBundle } from "./data.js";
import { sendEvent } from "./events.js";

const MAX_POINTS = 5000;
const SCALE_KM = 2000;

let game = null;           // the running game
let streetView = null;     // Google objects, made once
let guessMap = null;
let guessMarker = null;
let revealMap = null;
let revealObjects = [];    // markers and line of the last reveal (removed before the next)
let onFinished = null;
let buttonsReady = false;

// Start a game for the chosen place. finished(game) is called after the last round.
export async function startPlay(place, finished) {
  onFinished = finished;
  if (!buttonsReady) setUpButtons();
  showLoading(true);

  let google, pool, regions, bundle;
  try {
    [google, pool, regions, bundle] = await Promise.all(
      [loadGoogleMaps(), loadPool(), loadRegions(), loadBundle(place.cell.bundle)]);
  } catch (error) {
    console.error(error);
    document.getElementById("play-loading").textContent = t("play_error");
    return;
  }

  const panoramas = place.panoramas.map(position => pool(position));
  game = {
    place: place,
    regions: regions,
    bundle: bundle,
    rounds: choosePanoramas(panoramas, bundle.regions, window.APP_SETTINGS.rounds),
    roundIndex: 0,
    state: "guessing",      // "guessing" -> "revealed" -> next round; blocks double clicks
    results: []
  };
  // The drawn rounds in the browser console, so that a strange game can be checked later
  // (2026-10-27: a user saw three rounds from South Africa and the same image twice).
  console.info("Rounds drawn for " + place.name + " (bundle " + place.cell.bundle + "):\n" +
    game.rounds.map((p, k) => (k + 1) + ". " + regionName(p.region_id) + ", " + p.pano_id).join("\n"));
  showLoading(false);
  makeMaps();
  startRound();
  // For automatic tests in the browser only (settings.js: debug), never in normal use.
  if (window.APP_SETTINGS.debug) {
    window.appDebug = {
      game: () => game,
      guess: (lat, lon) => placeGuess(new google.maps.LatLng(lat, lon)),
      // A new draw of the rounds with the same rule, without playing them.
      draw: () => choosePanoramas(panoramas, bundle.regions, window.APP_SETTINGS.rounds)
    };
  }
}


// ---------------------------------------------------------------------------------
// Choice of the five panoramas
// ---------------------------------------------------------------------------------

// Rule of method_decision.md §9a: draw a region with probability proportional to the
// square root of its analogue area (only regions with at least one panorama), then a
// random panorama in it. Each region at most once per game, so that the rounds show
// different regions. Regions not in the bundle file (less than 25 km² of analogue area,
// data_and_tests.md §20) get the weight of 25 km².
function choosePanoramas(panoramas, regions, count) {
  const byRegion = new Map();
  for (const pano of panoramas) {
    if (!byRegion.has(pano.region_id)) byRegion.set(pano.region_id, []);
    byRegion.get(pano.region_id).push(pano);
  }
  const areaOf = new Map(regions.map(r => [r.region_id, r.area_km2]));
  let candidates = [...byRegion.keys()].map(id => ({ id: id, weight: Math.sqrt(areaOf.get(id) || 25) }));

  const chosen = [];
  while (chosen.length < count && candidates.length > 0) {
    const region = weightedPick(candidates);
    const options = byRegion.get(region.id);
    chosen.push(options[Math.floor(Math.random() * options.length)]);
    candidates = candidates.filter(c => c.id !== region.id);
  }
  return chosen;
}

function weightedPick(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}


// ---------------------------------------------------------------------------------
// Maps (made once per visit, reused in every round and game)
// ---------------------------------------------------------------------------------

function makeMaps() {
  if (streetView !== null) return;
  // Street View: look around only (no walking to the next village sign), no address,
  // no road names (app_plan.md §7).
  streetView = new google.maps.StreetViewPanorama(document.getElementById("street-view"), {
    addressControl: false, showRoadLabels: false, linksControl: false, clickToGo: false,
    fullscreenControl: false, motionTracking: false, motionTrackingControl: false,
    enableCloseButton: false, panControl: false
  });
  guessMap = new google.maps.Map(document.getElementById("guess-map"), {
    center: { lat: 30, lng: 10 }, zoom: 1, minZoom: 1, streetViewControl: false,
    mapTypeControl: false, fullscreenControl: false, clickableIcons: false,
    draggableCursor: "crosshair", gestureHandling: "greedy"   // one finger moves the map on phones
  });
  guessMap.addListener("click", event => placeGuess(event.latLng));
  // Check that Street View really shows the drawn panorama; if Google shows another one
  // (or keeps the previous one), set it again, at most twice per round.
  streetView.addListener("pano_changed", () => {
    if (game === null || game.state !== "guessing") return;
    const expected = game.rounds[game.roundIndex].pano_id;
    const shown = streetView.getPano();
    if (shown !== expected && game.panoRetries < 2) {
      console.warn("Street View shows " + shown + " instead of " + expected + "; set again");
      game.panoRetries += 1;
      streetView.setPano(expected);
    }
  });
  revealMap = new google.maps.Map(document.getElementById("reveal-map"), {
    streetViewControl: false, mapTypeControl: false, fullscreenControl: false,
    clickableIcons: false, gestureHandling: "greedy"
  });
}


// ---------------------------------------------------------------------------------
// One round: Street View + guess map
// ---------------------------------------------------------------------------------

function startRound() {
  const pano = game.rounds[game.roundIndex];
  document.getElementById("play-round").textContent =
    t("play_round", { round: game.roundIndex + 1, rounds: game.rounds.length });
  document.getElementById("play-score").textContent = pointsText(totalPoints());
  document.getElementById("reveal-panel").hidden = true;

  game.panoRetries = 0;
  streetView.setPano(pano.pano_id);
  streetView.setPov({ heading: Math.random() * 360, pitch: 0 });
  streetView.setZoom(0);

  guessMap.setCenter({ lat: 30, lng: 10 });
  guessMap.setZoom(1);
  if (guessMarker !== null) guessMarker.setMap(null);
  guessMarker = null;
  const button = document.getElementById("guess-button");
  button.disabled = true;
  button.textContent = t("guess_choose");
  openGuessPanel(false);
}

function placeGuess(latLng) {
  if (guessMarker === null) {
    guessMarker = new google.maps.Marker({ position: latLng, map: guessMap });
  } else {
    guessMarker.setPosition(latLng);
  }
  const button = document.getElementById("guess-button");
  button.disabled = false;
  button.textContent = t("guess_confirm");
}

function confirmGuess() {
  if (guessMarker === null || game.state !== "guessing") return;   // e.g. a double tap
  game.state = "revealed";
  const pano = game.rounds[game.roundIndex];
  const guess = guessMarker.getPosition();
  const distance = distanceKm(guess.lat(), guess.lng(), pano.lat, pano.lon);
  const points = Math.round(MAX_POINTS * Math.exp(-distance / SCALE_KM));
  const result = { pano: pano, guess: { lat: guess.lat(), lon: guess.lng() }, distance: distance, points: points };
  game.results.push(result);
  // For a possible analysis of what people think the analogues are (§10 point 5): the
  // guess rounded to 0.1 degree, the panorama and the distance; nothing about the person.
  sendEvent("guess_made", {
    bundle: game.place.cell.bundle, round: game.roundIndex + 1, pano_id: pano.pano_id, region_id: pano.region_id,
    guess_lat: Math.round(guess.lat() * 10) / 10, guess_lon: Math.round(guess.lng() * 10) / 10,
    distance_km: Math.round(distance), points: points
  });
  openGuessPanel(false);
  showReveal(result);
}

// Great-circle distance in km (haversine formula, as great_circle_km() in R/analogues.R).
function distanceKm(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(Math.min(1, a)));
}


// ---------------------------------------------------------------------------------
// Result of a round
// ---------------------------------------------------------------------------------

function showReveal(result) {
  document.getElementById("reveal-panel").hidden = false;
  for (const object of revealObjects) object.setMap(null);
  const truth = { lat: result.pano.lat, lng: result.pano.lon };
  const guess = { lat: result.guess.lat, lng: result.guess.lon };
  revealObjects = [
    new google.maps.Marker({ position: guess, map: revealMap, label: "?" }),
    new google.maps.Marker({ position: truth, map: revealMap, icon: truthIcon() }),
    new google.maps.Polyline({ path: [guess, truth], geodesic: true, map: revealMap,
                               strokeColor: "#b5400a", strokeWeight: 3 })
  ];
  const bounds = new google.maps.LatLngBounds();
  bounds.extend(guess);
  bounds.extend(truth);
  revealMap.fitBounds(bounds, 50);

  document.getElementById("reveal-distance").textContent =
    t("reveal_distance", { km: formatNumber(Math.round(result.distance)), points: pointsText(result.points) });
  document.getElementById("reveal-place").textContent = t("reveal_place", {
    place: regionName(result.pano.region_id), date: formatDate(result.pano.date), home: game.place.name
  });
  document.getElementById("play-score").textContent = pointsText(totalPoints());
  const last = game.roundIndex + 1 === game.rounds.length;
  document.getElementById("next-button").textContent = last ? t("to_results") : t("next_round");
}

function nextRound() {
  if (game.state !== "revealed") return;                             // e.g. a double tap
  game.state = "guessing";
  game.roundIndex += 1;
  if (game.roundIndex < game.rounds.length) {
    startRound();
  } else {
    sendEvent("game_finished", { bundle: game.place.cell.bundle, points: totalPoints() });
    onFinished(game);
  }
}

function truthIcon() {
  return { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: "#1a9850", fillOpacity: 1,
           strokeColor: "white", strokeWeight: 2 };
}


// ---------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------

// "Ohio, Vereinigte Staaten" from the region table (names in the language of the app).
function regionName(regionId) {
  const region = game.regions.get(regionId);
  if (region === undefined) return "?";
  return region.name === region.country ? region.name : region.name + ", " + region.country;
}

// "2025-07" -> "Juli 2025" (month names from the language file).
function formatDate(date) {
  const [year, month] = String(date).split("-");
  if (!month) return year;
  return t("month_" + Number(month)) + " " + year;
}

function formatNumber(value) {
  return value.toLocaleString("de-CH");
}

// "1 Punkt", "1'237 Punkte"
function pointsText(points) {
  return points === 1 ? t("points_one") : t("points_many", { points: formatNumber(points) });
}

function totalPoints() {
  return game.results.reduce((sum, r) => sum + r.points, 0);
}

function showLoading(loading) {
  const message = document.getElementById("play-loading");
  message.hidden = !loading;
  message.textContent = t("play_loading");
}

// On phones the guess map is a panel that opens from below; on wide screens it is always
// shown (the CSS decides; the class only matters on narrow screens).
function openGuessPanel(open) {
  document.getElementById("guess-panel").classList.toggle("open", open);
  // Google maps need to be told when their box changed size.
  if (open && guessMap !== null) google.maps.event.trigger(guessMap, "resize");
}

function setUpButtons() {
  buttonsReady = true;
  document.getElementById("guess-open").addEventListener("click", () => openGuessPanel(true));
  document.getElementById("guess-close").addEventListener("click", () => openGuessPanel(false));
  document.getElementById("guess-button").addEventListener("click", confirmGuess);
  document.getElementById("next-button").addEventListener("click", nextRound);
}

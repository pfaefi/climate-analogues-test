// Start screen (app_plan.md §10): short introduction, choose a place by typing (place
// search of geo.admin.ch) or by tapping on the swisstopo map, then play or skip the game.

import { t, withElevation } from "./i18n.js";
import { loadCell, loadBundlePanoramas, isUrban } from "./data.js";
import { sendEvent } from "./events.js";

const SEARCH_URL = "https://api3.geo.admin.ch/rest/services/api/SearchServer";
const IDENTIFY_URL = "https://api3.geo.admin.ch/rest/services/api/MapServer/identify";
// National map of swisstopo in Web Mercator (free; credit "©swisstopo", checked 2026-10-27).
const TILE_URL = "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg";

let map = null;
let marker = null;
let choice = null;          // the chosen place: { name, lon, lat, cell, panoramas }
let choiceNumber = 0;       // ignores answers that arrive after a newer choice
let onPlay = null;
let onSkip = null;

// Set up the start screen once. play / skip: functions called with the chosen place.
export function initStart(play, skip) {
  onPlay = play;
  onSkip = skip;
  initMap();
  initSearch();
  document.getElementById("play-button").addEventListener("click", () => onPlay(choice));
  document.getElementById("skip-link").addEventListener("click", event => {
    event.preventDefault();
    onSkip(choice);
  });
}

// Leaflet needs to know when its box has become visible again (e.g. back from another screen).
export function refreshStartMap() {
  if (map !== null) map.invalidateSize();
}


// ---------------------------------------------------------------------------------
// Map: tap to choose a point
// ---------------------------------------------------------------------------------

function initMap() {
  map = L.map("start-map", {
    center: [46.8, 8.23], zoom: 7, minZoom: 7, maxZoom: 15,
    maxBounds: [[45.4, 5.4], [48.2, 11.0]], maxBoundsViscosity: 0.8
  });
  map.attributionControl.setPrefix(false);
  L.tileLayer(TILE_URL, { attribution: "©swisstopo", maxZoom: 15 }).addTo(map);

  map.on("click", async event => {
    const lat = event.latlng.lat;
    const lon = event.latlng.lng;
    const name = await municipalityAt(lon, lat);
    choosePlace(name, lon, lat, "map");
  });
}

// Name of the municipality at a point (current boundaries of swissBOUNDARIES3D), or null.
async function municipalityAt(lon, lat) {
  const url = IDENTIFY_URL + "?geometryType=esriGeometryPoint&sr=4326&tolerance=0&returnGeometry=false"
    + "&layers=all:ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill&geometry=" + lon + "," + lat;
  try {
    const answer = await (await fetch(url)).json();
    // The layer also contains historic boundaries; only the current one counts.
    const current = answer.results.find(r => r.attributes.is_current_jahr);
    if (current === undefined) return null;
    return current.attributes.gemname + " (" + current.attributes.kanton + ")";
  } catch (error) {
    return null;
  }
}


// ---------------------------------------------------------------------------------
// Search field: suggestions while typing
// ---------------------------------------------------------------------------------

function initSearch() {
  const input = document.getElementById("search-input");
  const list = document.getElementById("search-results");
  let timer = null;
  let searchNumber = 0;

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const text = input.value.trim();
    if (text.length < 2) { list.replaceChildren(); return; }
    // Wait until typing pauses, so that not every key press sends a request.
    timer = setTimeout(async () => {
      const thisSearch = ++searchNumber;
      const results = await searchPlaces(text);
      if (thisSearch !== searchNumber) return;        // a newer search is under way
      showSuggestions(results, list, input);
    }, 250);
  });
}

// Kinds of named places of the swisstopo gazetteer that make sense as a place to choose
// (settlements, peaks and passes, glaciers and terrain, areas). Others (buildings, roads,
// motorway exits, cable cars, sports grounds) are left out.
const PLACE_CLASSES = ["TLM_SIEDLUNGSNAME", "TLM_NAME_PKT", "TLM_GELAENDENAME", "TLM_GEBIETSNAME"];
const MAX_SUGGESTIONS = 8;

// Municipalities (gg25) and named places (gazetteer) of geo.admin.ch.
async function searchPlaces(text) {
  const url = SEARCH_URL + "?type=locations&origins=gg25,gazetteer&limit=30&sr=4326&lang="
    + window.APP_SETTINGS.language + "&searchText=" + encodeURIComponent(text);
  let answer;
  try {
    answer = await (await fetch(url)).json();
  } catch (error) {
    return null;
  }
  // 1. The useful results, each name once.
  const places = [];
  for (const r of answer.results) {
    const keep = r.attrs.origin === "gg25" || PLACE_CLASSES.includes(r.attrs.objectclass);
    if (!keep) continue;
    const label = readLabel(r.attrs.label);
    const place = {
      name: label.name, kind: label.kind, municipality: label.municipality,
      lon: r.attrs.lon, lat: r.attrs.lat,
      municipalityOnly: r.attrs.origin === "gg25",
      settlement: r.attrs.objectclass === "TLM_SIEDLUNGSNAME",
      // Municipalities and settlements are named "in Thalwil", other places (peaks,
      // glaciers, areas) "bei ...".
      inside: r.attrs.origin === "gg25" || r.attrs.objectclass === "TLM_SIEDLUNGSNAME"
    };
    const same = places.find(p => p.name === place.name);
    if (same === undefined) {
      places.push(place);
    } else if (same.municipalityOnly && place.settlement) {
      // A municipality and its main settlement have the same name (Lugano, Zermatt). The
      // municipality's point is the middle of its area (for Lugano in the hills, about
      // 1000 m), the settlement's point is the town itself: use the settlement's point.
      same.lon = place.lon;
      same.lat = place.lat;
      same.municipalityOnly = false;
    }
  }

  // 2. Municipalities without a settlement of the same name (Davos, Glarus Nord) are left
  // out when their settlements are offered (Davos Dorf, Davos Platz; Filzbach, Näfels):
  // the middle of a large municipality is often far from any village. If none of its
  // settlements is in the results, the municipality stays, with a note on the card.
  const shown = places.filter(p => {
    if (!p.municipalityOnly) return true;
    const base = p.name.replace(/ \([A-Z]{2}\)$/, "");          // "Davos (GR)" -> "Davos"
    return !places.some(q => q.settlement && q.municipality === base);
  });
  return shown.slice(0, MAX_SUGGESTIONS);
}

// A label of the search looks like "<i>Ort</i> <b>Wengen</b> (BE) - Lauterbrunnen":
// kind in <i>, name in <b>, canton in brackets, municipality after " - ".
// Returns { name: "Wengen (BE), Lauterbrunnen", kind: "Ort", municipality: "Lauterbrunnen" }.
function readLabel(html) {
  const element = document.createElement("div");
  element.innerHTML = html;
  const kindElement = element.querySelector("i");
  const kind = kindElement ? kindElement.textContent.trim() : "";
  if (kindElement) kindElement.remove();
  // Peaks on the border have no canton and no municipality: "Matterhorn () - ".
  const text = element.textContent.replace(/\s+/g, " ").replace(" ()", "").replace(/ -\s*$/, "").trim();
  let [name, municipality] = text.split(" - ");
  name = name.replaceAll("|", " / ").trim();
  municipality = municipality ? municipality.trim() : "";
  // Show the municipality if it is one name (not a list of several, as for large towns)
  // and not already part of the place name.
  if (municipality !== "" && !municipality.includes(",") && !name.startsWith(municipality)) {
    name = name + ", " + municipality;
  }
  return { name: name, kind: kind, municipality: municipality };
}

function showSuggestions(results, list, input) {
  list.replaceChildren();
  if (results === null || results.length === 0) {
    const item = document.createElement("li");
    item.className = "search-empty";
    item.textContent = results === null ? t("search_error") : t("search_no_results");
    list.append(item);
    return;
  }
  for (const result of results) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = result.name;
    if (result.kind) {
      const kind = document.createElement("span");
      kind.className = "search-kind";
      kind.textContent = result.kind;
      button.append(kind);
    }
    button.addEventListener("click", () => {
      list.replaceChildren();
      input.value = result.name;
      input.blur();                                    // closes the keyboard on phones
      map.setView([result.lat, result.lon], 12);
      choosePlace(result.name, result.lon, result.lat, "search", result.municipalityOnly, result.inside);
    });
    item.append(button);
    list.append(item);
  }
}


// ---------------------------------------------------------------------------------
// The chosen place: load its cell and its images, then show the card
// ---------------------------------------------------------------------------------

// name: the place's name, or null for a tapped point outside any municipality.
// how: "search" or "map". middle: the point is only the middle of a municipality's area
// (note on the card). inside: a settlement or municipality from the search ("in ...").
async function choosePlace(name, lon, lat, how, middle = false, inside = false) {
  const thisChoice = ++choiceNumber;
  choice = null;
  const label = placeLabel(name, how === "search" && inside);
  if (marker === null) {
    marker = L.circleMarker([lat, lon], { radius: 9, color: "#7a1f00", weight: 3, fillColor: "#e8590c", fillOpacity: 0.9 }).addTo(map);
  } else {
    marker.setLatLng([lat, lon]);
  }
  showCard({ name: label.title, state: "loading" });

  let result;
  let panoramas = [];
  try {
    result = await loadCell(lon, lat);
    if (result.status === "ok") panoramas = await loadBundlePanoramas(result.cell.bundle);
  } catch (error) {
    if (thisChoice === choiceNumber) showCard({ name: label.title, state: "error" });
    return;
  }
  if (thisChoice !== choiceNumber) return;             // the user chose another place meanwhile

  if (result.status === "outside") {
    showCard({ name: label.title, state: "outside" });
    return;
  }
  choice = { name: label.title, phrase: label.phrase, lon: lon, lat: lat, cell: result.cell, panoramas: panoramas };
  showCard({ name: label.title, state: panoramas.length > 0 ? "ready" : "no_images", cell: result.cell, middle: middle });
  // Only the bundle (a group of cells with almost the same summer) is recorded, not the point.
  sendEvent("place_chosen", { bundle: result.cell.bundle, how: how, images: panoramas.length > 0 });
}

// How the place is named on the card (title) and in sentences (phrase). A place from the
// search: "Thalwil (ZH)" and "in Thalwil (ZH)". A tapped point: "bei Adliswil (ZH)" in both,
// because the point need not be the village centre and its 1 km cell can differ from it.
function placeLabel(name, inside) {
  if (name === null) return { title: t("clicked_place"), phrase: t("place_point") };
  if (inside) return { title: name, phrase: t("place_in", { name: name }) };
  const near = t("place_near", { name: name });
  return { title: near, phrase: near };
}

function showCard(info) {
  const card = document.getElementById("chosen-card");
  const playButton = document.getElementById("play-button");
  const skipLink = document.getElementById("skip-link");
  const message = document.getElementById("chosen-message");
  card.hidden = false;
  // The name with the elevation of the 1 km cell, as in the results heading (once the cell is known).
  document.getElementById("chosen-name").textContent =
    info.cell ? withElevation(info.name, info.cell.elevation) : info.name;
  document.getElementById("chosen-cell").textContent = info.cell ? t("chosen_cell") : "";
  // A hint how to choose a more exact point (with a note if it is a municipality's middle).
  const hint = document.getElementById("chosen-hint");
  hint.hidden = !info.cell;
  hint.textContent = info.middle ? t("chosen_hint_middle") : t("chosen_hint");
  document.getElementById("chosen-urban").hidden = !(info.cell && isUrban(info.cell));

  const texts = { loading: "chosen_loading", outside: "chosen_outside", error: "chosen_error", no_images: "chosen_no_images" };
  message.textContent = texts[info.state] ? t(texts[info.state]) : "";
  message.hidden = info.state === "ready";
  playButton.hidden = !(info.state === "ready");
  skipLink.hidden = !(info.state === "ready" || info.state === "no_images");
  // Without images, «show results» is the main action.
  skipLink.classList.toggle("as-button", info.state === "no_images");
}

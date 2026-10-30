// Memory of the images shown in earlier games, in this browser only (localStorage; nothing is
// sent anywhere, no cookies). The next games avoid these images as long as others are left
// (app_plan.md §14; script 35: without it, about half of the players of a Mittelland place
// see an image again within five games, because regions with a single image are drawn as
// often as regions with hundreds).
// The same store keeps a short log of the last games, which a tester can download with
// index.html?log (to report repeated or strange images).

const SHOWN_KEY = "hitzesommer_shown_images";
const LOG_KEY = "hitzesommer_game_log";
const MAX_SHOWN = 500;       // the oldest images are forgotten first
const MAX_LOG = 50;          // games in the log

// Read a list from the browser's storage; an empty list if storage is blocked or empty.
function readList(key) {
  try {
    const text = window.localStorage.getItem(key);
    return text === null ? [] : JSON.parse(text);
  } catch (error) {
    return [];
  }
}

function writeList(key, list) {
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch (error) {
    // Storage blocked (private window, settings): the game works without the memory.
  }
}

// Panorama ids shown in earlier games (a Set).
export function shownImages() {
  return new Set(readList(SHOWN_KEY));
}

// Remember the images of a new game and add it to the log.
// place: the chosen place; rounds: [{ pano_id, region_id }, ...]; regionName(id) gives a name.
export function rememberGame(place, rounds, regionName) {
  const shown = readList(SHOWN_KEY).concat(rounds.map(r => r.pano_id));
  writeList(SHOWN_KEY, shown.slice(-MAX_SHOWN));

  const log = readList(LOG_KEY);
  log.push({
    time: new Date().toISOString().slice(0, 16),
    place: place.name,
    bundle: place.cell.bundle,
    rounds: rounds.map(r => ({ pano_id: r.pano_id, region_id: r.region_id, region: regionName(r.region_id) }))
  });
  writeList(LOG_KEY, log.slice(-MAX_LOG));
}

// The personal record (best total of a game on this device; app_plan.md §16). Returns the
// record before this game ({ points, place, date } or null) and whether this game beats it;
// a better game becomes the new record.
const RECORD_KEY = "hitzesommer_record";

export function updateRecord(points, place) {
  let previous = null;
  try {
    const text = window.localStorage.getItem(RECORD_KEY);
    previous = text === null ? null : JSON.parse(text);
  } catch (error) {
    previous = null;
  }
  const isNew = previous === null || points > previous.points;
  if (isNew) {
    try {
      window.localStorage.setItem(RECORD_KEY, JSON.stringify(
        { points: points, place: place, date: new Date().toISOString().slice(0, 10) }));
    } catch (error) {
      // Storage blocked: no record, the game works anyway.
    }
  }
  return { previous: previous, isNew: isNew };
}

// With index.html?log: a link in the start screen's footer that downloads the log as a file.
export function offerLogDownload() {
  if (!new URLSearchParams(window.location.search).has("log")) return;
  const log = readList(LOG_KEY);
  const file = new Blob([JSON.stringify(log, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = "hitzesommer_spiele.json";
  link.textContent = "Testprotokoll herunterladen (" + log.length + " Spiele)";
  document.querySelector("#screen-start .page-footer").prepend(link);
}

// The app: three screens (start, play, results; app_plan.md §10). Only one is visible at a
// time.

import { loadTexts, fillTexts, t } from "./i18n.js";
import { initStart, refreshStartMap } from "./start.js";
import { startPlay } from "./play.js";
import { showResultsScreen } from "./results.js";
import { surveyBeforeGame, surveyAfterGame } from "./survey.js";
import { sendEvent } from "./events.js";
import { offerLogDownload } from "./memory.js";
import { initPages } from "./pages.js";
import { drawBanner } from "./banner.js";

let currentPlace = null;      // the place of the last game or results (for «Nochmals spielen»)
let currentScreen = "start";  // the visible screen (a text page returns to it)

function showScreen(name) {
  currentScreen = name;
  for (const screen of document.querySelectorAll(".screen")) {
    screen.hidden = screen.id !== "screen-" + name;
  }
  // The play screen fills the whole window; the page itself must not scroll then.
  document.body.classList.toggle("playing", name === "play");
  window.scrollTo(0, 0);
  if (name === "start") refreshStartMap();
}

// «Spielen»: optional survey question, then the five rounds, then the results.
async function startGame(place) {
  currentPlace = place;
  await surveyBeforeGame(place);
  sendEvent("game_started", { bundle: place.cell.bundle });
  showScreen("play");
  startPlay(place, async game => {
    await surveyAfterGame(place);
    showResults(place, game);
  });
}

// Results screen; game is null when the game was skipped.
function showResults(place, game = null) {
  currentPlace = place;
  sendEvent("results_shown", { bundle: place.cell.bundle, after_game: game !== null });
  showScreen("results");
  showResultsScreen(place, game);
}

async function main() {
  await loadTexts(window.APP_SETTINGS.language);
  document.title = t("page_title");
  fillTexts();
  drawBanner();
  initStart(startGame, place => showResults(place));
  for (const button of document.querySelectorAll(".back-to-start")) {
    button.addEventListener("click", () => showScreen("start"));
  }
  document.getElementById("play-again").addEventListener("click", () => startGame(currentPlace));
  initPages(showScreen, () => currentScreen);
  offerLogDownload();
  showScreen("start");
}

main();

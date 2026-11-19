// Settings of the app (documentation/app_plan.md §10). Change values here, not in the code.

// True when the app runs on this PC (scripts/serve_app.R on http://localhost:8000), false on
// the public test site. Used below to store the events (and the answers of the question box)
// only in local tests (app_plan.md §24).
const RUNS_LOCALLY = ["localhost", "127.0.0.1"].includes(window.location.hostname);

window.APP_SETTINGS = {
  // Language of the texts (file lang/<language>.json). French, Italian, English follow later.
  language: "de",

  // Folder with the data products of scripts 23, 27 and 28 (relative to index.html).
  // Locally the server of scripts/serve_app.R maps it to CLIMANA_DATA/app_products/default/.
  products: "products/",

  // Number of rounds per game.
  rounds: 5,

  // Walking in Street View (app_plan.md §22): true lets players move to the neighbouring
  // panoramas (arrows, clicks on the road) and shows «Zurück zum Start»; false allows looking
  // around only. Google bills per Street View object, not per panorama, so walking very
  // probably costs nothing extra (maps_and_imagery.md §2).
  walking: true,

  // Built-up share [%] of the 1 km cell from which the app notes that the grid data miss the
  // urban heat island (app_plan.md §13; script 34). null switches the note off.
  urbanNoteThreshold: 50,

  // Usage data (§10 point 5, §10a, §24): nothing is sent while endpoint is null. On this PC
  // the events go to the local server, which writes them to output/<run_id>/app_events/.
  events: {
    endpoint: RUNS_LOCALLY ? "events" : null
  },

  // Test hooks for the browser console (window.appDebug); always false for visitors.
  debug: false,

  // Question box with two click questions below the results map (§24b). Shown everywhere;
  // while events.endpoint is null (public test site, until data protection and ethics are
  // clarified) it runs as a test: it says that nothing is stored, and it appears after every
  // game. false switches it off everywhere.
  survey: {
    enabled: true
  }
};

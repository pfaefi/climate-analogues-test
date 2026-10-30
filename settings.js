// Settings of the app (documentation/app_plan.md §10). Change values here, not in the code.
window.APP_SETTINGS = {
  // Language of the texts (file lang/<language>.json). French, Italian, English follow later.
  language: "de",

  // Folder with the data products of scripts 23, 27 and 28 (relative to index.html).
  // Locally the server of scripts/serve_app.R maps it to CLIMANA_DATA/app_products/default/.
  products: "products/",

  // Number of rounds per game.
  rounds: 5,

  // Built-up share [%] of the 1 km cell from which the app notes that the grid data miss the
  // urban heat island (app_plan.md §13; script 34). null switches the note off.
  urbanNoteThreshold: 50,

  // Usage data (§10 point 5, §10a): nothing is sent while endpoint is null.
  events: {
    endpoint: null
  },

  // Test hooks for the browser console (window.appDebug); always false for visitors.
  debug: false,

  // Optional survey before and after the game (§10 point 5): switched off until data
  // protection and ethics are clarified with WSL.
  survey: {
    enabled: false
  }
};

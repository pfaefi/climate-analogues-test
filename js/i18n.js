// Texts of the app in one file per language (lang/<language>.json; app_plan.md §10).
// t("key") returns the text; {name} placeholders are filled from the second argument:
//   t("play_title", { round: 2, rounds: 5 })  ->  "Runde 2 von 5"

let texts = {};

// Load the language file once, at start.
export async function loadTexts(language) {
  const response = await fetch("lang/" + language + ".json");
  texts = await response.json();
}

export function t(key, values = {}) {
  let text = texts[key];
  if (text === undefined) return "[" + key + "]";     // shows missing texts clearly
  for (const name in values) text = text.replaceAll("{" + name + "}", values[name]);
  return text;
}

// A place name with the mean elevation of its 1 km cell (the climate data belong to the cell,
// not to the exact point), used on the start card and the results:
// "Zürich (ZH)" -> "Zürich (ZH; 415 m ü. M.)"; a name without brackets gets its own:
// "Gewählter Punkt" -> "Gewählter Punkt (1520 m ü. M.)".
export function withElevation(name, elevation) {
  const height = t("elevation_short", { elevation: Math.round(elevation) });
  if (name.endsWith(")")) return name.slice(0, -1) + "; " + height + ")";
  return name + " (" + height + ")";
}

// Fill every element with a data-text attribute with its text (static parts of the page).
export function fillTexts(root = document) {
  for (const element of root.querySelectorAll("[data-text]")) {
    element.textContent = t(element.dataset.text);
  }
  for (const element of root.querySelectorAll("[data-placeholder]")) {
    element.placeholder = t(element.dataset.placeholder);
  }
}

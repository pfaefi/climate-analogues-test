// The banner on top of every screen (app_plan.md §17): the summers of Switzerland 1961-2026
// as a band of stripes (one per summer, colours of the results graphic, js/stripes.js), and
// below it the name of the app. On the play screen only a thin band is left (styles.css).

import { stripeColour } from "./stripes.js";
import { t } from "./i18n.js";

// Joint heat-dryness indicator of Switzerland per summer 1961-2026 (national series of
// script 26: Swiss area means of T and bias-corrected P, then the index; column "index" of
// output/default/26_stripes_CH.csv, rounded). To update after the definitive MeteoSwiss data
// of 2026 (February 2027).
const FIRST_YEAR = 1961;
const SWITZERLAND = [
  -0.81, 0.73, -1.51, 0.31, -2.0, -1.56, -0.15, -1.57, -1.74, -0.93, -0.93, -1.16, -0.98, -0.94,
  -1.26, 0.09, -2.01, -1.78, -0.86, -1.88, -0.74, -1.12, 1.77, 0.04, -0.85, -0.7, -2.08, -0.53,
  -0.21, -0.31, 0.38, -0.03, -1.0, 0.75, -0.22, -0.89, -1.27, 0.39, -0.83, -0.45, -0.96, -0.37,
  2.63, -0.35, -0.33, 0.35, -1.67, -0.45, 0.19, -0.43, -0.5, -0.14, 0.77, -1.29, 1.95, -0.02,
  0.76, 2.03, 1.13, -0.14, -0.91, 2.13, 1.18, 1.32, 0.71, 2.98];

// Draw the band (one CSS gradient with hard stops: one stripe per summer).
export function drawBanner() {
  const band = document.getElementById("stripes-band");
  const step = 100 / SWITZERLAND.length;
  const stops = SWITZERLAND.map((value, k) =>
    stripeColour(value) + " " + (k * step).toFixed(3) + "% " + ((k + 1) * step).toFixed(3) + "%");
  band.style.backgroundImage = "linear-gradient(90deg, " + stops.join(", ") + ")";
  const last = FIRST_YEAR + SWITZERLAND.length - 1;
  const label = t("banner_label", { first: FIRST_YEAR, last: last });
  band.setAttribute("aria-label", label);
  band.title = label;
}

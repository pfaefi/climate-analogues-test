// Climate points of a guess (app_plan.md §16; script 40). Besides the distance points the
// player gets up to 5,000 climate points per round: full points if the guess lies in an
// orange analogue area of the place, else fewer, the more unusual the place's summer 2026
// would be among the normal summers 1991-2020 at the guessed place. "Unusual" is the sigma
// dissimilarity of the analogue search (R/sigma.R): Mahalanobis distance in (T, P^(1/3)) with
// the guessed place's mean and covariance, converted to sigma with the F distribution.
// The statistics come from script 40 as tiles of 5° x 5° (8 km cells, incl. the tropics).

import { fetchProduct } from "./data.js";

const PRODUCTS = window.APP_SETTINGS.products;
const tiles = new Map();       // tile name -> Int16Array (loaded once)
const images = new Map();      // map image file -> decoded image (for the orange areas)

// Climate of the guessed place and the points for it.
// bundle: the place's bundle (script 23: t, p of the summer 2026 that was searched, map images).
// Returns { points, sigma, meanT, meanP, inArea } or { points: 0, sea: true } where
// there are no data (sea, or a cell without enough summers).
export async function climateOfGuess(bundle, lon, lat) {
  const index = await fetchProduct("climate/index.json");
  const inArea = await inAnalogueArea(bundle, lon, lat);
  const stats = await statisticsAt(index, lon, lat);
  if (stats === null) return inArea ? { points: index.points.max, inArea: true, sea: false } : { points: 0, sea: true };

  const sigma = sigmaOf(stats, bundle.t, bundle.p, index.summers);
  const settings = index.points;
  let points = settings.max;
  if (!inArea && sigma > settings.sigma_full) {
    points = Math.round(settings.max * Math.exp(-(sigma - settings.sigma_full) / settings.sigma_scale));
  }
  return {
    points: points, sigma: sigma, inArea: inArea, sea: false,
    meanT: stats.mean_t,
    // Mean summer precipitation from the mean and variance of P^(1/3): E[C^3] for a normal C.
    meanP: stats.mean_c ** 3 + 3 * stats.mean_c * stats.var_c
  };
}


// ---------------------------------------------------------------------------------
// Statistics at a point (tiles of script 40)
// ---------------------------------------------------------------------------------

// The statistics of the 8 km cell at a point (means, variances, covariance), or null (sea, ice
// shelf, no data). If the cell itself has no data, the nearest land cell within two cells
// (about 15 km) is used: Google's coastline and the land mask of the data (Natural Earth) differ
// by a few km, so a tap on a beach should not count as sea (user's test 2026-10-30).
async function statisticsAt(index, lon, lat) {
  const row = Math.floor((index.north - lat) / index.resolution);
  const column = Math.floor((lon - index.west) / index.resolution);
  const offsets = [];
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) offsets.push([dr, dc]);
  }
  offsets.sort((a, b) => (a[0] ** 2 + a[1] ** 2) - (b[0] ** 2 + b[1] ** 2));   // nearest first
  for (const [dr, dc] of offsets) {
    const stats = await cellStatistics(index, row + dr, column + dc);
    if (stats !== null) return stats;
  }
  return null;
}

// The statistics of one cell of the grid (row, column from the north-west corner), or null.
async function cellStatistics(index, row, column) {
  if (row < 0 || column < 0) return null;
  const tileRow = Math.floor(row / index.tile_cells);
  const tileColumn = Math.floor(column / index.tile_cells);
  const name = String(tileRow).padStart(2, "0") + "_" + String(tileColumn).padStart(2, "0");
  if (!index.tiles.includes(name)) return null;                 // a tile without land

  if (!tiles.has(name)) {
    const response = await fetch(PRODUCTS + "climate/tile_" + name + ".bin");
    if (!response.ok) return null;
    // 16-bit integers, little-endian (as written by R's writeBin; all browsers are little-endian).
    tiles.set(name, new Int16Array(await response.arrayBuffer()));
  }
  const values = tiles.get(name);
  const cellsPerLayer = index.tile_cells * index.tile_cells;
  const position = (row % index.tile_cells) * index.tile_cells + (column % index.tile_cells);
  const stored = {};
  for (let k = 0; k < index.layers.length; k++) {
    const value = values[k * cellsPerLayer + position];
    if (value === index.nodata) return null;
    stored[index.layers[k]] = value / index.scales[index.layers[k]];
  }
  // The tiles hold standard deviations and the correlation; back to variances and covariance.
  return {
    mean_t: stored.mean_t, mean_c: stored.mean_c,
    var_t: stored.sd_t ** 2, var_c: stored.sd_c ** 2,
    cov_tc: stored.r_tc * stored.sd_t * stored.sd_c
  };
}


// ---------------------------------------------------------------------------------
// Sigma dissimilarity (as mahalanobis_2d() and distance_to_sigma(..., "f") in R/sigma.R)
// ---------------------------------------------------------------------------------

export function sigmaOf(stats, targetT, targetP, n) {
  const dt = targetT - stats.mean_t;
  const dc = Math.cbrt(targetP) - stats.mean_c;
  const determinant = stats.var_t * stats.var_c - stats.cov_tc ** 2;
  if (!(determinant > 0)) return Infinity;                      // e.g. a desert without any rain
  const d2 = (stats.var_c * dt * dt - 2 * stats.cov_tc * dt * dc + stats.var_t * dc * dc) / determinant;
  // Hotelling prediction region: F(2, n - 2). For 2 numerator degrees of freedom the upper
  // tail has a closed form: P(F > f) = (1 + 2 f / m)^(-m / 2), m = n - 2.
  const m = n - 2;
  const f = d2 * n / (n + 1) * m / (2 * (n - 1));
  const logOutside = -(m / 2) * Math.log1p(2 * f / m);
  // The same two-sided tail probability for one normal variable.
  return normalUpperQuantile(logOutside - Math.LN2);
}

// x with P(Z > x) = exp(logP) for a standard normal Z (upper tail, given as a logarithm so that
// very large distances do not round to 0). Acklam's approximation (relative error below
// 1.2e-9) for p > 1e-300, and the asymptotic expansion of the tail beyond.
function normalUpperQuantile(logP) {
  if (logP < -690) return Math.sqrt(-2 * logP - Math.log(-2 * logP) - Math.log(2 * Math.PI));
  return -normalQuantile(Math.exp(logP));
}

function normalQuantile(p) {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - low) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
         (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}


// ---------------------------------------------------------------------------------
// Is a point in an orange analogue area? (the map images of script 23)
// ---------------------------------------------------------------------------------

// The same images as on the results map, so that points and map agree. Inside the Swiss
// window (about 5.8-10.6° E, 45.7-47.9° N) the 1 km image decides (the cells of the search);
// elsewhere the 8 km blocks of the world images, but only blocks in which at least a third of
// the area is analogue (classes «teilweise» and «fast überall»). A block with only a few
// analogue cells («vereinzelt») gets the points by sigma, as outside (user's test 2026-10-30:
// guesses at the edge of an area got full points).
async function inAnalogueArea(bundle, lon, lat) {
  const swiss = bundle.images.switzerland;
  if (swiss && swiss.file && covers(swiss, lon, lat)) return (await pixelClass(swiss, lon, lat)) > 0;
  for (const image of [bundle.images.west, bundle.images.east]) {
    if (covers(image, lon, lat)) return (await pixelClass(image, lon, lat)) >= 2;
  }
  return false;
}

function covers(image, lon, lat) {
  return lon >= image.west && lon <= image.east && lat >= image.south && lat <= image.north;
}

// Class of the pixel under the point: 0 = not analogue (transparent), 1 «vereinzelt»,
// 2 «teilweise», 3 «fast überall» (the palette of script 23: green channel 174 / 105 / 54;
// the Swiss 1 km image has class 3 only). A 1 x 1 canvas; each image is decoded once.
async function pixelClass(image, lon, lat) {
  if (!images.has(image.file)) {
    const element = new Image();
    element.src = PRODUCTS + "maps/" + image.file;
    await element.decode();
    images.set(image.file, element);
  }
  const element = images.get(image.file);
  const x = Math.floor((lon - image.west) / (image.east - image.west) * element.naturalWidth);
  const y = Math.floor((image.north - lat) / (image.north - image.south) * element.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d");
  context.drawImage(element, x, y, 1, 1, 0, 0, 1, 1);
  const [, green, , alpha] = context.getImageData(0, 0, 1, 1).data;
  if (alpha === 0) return 0;
  if (green > 140) return 1;
  if (green > 80) return 2;
  return 3;
}

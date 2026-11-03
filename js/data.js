// Loading the data products (scripts 23, 27, 28). Every file is loaded at most once.

import { cellOfPoint, tileOfCell } from "./geo.js";

const PRODUCTS = window.APP_SETTINGS.products;
const cache = new Map();

// A JSON file from the products folder (cached; the same request is shared while loading).
export function fetchProduct(path) {
  if (!cache.has(path)) {
    const request = fetch(PRODUCTS + path).then(response => {
      if (!response.ok) throw new Error(path + ": " + response.status);
      return response.json();
    });
    request.catch(() => cache.delete(path));   // a failed request may be tried again
    cache.set(path, request);
  }
  return cache.get(path);
}

// An image, loaded (resolves on the image's load event). image.decode() would also do, but in
// some browsers its promise never settled although the image had loaded (the browser pane of
// the Claude app, 2026-11-03), so the plain load event is used.
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image could not be loaded: " + url));
    image.src = url;
  });
}

// The numbers of the Zielort cell at a point (script 27: one row per cell, in tiles).
// Returns { status: "ok", cell: {...} } or { status: "outside" }.
export async function loadCell(lon, lat) {
  const where = cellOfPoint(lon, lat);
  if (where === null) return { status: "outside" };
  let tile;
  try {
    tile = await fetchProduct("cells/" + where.tile);
  } catch (error) {
    // No tile: the point lies outside the cells with data (e.g. far beyond the border).
    if (String(error).includes("404")) return { status: "outside" };
    throw error;
  }
  const msCellColumn = tile.columns.indexOf("ms_cell");
  const row = tile.rows.find(r => r[msCellColumn] === where.msCell);
  if (row === undefined) return { status: "outside" };
  const cell = {};
  tile.columns.forEach((name, k) => { cell[name] = row[k]; });
  return { status: "ok", cell: cell };
}

// Is the cell densely built-up? Then the grid data miss the urban heat island and the app
// adds a note (built_up_percent from script 34; threshold in settings.js).
export function isUrban(cell) {
  const threshold = window.APP_SETTINGS.urbanNoteThreshold;
  if (threshold === null || cell.built_up_percent === undefined || cell.built_up_percent === null) return false;
  return cell.built_up_percent >= threshold;
}

// Positions in the Street View pool that a bundle may use (script 28).
export async function loadBundlePanoramas(bundle) {
  const file = "streetview/bundle_" + String(bundle).padStart(5, "0") + ".json";
  const content = await fetchProduct(file);
  return content.panoramas;
}

// The bundle file of script 23: analogue regions with their areas, map images and bounds.
// The regions come as rows; here they become objects { region_id, area_km2, ... }.
export async function loadBundle(bundle) {
  const content = await fetchProduct("bundles/bundle_" + String(bundle).padStart(5, "0") + ".json");
  const regions = content.regions.map(row => {
    const region = {};
    content.region_columns.forEach((name, k) => { region[name] = row[k]; });
    return region;
  });
  return { ...content, regions: regions };
}

// The whole Street View pool of script 28 (about 25,000 panoramas, 1.9 MB), loaded once.
// pool(position) gives { pano_id, lon, lat, date, region_id } of one row.
export async function loadPool() {
  const content = await fetchProduct("streetview_pool.json");
  return position => {
    const row = content.rows[position];
    const panorama = {};
    content.columns.forEach((name, k) => { panorama[name] = row[k]; });
    return panorama;
  };
}

// The compound-stripes series of the Zielort cell (script 29: index x 100 for 1961-2026),
// as { years: [...], values: [...] } in standard deviations; null if the cell has none.
export async function loadStripes(cell) {
  const tile = await fetchProduct("stripes/" + tileOfCell(cell.ms_cell));
  const series = tile.cells[String(cell.ms_cell)];
  if (series === undefined) return null;
  return {
    years: series.map((value, k) => tile.first_year + k),
    values: series.map(value => value / tile.multiplier)
  };
}

// The region (region_id of the region names) at a point anywhere on land, from the tiles of
// script 44 (Natural Earth admin-1 on a grid of 1/30°, about 3.7 km; region_id = red * 256 +
// green, 0 = sea). If the cell itself has no region (a tap just off the coast, a small island
// the grid misses), the nearest cell with a region within 3 cells (about 11 km) is used.
// Returns the region_id or null (sea).
const regionTiles = new Map();     // tile name -> RGBA pixels (loaded once)

export async function regionAt(lon, lat) {
  const index = await fetchProduct("regions_grid/index.json");
  const row = Math.floor((index.north - lat) / index.resolution);
  const column = Math.floor((lon - index.west) / index.resolution);
  const offsets = [];
  for (let dr = -3; dr <= 3; dr++) {
    for (let dc = -3; dc <= 3; dc++) offsets.push([dr, dc]);
  }
  offsets.sort((a, b) => (a[0] ** 2 + a[1] ** 2) - (b[0] ** 2 + b[1] ** 2));   // nearest first
  for (const [dr, dc] of offsets) {
    const region = await regionOfCell(index, row + dr, column + dc);
    if (region !== null) return region;
  }
  return null;
}

async function regionOfCell(index, row, column) {
  if (row < 0 || column < 0) return null;
  const tileRow = Math.floor(row / index.tile_cells);
  const tileColumn = Math.floor(column / index.tile_cells);
  const name = String(tileRow).padStart(2, "0") + "_" + String(tileColumn).padStart(2, "0");
  if (!index.tiles.includes(name)) return null;                 // a tile without land
  if (!regionTiles.has(name)) {
    const image = await loadImage(PRODUCTS + "regions_grid/tile_" + name + ".png");
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    regionTiles.set(name, context.getImageData(0, 0, canvas.width, canvas.height).data);
  }
  const pixels = regionTiles.get(name);
  const position = ((row % index.tile_cells) * index.tile_cells + (column % index.tile_cells)) * 4;
  const region = pixels[position] * 256 + pixels[position + 1];
  return region === 0 ? null : region;
}

// Names of all regions in the language of the app (script 31, about 145 kB), as a Map
// region_id -> { name, country }.
export async function loadRegions() {
  const content = await fetchProduct("regions_" + window.APP_SETTINGS.language + ".json");
  return new Map(content.rows.map(row => [row[0], { name: row[1], country: row[2] }]));
}

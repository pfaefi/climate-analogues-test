// From a point (longitude, latitude) to the Zielort cell of the MeteoSwiss 1 km grid.

// Swiss coordinates LV95 (E, N in metres) from WGS84 longitude / latitude, with the
// approximate formulas of swisstopo (accuracy about 1 m, enough for 1 km cells).
export function wgs84ToLv95(lon, lat) {
  const phi = (lat * 3600 - 169028.66) / 10000;
  const lambda = (lon * 3600 - 26782.5) / 10000;
  const east = 2600072.37 + 211455.93 * lambda - 10938.51 * lambda * phi
    - 0.36 * lambda * phi * phi - 44.54 * lambda * lambda * lambda;
  const north = 1200147.07 + 308807.95 * phi + 3745.25 * lambda * lambda + 76.63 * phi * phi
    - 194.56 * lambda * lambda * phi + 119.79 * phi * phi * phi;
  return { east: east, north: north };
}

// The MeteoSwiss grid of scripts 01 and 27: 370 columns x 240 rows of 1 km,
// east 2,474,000-2,844,000 m, north 1,064,000-1,304,000 m.
const GRID = { west: 2474000, north: 1304000, columns: 370, rows: 240, size: 1000 };
const TILE_KM = 20;   // tiles of script 27 (cells/tile_<x>_<y>.json, lower left corner in km)

// Cell number (as in R's terra: counted from 1, row by row from the north-west corner)
// and the name of the tile file that contains the cell. null outside the grid.
export function cellOfPoint(lon, lat) {
  const p = wgs84ToLv95(lon, lat);
  const column = Math.floor((p.east - GRID.west) / GRID.size) + 1;
  const row = Math.floor((GRID.north - p.north) / GRID.size) + 1;
  if (column < 1 || column > GRID.columns || row < 1 || row > GRID.rows) return null;

  const msCell = (row - 1) * GRID.columns + column;
  return { msCell: msCell, tile: tileOfCell(msCell) };
}

// Name of the tile file (scripts 27, 29) that contains a cell, from the centre of the cell.
export function tileOfCell(msCell) {
  const row = Math.floor((msCell - 1) / GRID.columns) + 1;
  const column = msCell - (row - 1) * GRID.columns;
  const centreEast = GRID.west + (column - 0.5) * GRID.size;
  const centreNorth = GRID.north - (row - 0.5) * GRID.size;
  const tileX = Math.floor(centreEast / 1000 / TILE_KM) * TILE_KM;
  const tileY = Math.floor(centreNorth / 1000 / TILE_KM) * TILE_KM;
  return "tile_" + tileX + "_" + tileY + ".json";
}

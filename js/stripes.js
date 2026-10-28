// The compound-stripes graphic of the results screen (documentation/compound_stripes.md):
// one bar per summer 1961-2026, height = joint heat-dryness indicator in standard deviations
// (relative to 1991-2020), colour from the user's "magenta" palette in 16 classes between
// -2.5 and +2.5 (colours saturate beyond, bar heights do not). Drawn as SVG, so it is sharp
// on every screen. Same colours and classes as stripe_colours() in R/stripes.R.

const PALETTE = [
  "#003F4A", "#005F6B", "#00808A", "#2A9FA6", "#66BCC0", "#9FD5D6", "#CDEAEA", "#EEF7F7",
  "#F9EDF4", "#F0CDE2", "#E3A3CB", "#D376B1", "#BE4A96", "#9C2A7B", "#73145E", "#4A0640"];
const LIMIT = 2.5;
const SVG = "http://www.w3.org/2000/svg";

// Colour of a value: 16 classes of equal width between -2.5 and +2.5; a boundary belongs to
// the class on its right, the upper end is closed (as in R/stripes.R).
export function stripeColour(value) {
  const width = 2 * LIMIT / PALETTE.length;
  let k = Math.floor((value + LIMIT) / width);
  k = Math.max(0, Math.min(PALETTE.length - 1, k));
  return PALETTE[k];
}

// Draw the bars into a container. series: { years, values }; labels: { low, high } for the
// two ends of the colour bar.
export function drawStripes(container, series, labels) {
  container.replaceChildren();
  const width = 660, height = 300;
  const margin = { left: 34, right: 8, top: 10, bottom: 70 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxAbs = Math.max(1, ...series.values.map(Math.abs)) * 1.08;   // symmetric scale
  const x = k => margin.left + k * plotWidth / series.years.length;
  const y = value => margin.top + plotHeight / 2 - value / maxAbs * plotHeight / 2;
  const barWidth = plotWidth / series.years.length;

  const svg = element("svg", { viewBox: "0 0 " + width + " " + height, role: "img", class: "stripes-svg" });

  // Horizontal lines and labels of the scale (whole standard deviations).
  for (let tick = -Math.floor(maxAbs); tick <= Math.floor(maxAbs); tick++) {
    svg.append(element("line", { x1: margin.left, x2: width - margin.right, y1: y(tick), y2: y(tick),
                                 class: tick === 0 ? "stripes-zero" : "stripes-grid" }));
    svg.append(text(margin.left - 6, y(tick) + 4, String(tick).replace("-", "−"), "stripes-tick end"));
  }

  // One bar per summer (missing summers: no bar).
  series.values.forEach((value, k) => {
    if (value === null || Number.isNaN(value)) return;
    const top = Math.min(y(value), y(0));
    const bar = element("rect", { x: x(k), y: top, width: barWidth + 0.3, height: Math.abs(y(value) - y(0)),
                                  fill: stripeColour(value) });
    const title = element("title", {});
    title.textContent = series.years[k] + ": " + value.toFixed(1).replace("-", "−");
    bar.append(title);
    svg.append(bar);
  });

  // Years below the bars: every decade and the last summer.
  const axisY = margin.top + plotHeight + 16;
  series.years.forEach((year, k) => {
    const last = k === series.years.length - 1;
    if (year % 10 === 0 && series.years.length - k > 4 || last) {
      svg.append(text(x(k) + barWidth / 2, axisY, String(year), last ? "stripes-year last" : "stripes-year"));
    }
  });

  // Colour bar with its two ends.
  const legendY = axisY + 14;
  const legendWidth = plotWidth * 0.6;
  const legendLeft = margin.left + (plotWidth - legendWidth) / 2;
  PALETTE.forEach((colour, k) => {
    svg.append(element("rect", { x: legendLeft + k * legendWidth / PALETTE.length, y: legendY,
                                 width: legendWidth / PALETTE.length + 0.3, height: 10, fill: colour }));
  });
  svg.append(text(legendLeft - 6, legendY + 9, labels.low, "stripes-legend end"));
  svg.append(text(legendLeft + legendWidth + 6, legendY + 9, labels.high, "stripes-legend"));

  container.append(svg);
}

function element(name, attributes) {
  const node = document.createElementNS(SVG, name);
  for (const key in attributes) node.setAttribute(key, attributes[key]);
  return node;
}

function text(xPosition, yPosition, content, className) {
  const node = element("text", { x: xPosition, y: yPosition, class: className });
  node.textContent = content;
  return node;
}

// Node script to generate SVG visualizations of each track's waypoint path
const fs = require('fs');
const path = require('path');

const tracksPath = path.join(__dirname, '..', 'public', 'js', 'tracks.js');
// Load the TRACKS export by evaluating the file (simple require works because it's ES module syntax)
// We'll use dynamic import via eval after stripping export statements
let fileContent = fs.readFileSync(tracksPath, 'utf8');
// Remove export syntax for compatibility
fileContent = fileContent.replace(/export const TRACKS =/, 'const TRACKS =');
// Execute in sandboxed context
let TRACKS = {};
eval(fileContent);

function createSvg(track) {
  const width = 500;
  const height = 500;
  // Determine bounding box of waypoints
  const xs = track.waypoints.map(p => p.x);
  const ys = track.waypoints.map(p => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 20;
  const scaleX = (width - 2 * pad) / (maxX - minX);
  const scaleY = (height - 2 * pad) / (maxY - minY);
  const scale = Math.min(scaleX, scaleY);
  const offsetX = pad - minX * scale + (width - (maxX - minX) * scale) / 2;
  const offsetY = pad - minY * scale + (height - (maxY - minY) * scale) / 2;

  const points = track.waypoints.map(p => {
    const x = p.x * scale + offsetX;
    const y = p.y * scale + offsetY;
    return { x, y };
  });

  const lines = points.map((pt, i) => {
    const next = points[(i + 1) % points.length];
    return `<line x1="${pt.x}" y1="${pt.y}" x2="${next.x}" y2="${next.y}" stroke="#00aaff" stroke-width="2"/>`;
  }).join('\n');

  const circles = points.map((pt, i) =>
    `<circle cx="${pt.x}" cy="${pt.y}" r="5" fill="#ff6600"/>`
  ).join('\n');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  ${lines}
  ${circles}
</svg>`;
  return svg;
}

const outputDir = path.join(__dirname, '..', 'artifacts');
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

Object.values(TRACKS).forEach(track => {
  const svg = createSvg(track);
  const filename = `${track.id}_track.svg`;
  const outPath = path.join(outputDir, filename);
  fs.writeFileSync(outPath, svg);
  console.log('Generated', outPath);
});

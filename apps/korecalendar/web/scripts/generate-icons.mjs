// Rasterizes app/icon.svg into the PNG icons (apple touch icon and the two
// manifest icons). Run `npm run brand:generate` after editing the SVG; never
// edit the PNGs by hand.
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const svg = await readFile(new URL("../app/icon.svg", import.meta.url));
const targets = [
  ["../app/apple-icon.png", 180],
  ["../public/icon-192.png", 192],
  ["../public/icon-512.png", 512],
];
for (const [path, size] of targets) {
  const png = await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();
  await writeFile(new URL(path, import.meta.url), png);
  console.log(`wrote ${path} (${size}px)`);
}

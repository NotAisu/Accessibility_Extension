import * as fs from 'fs';
import * as path from 'path';
import { Resvg } from '@resvg/resvg-js';

// Renders the Marketplace icon, media/icon.svg, to the 128x128 PNG the Marketplace requires.
// Run after changing the SVG: npm run icon

const SIZE = 128;
const media = path.join(__dirname, '..', 'media');
const svg = fs.readFileSync(path.join(media, 'icon.svg'), 'utf-8');
const png = new Resvg(svg, { fitTo: { mode: 'width', value: SIZE } }).render().asPng();
fs.writeFileSync(path.join(media, 'icon.png'), png);
console.log(`media/icon.png: ${SIZE}x${SIZE}, ${png.length} bytes`);

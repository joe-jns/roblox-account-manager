import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');

function png(size) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  return Buffer.from(r.render().asPng());
}

// 512 PNG (used by electron-builder for linux / as a source)
fs.writeFileSync(path.join(dir, 'icon.png'), png(512));

// Multi-size ICO for Windows
const ico = await pngToIco([png(256), png(128), png(64), png(48), png(32), png(16)]);
fs.writeFileSync(path.join(dir, 'icon.ico'), ico);
console.log('icon.ico bytes:', ico.length);

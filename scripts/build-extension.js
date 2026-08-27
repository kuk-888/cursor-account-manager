'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dest = path.join(root, 'dist');
fs.mkdirSync(dest, { recursive: true });

for (const name of ['extension.js', 'cdpBrowser.js', 'sandPatcher.js', 'sandCli.js']) {
  const from = path.join(root, 'src', name);
  if (!fs.existsSync(from))
    throw new Error('missing ' + from);
  fs.copyFileSync(from, path.join(dest, name));
}

console.log('copied src → dist');

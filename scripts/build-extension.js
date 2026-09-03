'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dest = path.join(root, 'dist');
fs.mkdirSync(dest, { recursive: true });

for (const name of ['extension.js', 'cdpBrowser.js', 'sandPatcher.js', 'sandCli.js', 'sandStream.js']) {
  const from = path.join(root, 'src', name);
  if (!fs.existsSync(from))
    throw new Error('missing ' + from);
  fs.copyFileSync(from, path.join(dest, name));
}

// 默认打满子代理。CAM_NO_SUBAGENT=1 产出精简对照版。
if (process.env.CAM_NO_SUBAGENT === '1') {
  const streamPath = path.join(dest, 'sandStream.js');
  const before = fs.readFileSync(streamPath, 'utf8');
  const after = before.replace(
    'const CLIENT_SUBAGENT_ENABLED = true;',
    'const CLIENT_SUBAGENT_ENABLED = false;'
  );
  if (after === before)
    throw new Error('CAM_NO_SUBAGENT: could not flip CLIENT_SUBAGENT_ENABLED');
  fs.writeFileSync(streamPath, after);
  console.log('copied src → dist (CLIENT_SUBAGENT disabled)');
} else {
  console.log('copied src → dist (CLIENT_SUBAGENT enabled)');
}

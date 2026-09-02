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

// 默认精简（CLIENT_SUBAGENT_ENABLED=false）。CAM_WITH_SUBAGENT=1 产出完整子代理对照版。
if (process.env.CAM_WITH_SUBAGENT === '1') {
  const streamPath = path.join(dest, 'sandStream.js');
  const before = fs.readFileSync(streamPath, 'utf8');
  const after = before.replace(
    'const CLIENT_SUBAGENT_ENABLED = false;',
    'const CLIENT_SUBAGENT_ENABLED = true;'
  );
  if (after === before)
    throw new Error('CAM_WITH_SUBAGENT: could not flip CLIENT_SUBAGENT_ENABLED');
  fs.writeFileSync(streamPath, after);
  console.log('copied src → dist (CLIENT_SUBAGENT enabled)');
} else {
  console.log('copied src → dist (CLIENT_SUBAGENT disabled)');
}

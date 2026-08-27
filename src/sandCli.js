#!/usr/bin/env node
'use strict';

const path = require('path');
const {
  applyPatch,
  defaultAppRoot,
  defaultStateRoot,
  inspect,
  restoreLatest
} = require('./sandPatcher');

function parseArgs(argv) {
  const result = { command: 'status', appRoot: null, stateRoot: null, dryRun: false, force: false };
  if (argv[0] && !argv[0].startsWith('-')) result.command = argv.shift();
  while (argv.length) {
    const arg = argv.shift();
    if (arg === '--app-root') result.appRoot = path.resolve(argv.shift());
    else if (arg === '--state-root') result.stateRoot = path.resolve(argv.shift());
    else if (arg === '--dry-run') result.dryRun = true;
    else if (arg === '--force') result.force = true;
    else if (arg === '--json') result.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const appRoot = args.appRoot || defaultAppRoot();
  const stateRoot = args.stateRoot || defaultStateRoot();
  let result;
  if (args.command === 'status') result = inspect(appRoot);
  else if (args.command === 'apply') result = applyPatch({ appRoot, stateRoot, dryRun: args.dryRun });
  else if (args.command === 'restore') result = restoreLatest({ appRoot, stateRoot, force: args.force });
  else throw new Error(`Unknown command: ${args.command}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`cursor-account-manager-sand: ${error.stack || error.message || String(error)}\n`);
  process.exitCode = 1;
}

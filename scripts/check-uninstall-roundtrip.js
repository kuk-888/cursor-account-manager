'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sand = require('../src/sandStream');

const patcher = require('../src/sandPatcher');
const root = path.join(
  __dirname,
  '..',
  '..',
  'cursor插件开发',
  '_unpack-3.18.9',
  'Cursor.app',
  'Contents',
  'Resources',
  'app'
);
const leftovers = patcher.LEFTOVER_MARKERS;

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function headerPatch(text) {
  return text
    .replace(/(\.set\(\s*["']x-cursor-client-type["']\s*,\s*)[A-Za-z_$][\w$]*\s*\?\?\s*["']ide["'](\s*\))/g, '$1"sand"$2')
    .replace(/(\.set\(\s*["']x-cursor-client-type["']\s*,\s*)["']ide["'](\s*\))/g, '$1"sand"$2')
    .replace(/(["']x-cursor-client-type["']\s*:\s*)["']ide["']/g, '$1"sand"');
}

function headerUnpatch(text) {
  return text
    .replace(/(isGlass\s*\?\s*["']glass["']\s*:\s*)["']sand["']/g, '$1"ide"')
    .replace(/(\.set\(\s*["']x-cursor-client-type["']\s*,\s*)["']sand["'](\s*\))/g, '$1"ide"$2')
    .replace(/(header\.set\(\s*["']x-cursor-client-type["']\s*,\s*[A-Za-z_$][A-Za-z0-9_$.]*\s*(?:\?\?|\|\|)\s*)["']sand["']/g, '$1"ide"')
    .replace(/(["']x-cursor-client-type["']\s*:\s*)["']sand["']/g, '$1"ide"');
}

const files = sand.TARGET_SPECS
  .map((s) => ({ rel: s.rel, abs: path.join(root, s.rel) }))
  .filter((f) => fs.existsSync(f.abs));

const fail = [];
const appliedMarkers = [];
let ok = 0;
for (const f of files) {
  const original = fs.readFileSync(f.abs);
  const applied = headerPatch(sand.applySandPatches(original.toString('utf8')).content);
  const removed = headerUnpatch(sand.removeSandPatches(applied).content);
  const marks = leftovers.filter((m) => removed.includes(m));
  const same = sha(Buffer.from(removed, 'utf8')) === sha(original);
  if (same && !marks.length) ok += 1;
  else fail.push({ rel: f.rel, same, marks });
  const hit = leftovers.filter((m) => applied.includes(m));
  if (hit.length) appliedMarkers.push({ rel: f.rel, markers: hit });
}

console.log(JSON.stringify({ files: files.length, reversedOk: ok, fail, appliedMarkers }, null, 2));
if (fail.length) process.exit(1);

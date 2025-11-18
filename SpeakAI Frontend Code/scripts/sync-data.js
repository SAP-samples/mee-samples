#!/usr/bin/env node
// Fetch the /table/speakers endpoint from the backend and write the result
// into webapp/mockdata/speakers.json so the UI5 app can use local mockdata.
// Usage:
//   node scripts/syncMock.js --url http://localhost:8000 [--limit 0] [--dropEmbedding true] [--pretty]

const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { url: process.env.BACKEND_URL || 'http://localhost:8000', limit: 0, dropEmbedding: true, pretty: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--url' && args[i + 1]) { out.url = args[++i]; }
    else if (a === '--limit' && args[i + 1]) { out.limit = Number(args[++i]); }
    else if (a === '--dropEmbedding' && args[i + 1]) { out.dropEmbedding = args[++i] === 'true'; }
    else if (a === '--pretty') { out.pretty = true; }
  }
  return out;
}

async function main() {
  const opts = parseArgs();
  const query = [];
  if (opts.limit && Number(opts.limit) > 0) query.push(`limit=${encodeURIComponent(opts.limit)}`);
  if (opts.dropEmbedding === false) query.push(`dropEmbedding=false`);
  const q = query.length ? `?${query.join('&')}` : '';
  const url = `${opts.url.replace(/\/$/, '')}/table/speakers${q}`;
  console.log(`Fetching speakers table from: ${url}`);
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.error(`Request failed: ${resp.status} ${resp.statusText}`);
      process.exitCode = 2;
      return;
    }
    const body = await resp.json();
    const rows = body.rows || body.speakers || [];
    const out = { speakers: rows };
    const target = path.join(__dirname, '..', 'webapp', 'mockdata', 'speakers.json');
    const serialized = opts.pretty ? JSON.stringify(out, null, 2) : JSON.stringify(out);
    fs.writeFileSync(target, serialized, { encoding: 'utf8' });
    console.log(`Wrote ${rows.length} rows to ${target}`);
  } catch (err) {
    console.error('Sync failed:', err);
    process.exitCode = 3;
  }
}

// Node 18+ provides fetch globally; if not present, print a warning and skip gracefully
if (typeof fetch === 'undefined') {
  console.warn('Global fetch is not available in this Node runtime. Skipping sync. Use Node 18+ or install a fetch polyfill if you want to enable this.');
  process.exitCode = 0;
} else {
  // ensure the mockdata directory exists
  const targetDir = path.join(__dirname, '..', 'webapp', 'mockdata');
  try {
    fs.mkdirSync(targetDir, { recursive: true });
  } catch (err) {
    // ignore
  }
  main();
}

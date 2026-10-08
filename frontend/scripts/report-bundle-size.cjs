const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const distAssets = path.resolve(__dirname, '..', 'dist', 'assets');
const checkBudgets = process.argv.includes('--check');

const budgets = [
  { label: 'app bootstrap', matcher: /^index-.*\.js$/, bytes: 100 * 1024 },
  { label: 'authenticated shell', matcher: /^Layout-.*\.js$/, bytes: 90 * 1024 },
  { label: 'messages route', matcher: /^Messages-.*\.js$/, bytes: 220 * 1024 },
  { label: 'dashboard route', matcher: /^Dashboard-.*\.js$/, bytes: 125 * 1024 }
];

if (!fs.existsSync(distAssets)) {
  console.error('No production build found. Run "npm run build" first.');
  process.exitCode = 1;
  return;
}

const formatKiB = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
const assets = fs.readdirSync(distAssets)
  .filter(file => file.endsWith('.js'))
  .map(file => {
    const body = fs.readFileSync(path.join(distAssets, file));
    return {
      file,
      raw: body.byteLength,
      gzip: zlib.gzipSync(body).byteLength
    };
  })
  .sort((first, second) => second.raw - first.raw);

console.table(assets.map(asset => ({
  asset: asset.file,
  raw: formatKiB(asset.raw),
  gzip: formatKiB(asset.gzip)
})));

let overBudget = false;
for (const budget of budgets) {
  const asset = assets.find(entry => budget.matcher.test(entry.file));
  if (!asset) continue;

  const status = asset.raw > budget.bytes ? 'OVER' : 'OK';
  console.log(`${status.padEnd(4)} ${budget.label}: ${formatKiB(asset.raw)} / ${formatKiB(budget.bytes)} (${asset.file})`);
  overBudget ||= asset.raw > budget.bytes;
}

if (overBudget && checkBudgets) {
  console.error('Bundle budget check failed. Split or defer the regressed route before shipping.');
  process.exitCode = 1;
}

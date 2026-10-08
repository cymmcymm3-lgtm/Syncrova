#!/usr/bin/env node

const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const clean = (value = '') => String(value || '').trim();
const mongoUri = clean(process.env.MONGODB_URI);
const r2Bucket = clean(process.env.R2_BUCKET_NAME || process.env.R2_BUCKET || process.env.CLOUDFLARE_R2_BUCKET_NAME);
const r2Endpoint = clean(process.env.R2_ENDPOINT || process.env.CLOUDFLARE_R2_ENDPOINT);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = `backups/syncrova-${stamp}`;

const redactMongoUri = (uri = '') => {
  if (!uri) return '<MONGODB_URI>';
  try {
    const parsed = new URL(uri);
    if (parsed.password) parsed.password = '***';
    if (parsed.username) parsed.username = '***';
    return parsed.toString();
  } catch {
    return '<MONGODB_URI>';
  }
};

console.log('Syncrova backup checklist');
console.log('');
console.log(`1. Create a local backup folder:`);
console.log(`   mkdir -p ${backupDir}`);
console.log('');
console.log('2. Export MongoDB:');
console.log(`   mongodump --uri "${redactMongoUri(mongoUri)}" --out "${backupDir}/mongo"`);
console.log('');
console.log('3. Copy Cloudflare R2 media with an S3-compatible CLI profile:');
if (r2Bucket && r2Endpoint) {
  console.log(`   aws s3 sync "s3://${r2Bucket}" "${backupDir}/r2" --endpoint-url "${r2Endpoint}"`);
} else {
  console.log('   aws s3 sync "s3://<R2_BUCKET_NAME>" "' + backupDir + '/r2" --endpoint-url "<R2_ENDPOINT>"');
}
console.log('');
console.log('4. Restore order for disaster recovery:');
console.log(`   mongorestore --uri "<MONGODB_URI>" "${backupDir}/mongo"`);
console.log('   aws s3 sync "' + backupDir + '/r2" "s3://<R2_BUCKET_NAME>" --endpoint-url "<R2_ENDPOINT>"');
console.log('');
console.log('5. After restore, run:');
console.log('   npm run storage:check');
console.log('   npm run storage:repair:local-r2 -- --dry-run');
console.log('   npm run storage:migrate:r2 -- --dry-run');

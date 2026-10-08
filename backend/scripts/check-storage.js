#!/usr/bin/env node

const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const {
  deleteObject,
  getStorageConfigStatus,
  isCloudStorageEnabled,
  readObjectBuffer,
  uploadBuffer
} = require('../services/storage');

const main = async () => {
  const status = getStorageConfigStatus();
  console.log('Storage provider:', status.provider);
  console.log('Bucket:', status.bucket || 'missing');
  console.log('Config status:', status.status);

  if (status.missing.length) {
    console.error(`Missing required env: ${status.missing.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  if (!isCloudStorageEnabled) {
    console.error('Cloud storage is not enabled.');
    process.exitCode = 1;
    return;
  }

  let uploaded = null;
  try {
    uploaded = await uploadBuffer({
      buffer: Buffer.from(`Syncrova storage check ${new Date().toISOString()}`),
      originalName: 'storage-check.txt',
      mimeType: 'text/plain',
      folder: 'healthchecks'
    });

    console.log('Upload: ok');
    console.log('Object path:', uploaded.path || 'missing');

    if (uploaded.url && /^https?:\/\//i.test(uploaded.url)) {
      const response = await fetch(uploaded.url);
      console.log('Public read:', response.ok ? 'ok' : `${response.status} failed`);
      if (!response.ok) {
        console.warn('Public URL was generated but could not be read. Make the bucket public or use the backend proxy URL.');
      }
    } else if (uploaded.path) {
      const object = await readObjectBuffer(uploaded.path, { provider: uploaded.provider });
      console.log('Cloud read:', object.length > 0 ? 'ok' : 'empty');
    } else {
      console.warn('Read check skipped: missing object path');
    }
  } catch (err) {
    console.error('Storage check failed:', err.message || err);
    process.exitCode = 1;
    return;
  } finally {
    if (uploaded?.path) {
      await deleteObject(uploaded.path, { provider: uploaded.provider })
        .then(() => console.log('Delete: ok'))
        .catch(err => console.warn('Delete failed:', err.message || err));
    }
  }
};

main();

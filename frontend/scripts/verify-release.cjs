#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const frontendRoot = path.join(repoRoot, 'frontend');
const backendRoot = path.join(repoRoot, 'backend');

const readText = (filePath) => fs.readFileSync(filePath, 'utf8');

const getMatch = (text, regex, label) => {
  const match = text.match(regex);
  if (!match) throw new Error(`Could not read ${label}`);
  return match[1];
};

const formatBytes = (bytes) => {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const checks = [];
const addCheck = (ok, label, detail = '') => {
  checks.push({ ok, label, detail });
};

const main = () => {
  const frontendPackage = JSON.parse(readText(path.join(frontendRoot, 'package.json')));
  const gradle = readText(path.join(frontendRoot, 'android', 'app', 'build.gradle'));
  const releaseInfo = readText(path.join(frontendRoot, 'src', 'generated', 'releaseInfo.js'));
  const appUpdate = readText(path.join(backendRoot, 'routes', 'appUpdate.js'));
  const health = readText(path.join(backendRoot, 'routes', 'health.js'));

  const packageVersion = String(frontendPackage.version || '').trim();
  const gradleVersionName = getMatch(gradle, /versionName\s+"([^"]+)"/, 'Android versionName');
  const gradleVersionCode = Number(getMatch(gradle, /versionCode\s+(\d+)/, 'Android versionCode'));
  const releaseVersionName = getMatch(releaseInfo, /RELEASE_VERSION_NAME\s*=\s*"([^"]+)"/, 'releaseInfo version');
  const releaseVersionCode = Number(getMatch(releaseInfo, /RELEASE_ANDROID_VERSION_CODE\s*=\s*(\d+)/, 'releaseInfo versionCode'));
  const backendVersionName = getMatch(appUpdate, /versionName:\s*'([^']+)'/, 'backend bundled versionName');
  const backendVersionCode = Number(getMatch(appUpdate, /versionCode:\s*(\d+)/, 'backend bundled versionCode'));
  const healthVersionName = getMatch(health, /versionName:\s*'([^']+)'/, 'health bundled versionName');
  const healthVersionCode = Number(getMatch(health, /versionCode:\s*(\d+)/, 'health bundled versionCode'));
  const expectedApk = path.join(backendRoot, 'public', 'releases', `syncrova-${packageVersion}.apk`);
  const latestApk = path.join(backendRoot, 'public', 'releases', 'syncrova-latest.apk');
  const expectedExists = fs.existsSync(expectedApk);
  const latestExists = fs.existsSync(latestApk);
  const expectedSize = expectedExists ? fs.statSync(expectedApk).size : 0;
  const latestSize = latestExists ? fs.statSync(latestApk).size : 0;

  addCheck(packageVersion === gradleVersionName, 'package.json matches Android versionName', `${packageVersion} / ${gradleVersionName}`);
  addCheck(packageVersion === releaseVersionName, 'package.json matches generated releaseInfo', `${packageVersion} / ${releaseVersionName}`);
  addCheck(packageVersion === backendVersionName, 'package.json matches backend update fallback', `${packageVersion} / ${backendVersionName}`);
  addCheck(packageVersion === healthVersionName, 'package.json matches backend health fallback', `${packageVersion} / ${healthVersionName}`);
  addCheck(gradleVersionCode === releaseVersionCode, 'Android versionCode matches releaseInfo', `${gradleVersionCode} / ${releaseVersionCode}`);
  addCheck(gradleVersionCode === backendVersionCode, 'Android versionCode matches backend update fallback', `${gradleVersionCode} / ${backendVersionCode}`);
  addCheck(gradleVersionCode === healthVersionCode, 'Android versionCode matches backend health fallback', `${gradleVersionCode} / ${healthVersionCode}`);
  addCheck(expectedExists, `versioned APK exists`, path.relative(repoRoot, expectedApk));
  addCheck(latestExists, `latest APK exists`, path.relative(repoRoot, latestApk));
  addCheck(expectedExists && latestExists && expectedSize === latestSize, 'latest APK size matches versioned APK', `${formatBytes(expectedSize)} / ${formatBytes(latestSize)}`);

  console.log(`Syncrova release verification: ${packageVersion} (${gradleVersionCode})`);
  checks.forEach(check => {
    console.log(`${check.ok ? 'OK ' : 'ERR'} ${check.label}${check.detail ? ` - ${check.detail}` : ''}`);
  });

  const failed = checks.filter(check => !check.ok);
  if (failed.length) {
    console.error(`\n${failed.length} release check(s) failed. Auto-update prompt may not appear until these are fixed.`);
    process.exitCode = 1;
    return;
  }

  console.log('\nRelease metadata and APK files are in sync.');
};

try {
  main();
} catch (err) {
  console.error(err.message || err);
  process.exitCode = 1;
}

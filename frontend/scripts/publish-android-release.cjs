const fs = require('fs');
const path = require('path');

const frontendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(frontendRoot, '..');
const packageJsonPath = path.join(frontendRoot, 'package.json');
const releaseInfoPath = path.join(frontendRoot, 'src', 'generated', 'releaseInfo.js');
const apkOutputDir = path.join(frontendRoot, 'android', 'app', 'build', 'outputs', 'apk', 'release');
const releaseDir = path.join(repoRoot, 'backend', 'public', 'releases');

const readText = (filePath) => fs.readFileSync(filePath, 'utf8');
const packageJson = JSON.parse(readText(packageJsonPath));
const versionName = packageJson.version;
const versionCode = Number(readText(releaseInfoPath).match(/RELEASE_ANDROID_VERSION_CODE\s*=\s*(\d+)/)?.[1] || 0);
const safeVersion = String(versionName || 'latest').replace(/[^a-zA-Z0-9._-]/g, '-');
const isMessengerRelease = process.argv.includes('--messenger');
const releaseBaseName = isMessengerRelease ? 'syncrova-messenger' : 'syncrova';
const releaseLabel = isMessengerRelease ? 'Syncrova Messenger' : 'Syncrova';

if (!versionName || !versionCode) {
  throw new Error('Missing release version metadata. Run npm run version:sync first.');
}

if (!fs.existsSync(apkOutputDir)) {
  throw new Error(`APK output directory not found: ${apkOutputDir}`);
}

const apks = fs.readdirSync(apkOutputDir)
  .filter(fileName => fileName.endsWith('.apk'))
  .map(fileName => ({
    fileName,
    filePath: path.join(apkOutputDir, fileName),
    size: fs.statSync(path.join(apkOutputDir, fileName)).size
  }))
  .sort((a, b) => {
    const aUniversal = a.fileName.includes('universal') ? 1 : 0;
    const bUniversal = b.fileName.includes('universal') ? 1 : 0;
    return bUniversal - aUniversal || b.size - a.size;
  });

if (!apks.length) {
  throw new Error(`No APK found in ${apkOutputDir}`);
}

const source = apks[0];
fs.mkdirSync(releaseDir, { recursive: true });

const versionedApkPath = path.join(releaseDir, `${releaseBaseName}-${safeVersion}.apk`);
const latestApkPath = path.join(releaseDir, `${releaseBaseName}-latest.apk`);

fs.copyFileSync(source.filePath, versionedApkPath);
fs.copyFileSync(source.filePath, latestApkPath);

console.log(`Published ${source.fileName} as ${releaseLabel} ${versionName} (${versionCode})`);
console.log(`- ${versionedApkPath}`);
console.log(`- ${latestApkPath}`);

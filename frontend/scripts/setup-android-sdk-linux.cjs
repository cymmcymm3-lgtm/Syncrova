#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const frontendRoot = path.resolve(__dirname, '..');
const androidRoot = path.join(frontendRoot, 'android');
const localPropertiesPath = path.join(androidRoot, 'local.properties');
const repositoryXmlUrl = 'https://dl.google.com/android/repository/repository2-1.xml';
const requiredPackages = [
  'platform-tools',
  'platforms;android-36',
  'build-tools;35.0.0'
];

const args = new Set(process.argv.slice(2));
const shouldInstall = args.has('--install');
const shouldCheck = args.has('--check') || !shouldInstall;
const acceptsLicenses = args.has('--accept-licenses') || process.env.SYNCROVA_ACCEPT_ANDROID_LICENSES === '1';

const readText = (filePath) => fs.readFileSync(filePath, 'utf8');
const writeText = (filePath, value) => fs.writeFileSync(filePath, value);

const readLocalSdkDir = () => {
  try {
    const match = readText(localPropertiesPath).match(/^sdk\.dir=(.+)$/m);
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
};

const getPreferredSdkRoot = () => (
  process.env.SYNCROVA_ANDROID_SDK_ROOT
  || (() => {
    const envSdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '';
    if (envSdkRoot && !path.resolve(envSdkRoot).startsWith('/usr/')) return envSdkRoot;
    return path.join(os.homedir(), 'Android', 'Sdk');
  })()
);

const getSdkRoot = () => {
  const localSdkDir = readLocalSdkDir();
  if (shouldInstall) return getPreferredSdkRoot();
  return localSdkDir || getPreferredSdkRoot();
};

const sdkRoot = path.resolve(getSdkRoot());
const sdkManagerPath = path.join(sdkRoot, 'cmdline-tools', 'latest', 'bin', 'sdkmanager');

const hasRequiredPackages = () => (
  fs.existsSync(sdkManagerPath)
  && fs.existsSync(path.join(sdkRoot, 'platforms', 'android-36', 'android.jar'))
  && fs.existsSync(path.join(sdkRoot, 'build-tools', '35.0.0', 'aapt2'))
);

const printNextSteps = () => {
  const recommendedSdkRoot = path.resolve(getPreferredSdkRoot());
  console.error('\nAndroid SDK is not ready for this project.');
  console.error(`Current sdk.dir: ${readLocalSdkDir() || '(missing)'}`);
  console.error(`Recommended local SDK: ${recommendedSdkRoot}`);
  console.error('\nRun this once to download the SDK packages and accept the Android SDK licenses:');
  console.error('  SYNCROVA_ACCEPT_ANDROID_LICENSES=1 npm run android:sdk:setup:linux');
  console.error('\nThen build again:');
  console.error('  npm run android:apk:release:linux\n');
};

const fetchText = (url) => new Promise((resolve, reject) => {
  https.get(url, response => {
    if (response.statusCode !== 200) {
      reject(new Error(`Request failed ${response.statusCode}: ${url}`));
      response.resume();
      return;
    }

    let body = '';
    response.setEncoding('utf8');
    response.on('data', chunk => { body += chunk; });
    response.on('end', () => resolve(body));
  }).on('error', reject);
});

const downloadFile = (url, targetPath) => new Promise((resolve, reject) => {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const file = fs.createWriteStream(targetPath);
  https.get(url, response => {
    if (response.statusCode !== 200) {
      file.close();
      fs.rmSync(targetPath, { force: true });
      reject(new Error(`Download failed ${response.statusCode}: ${url}`));
      response.resume();
      return;
    }

    response.pipe(file);
    file.on('finish', () => {
      file.close(resolve);
    });
  }).on('error', err => {
    file.close();
    fs.rmSync(targetPath, { force: true });
    reject(err);
  });
});

const getLatestCommandLineTools = async () => {
  const xml = await fetchText(repositoryXmlUrl);
  const packageMatch = xml.match(/<remotePackage path="cmdline-tools;latest">[\s\S]*?<\/remotePackage>/);
  if (!packageMatch) throw new Error('Could not find cmdline-tools;latest in Android repository XML.');

  const linuxArchiveMatch = packageMatch[0].match(/<archive>[\s\S]*?<host-os>linux<\/host-os>[\s\S]*?<complete>[\s\S]*?<size>(\d+)<\/size>[\s\S]*?<checksum[^>]*>([^<]+)<\/checksum>[\s\S]*?<url>([^<]+)<\/url>[\s\S]*?<\/complete>[\s\S]*?<\/archive>/);
  if (!linuxArchiveMatch) throw new Error('Could not find Linux command-line tools archive.');

  return {
    size: Number(linuxArchiveMatch[1]),
    sha1: linuxArchiveMatch[2],
    url: `https://dl.google.com/android/repository/${linuxArchiveMatch[3]}`
  };
};

const verifySha1 = (filePath, expectedSha1) => {
  const hash = crypto.createHash('sha1');
  hash.update(fs.readFileSync(filePath));
  const actualSha1 = hash.digest('hex');
  if (actualSha1 !== expectedSha1) {
    throw new Error(`Command-line tools checksum mismatch. Expected ${expectedSha1}, got ${actualSha1}.`);
  }
};

const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, {
    stdio: options.input ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    input: options.input,
    shell: false
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(' ')} failed`);
  }
};

const ensureCommandLineTools = async () => {
  if (fs.existsSync(sdkManagerPath)) return;

  const archive = await getLatestCommandLineTools();
  const downloadsDir = path.join(sdkRoot, '.downloads');
  const zipPath = path.join(downloadsDir, path.basename(archive.url));
  const tempDir = path.join(downloadsDir, 'cmdline-tools-temp');
  const latestDir = path.join(sdkRoot, 'cmdline-tools', 'latest');

  console.log(`Downloading Android command-line tools to ${zipPath}`);
  await downloadFile(archive.url, zipPath);
  verifySha1(zipPath, archive.sha1);

  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(tempDir, { recursive: true });
  run('unzip', ['-q', zipPath, '-d', tempDir]);

  fs.rmSync(latestDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(latestDir), { recursive: true });
  fs.renameSync(path.join(tempDir, 'cmdline-tools'), latestDir);
  fs.rmSync(tempDir, { recursive: true, force: true });
};

const writeLocalProperties = () => {
  fs.mkdirSync(androidRoot, { recursive: true });
  writeText(localPropertiesPath, `sdk.dir=${sdkRoot}\n`);
  console.log(`Updated ${localPropertiesPath}`);
};

const installRequiredPackages = async () => {
  await ensureCommandLineTools();
  writeLocalProperties();

  if (!acceptsLicenses) {
    printNextSteps();
    process.exit(1);
  }

  console.log('Accepting Android SDK licenses for this local SDK.');
  run(sdkManagerPath, ['--sdk_root=' + sdkRoot, '--licenses'], { input: 'y\n'.repeat(80) });

  console.log(`Installing Android SDK packages into ${sdkRoot}`);
  run(sdkManagerPath, ['--sdk_root=' + sdkRoot, '--install', ...requiredPackages]);
};

(async () => {
  if (shouldInstall) {
    await installRequiredPackages();
  }

  if (shouldCheck && !hasRequiredPackages()) {
    printNextSteps();
    process.exit(1);
  }

  if (hasRequiredPackages()) {
    writeLocalProperties();
    console.log(`Android SDK ready: ${sdkRoot}`);
  }
})().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});

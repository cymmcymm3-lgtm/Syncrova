const fs = require('fs');
const path = require('path');

const expoAvPath = path.join(__dirname, '..', 'node_modules', 'expo-av');
const androidPath = path.join(expoAvPath, 'android');
const configPath = path.join(expoAvPath, 'expo-module.config.json');
const indexBuildPath = path.join(expoAvPath, 'build', 'index.js');
const indexSourcePath = path.join(expoAvPath, 'src', 'index.ts');
const viewUtilsPath = path.join(androidPath, 'src', 'main', 'java', 'expo', 'modules', 'av', 'ViewUtils.kt');
const fullscreenVideoPlayerPath = path.join(androidPath, 'src', 'main', 'java', 'expo', 'modules', 'av', 'video', 'FullscreenVideoPlayer.java');

function normalizeFutureMtimes(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return false;
  }

  const now = new Date();
  let normalized = false;
  const stack = [targetPath];

  while (stack.length > 0) {
    const currentPath = stack.pop();
    const stat = fs.statSync(currentPath);

    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(currentPath)) {
        stack.push(path.join(currentPath, entry));
      }
    }

    if (stat.mtime > now) {
      fs.utimesSync(currentPath, now, now);
      normalized = true;
    }
  }

  return normalized;
}

function patchViewUtils() {
  if (!fs.existsSync(viewUtilsPath)) {
    return false;
  }

  const source = fs.readFileSync(viewUtilsPath, 'utf8');
  const patched = source
    .replace("import expo.modules.core.interfaces.services.UIManager\n", '')
    .replaceAll(
      'moduleRegistry.getModule(UIManager::class.java).resolveView(viewTag) as VideoViewWrapper?',
      'moduleRegistry.appContext?.findView<VideoViewWrapper>(viewTag)'
    );

  if (patched === source) {
    return false;
  }

  fs.writeFileSync(viewUtilsPath, patched);
  return true;
}

function patchFullscreenVideoPlayer() {
  if (!fs.existsSync(fullscreenVideoPlayerPath)) {
    return false;
  }

  const source = fs.readFileSync(fullscreenVideoPlayerPath, 'utf8');
  const oldKeepAwakeBlock = `          AppContext appContext = fullscreenVideoPlayer.mAppContext.get();
          ModuleRegistry moduleRegistry = appContext != null ? appContext.getLegacyModuleRegistry() : null;
          if (moduleRegistry != null) {
            KeepAwakeManager keepAwakeManager = moduleRegistry.getModule(KeepAwakeManager.class);
            boolean keepAwakeIsActivated = keepAwakeManager != null && keepAwakeManager.isActivated();
            if (isPlaying || keepAwakeIsActivated) {
              window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            } else {
              window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
          }`;
  const newKeepAwakeBlock = `          if (isPlaying) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
          } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
          }`;
  const patched = source
    .replace("import expo.modules.core.ModuleRegistry;\n", '')
    .replace("import expo.modules.core.interfaces.services.KeepAwakeManager;\n", '')
    .replace(oldKeepAwakeBlock, newKeepAwakeBlock);

  if (patched === source) {
    return false;
  }

  fs.writeFileSync(fullscreenVideoPlayerPath, patched);
  return true;
}

function patchExpoAvIndex(indexPath) {
  if (!fs.existsSync(indexPath)) {
    return false;
  }

  const source = fs.readFileSync(indexPath, 'utf8');
  const patched = source
    .replace("export { default as Video } from './Video';\n", 'export const Video = undefined;\n')
    .replace("export * from './Video.types';\n", '');

  if (patched === source) {
    return false;
  }

  fs.writeFileSync(indexPath, patched);
  return true;
}

if (!fs.existsSync(configPath)) {
  console.warn('[patch-expo-av-android] expo-av config not found, skipping');
  process.exit(0);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const androidModules = config.android?.modules;

if (!Array.isArray(androidModules)) {
  console.warn('[patch-expo-av-android] android.modules missing, skipping');
  process.exit(0);
}

let changed = false;

const nextModules = androidModules.filter(moduleName => moduleName !== 'expo.modules.av.video.VideoViewModule');

if (nextModules.length !== androidModules.length) {
  config.android.modules = nextModules;
  changed = true;
}

if (config.android.publication) {
  delete config.android.publication;
  changed = true;
}

if (normalizeFutureMtimes(androidPath)) {
  changed = true;
}

if (patchViewUtils()) {
  changed = true;
}

if (patchFullscreenVideoPlayer()) {
  changed = true;
}

if (patchExpoAvIndex(indexBuildPath)) {
  changed = true;
}

if (patchExpoAvIndex(indexSourcePath)) {
  changed = true;
}

if (!changed) {
  console.log('[patch-expo-av-android] expo-av Android config already patched');
  process.exit(0);
}

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log('[patch-expo-av-android] patched expo-av Android config');

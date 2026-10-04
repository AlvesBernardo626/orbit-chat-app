const { app, BrowserWindow, ipcMain, dialog, desktopCapturer, nativeImage, session, shell, globalShortcut } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

const argv = process.argv.slice(1);
function getArg(name, fallback) {
  const found = argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.split('=')[1] : fallback;
}
const profile = getArg('profile', 'default');

// Each --profile gets its own isolated userData dir, so two windows on the
// same machine can be logged in as two different people at the same time.
const baseUserData = app.getPath('userData');
app.setPath('userData', path.join(baseUserData, `profile-${profile}`));

const { startServer } = require('./server/index');
const { MONGODB_URI } = require('./server/paths');
const { PORT, IS_REMOTE_SERVER, SERVER_URL } = require('./shared/constants');

let mainWindow = null;
let pendingSourceResolve = null;

async function ensureServer() {
  if (IS_REMOTE_SERVER) {
    // This build points at a hosted server (see shared/constants.js) — never
    // self-host locally, every copy of the app must talk to that one server.
    console.log(`[orbit] usando servidor remoto: ${SERVER_URL}`);
    return;
  }
  try {
    await startServer(MONGODB_URI);
    console.log(`[orbit] servidor de sinalização iniciado nesta instância (porta ${PORT})`);
  } catch (err) {
    if (err && err.code === 'EADDRINUSE') {
      console.log('[orbit] servidor já em execução em outro processo — conectando como cliente');
    } else {
      console.error('[orbit] erro ao iniciar servidor embutido:', err);
    }
  }
}

function sessionFilePath() {
  return path.join(app.getPath('userData'), 'session.json');
}

ipcMain.handle('session:load', () => {
  try {
    const raw = fs.readFileSync(sessionFilePath(), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
});

ipcMain.handle('session:save', (event, data) => {
  fs.mkdirSync(path.dirname(sessionFilePath()), { recursive: true });
  fs.writeFileSync(sessionFilePath(), JSON.stringify(data, null, 2));
  return true;
});

ipcMain.handle('session:clear', () => {
  try { fs.unlinkSync(sessionFilePath()); } catch { /* nothing to clear */ }
  return true;
});

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// kind: 'avatar' (square) or 'banner' (wide) — both accept animated GIFs.
ipcMain.handle('avatar:pick', async (event, kind) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: kind === 'banner' ? 'Escolher banner' : 'Escolher foto de perfil',
    filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  if (fs.statSync(filePath).size > MAX_IMAGE_BYTES) return { error: 'too_large' };

  if (path.extname(filePath).toLowerCase() === '.gif') {
    // nativeImage.resize() flattens animated GIFs to a single frame, so
    // animated ones are passed through as-is (still capped in size above)
    // instead of round-tripping through it.
    const buffer = fs.readFileSync(filePath);
    return { dataUrl: `data:image/gif;base64,${buffer.toString('base64')}` };
  }

  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) return null;
  const size = kind === 'banner' ? { width: 640, height: 240 } : { width: 128, height: 128 };
  const resized = image.resize({ ...size, quality: 'good' });
  return { dataUrl: resized.toDataURL() };
});

// Chat messages come from other users and may contain links — never let
// them navigate this window; only hand http(s) URLs to the OS browser.
ipcMain.handle('shell:open-external', (event, url) => {
  try {
    const parsed = new URL(String(url));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    shell.openExternal(parsed.href);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('screenshare:pick-response', (event, sourceId) => {
  if (pendingSourceResolve) {
    pendingSourceResolve(sourceId || null);
    pendingSourceResolve = null;
  }
  return true;
});

function setupDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 240, height: 150 },
      });
      const forRenderer = sources.map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
      mainWindow.webContents.send('screenshare:pick-request', forRenderer);
      const chosenId = await new Promise((resolve) => { pendingSourceResolve = resolve; });
      const chosen = chosenId ? sources.find((s) => s.id === chosenId) : null;
      if (!chosen) {
        callback({});
        return;
      }
      callback({ video: chosen, audio: 'loopback' });
    } catch (err) {
      console.error('[orbit] erro ao capturar tela:', err);
      callback({});
    }
  });
}

// Checks GitHub Releases for a newer published version, downloads it in the
// background, and installs it the next time the app quits — so friends
// running the installed (non-portable) build never need a new .exe sent to
// them by hand again. Only makes sense for a packaged build: `npm start`
// during development has no installed location to update in place.
function setupAutoUpdate() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const notify = (state) => {
    if (mainWindow) mainWindow.webContents.send('update:status', { state });
  };
  autoUpdater.on('update-available', () => notify('available'));
  autoUpdater.on('update-downloaded', () => notify('ready'));
  autoUpdater.on('error', (err) => console.error('[orbit] erro ao verificar atualização:', err));

  autoUpdater.checkForUpdates().catch(() => { /* offline or no releases yet — silently skip */ });
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 60 * 60 * 1000);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 1000,
    minHeight: 660,
    backgroundColor: '#0b0a10',
    autoHideMenuBar: true,
    title: 'Orbit',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Belt-and-suspenders: chat/link content is untrusted, so even if a link
  // ever slipped past the renderer's own click interception, this window
  // itself should never navigate away from the app or open a new window.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

app.whenReady().then(async () => {
  await ensureServer();
  setupDisplayMediaHandler();
  createWindow();

  // Global mute toggle (works even while another app/game has focus, like
  // Discord's mute hotkey) — Windows won't register a global shortcut made
  // of only a modifier key, so this needs a real key alongside it.
  globalShortcut.register('Alt+M', () => {
    if (mainWindow) mainWindow.webContents.send('hotkey:toggle-mute');
  });

  setupAutoUpdate();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

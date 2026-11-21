import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, protocol, screen, shell, Tray } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAssets } from '../src/assets.mjs';
import { localOwner, openLocalStore } from '../src/local-store.mjs';
import { handle } from '../src/server.mjs';
import { edgeBounds, edges, nearestEdge, panelBounds, ratioFor } from './docking.mjs';
import { archiveBatch } from './archive.mjs';
import { createWindowsBridge } from './windows-bridge.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const panelPage = 'guixu://desktop/island.html';
const edgePage = 'guixu://desktop/island-edge.html';
const shortcut = 'Ctrl+Alt+G';
const WM_NCLBUTTONDBLCLK = 0x00a3;
const HTCAPTION = 2;
const hoverDelay = 240;
const hoverCloseDelay = 450;
const hoverPadding = 16;

let dock, arrow, sensor, topSensor, tray, store, preferencesFile;
let placement, previewPlacement, fileDragTimer, blurTimer, pointerTimer;
let mode = 'edge';
let pinned = true;
let quitting = false;
let moving = false;
let importOwner = null;
let shortcutAvailable = false;
let hoverSince = null;
let waitForPointerExit = false;
let foregroundContext = process.platform === 'win32' ? 'blocked' : 'desktop';
let foregroundRead;
let checkingPointer = false;
const surfaces = new Map();
const dragging = new Set();
const media = createWindowsBridge('media-bridge.ps1');
const foreground = createWindowsBridge('foreground-bridge.ps1', { timeout: 1200, retryDelay: 2000 });

app.setName('归序');
if (process.env.GUIXU_DESKTOP_PROFILE) app.setPath('userData', process.env.GUIXU_DESKTOP_PROFILE);
protocol.registerSchemesAsPrivileged([{
  scheme: 'guixu',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
}]);

function displayFor(id) {
  return screen.getAllDisplays().find(display => display.id === id) ?? screen.getPrimaryDisplay();
}

function panelPosition(target) {
  return panelBounds(displayFor(target.displayId).workArea, target.edge, target.ratio);
}

function sendState(surface) {
  const { window, edge, role, bounds } = surface;
  if (window.isDestroyed()) return;
  window.webContents.send('island:state', {
    expanded: mode === 'open' || mode === 'preview' || mode === 'hover',
    preview: mode === 'preview',
    suspended: foregroundContext === 'blocked' || foregroundContext === 'explorer',
    edge: edge ?? placement.edge,
    tab: role === 'arrow',
    edgeSize: role !== 'dock' ? { width: bounds.width, height: bounds.height } : null,
    pinned,
    shortcutAvailable,
  });
}

function sendDock(channel, ...args) {
  if (dock && !dock.isDestroyed()) dock.webContents.send(channel, ...args);
}

function showEdge(window, visible) {
  if (!visible) { window.hide(); return; }
  if (!window.isVisible()) window.showInactive();
  if (!window.isAlwaysOnTop()) window.setAlwaysOnTop(true);
}

function canShowArrow() {
  return mode !== 'tray' && (foregroundContext === 'desktop' || foregroundContext === 'guixu');
}

function canReceiveFiles() {
  return mode !== 'tray' && ['desktop', 'guixu', 'explorer'].includes(foregroundContext);
}

function updateShortcut() {
  const permitted = foregroundContext === 'desktop' || foregroundContext === 'guixu';
  if (!permitted && shortcutAvailable) {
    globalShortcut.unregister(shortcut);
    shortcutAvailable = false;
  } else if (permitted && !shortcutAvailable) {
    shortcutAvailable = globalShortcut.register(shortcut, () => {
      if (mode === 'open' && dock.isFocused()) present('edge');
      else void showPanel();
    });
  }
}

function layoutEdges() {
  const active = displayFor(placement.displayId);
  for (const [window, side, show] of [
    [sensor, placement.edge, canReceiveFiles()],
    [topSensor, 'top', placement.edge !== 'top' && canReceiveFiles()],
    // Keep the arrow mapped while the panel opens and closes. The panel's
    // bounds leave room for it, so Windows never has to repaint it from hidden.
    [arrow, placement.edge, canShowArrow()],
  ]) {
    const bounds = edgeBounds(active.workArea, side, placement.ratio, window === arrow);
    const surface = surfaces.get(window.webContents.id);
    if (!surface.shaped || Object.keys(bounds).some(key => bounds[key] !== surface.bounds[key])) {
      window.setBounds(bounds);
      // Windows imposes a minimum HWND size. Limit painting and hit testing to
      // the actual edge strip or arrow, including an arrow beside the taskbar.
      window.setShape([{ x: 0, y: 0, width: bounds.width, height: bounds.height }]);
      surface.shaped = true;
      surface.bounds = bounds;
    }
    surface.edge = side;
    sendState(surface);
    showEdge(window, show);
  }
  // The arrow overlaps the strip at the anchor. Give its button the click.
  if (arrow.isVisible()) arrow.moveTop();
}

function containsPointer(bounds, point, padding = 0) {
  return point.x >= bounds.x - padding && point.x < bounds.x + bounds.width + padding &&
    point.y >= bounds.y - padding && point.y < bounds.y + bounds.height + padding;
}

function pointerNearArrow(point) {
  const arrowBounds = surfaces.get(arrow.webContents.id).bounds;
  return containsPointer(arrowBounds, point, hoverPadding);
}

function setForegroundContext(next) {
  if (next === foregroundContext || quitting) return;
  foregroundContext = next;
  updateShortcut();
  if (mode === 'tray') return;
  if (next === 'blocked' ||
      (next === 'explorer' && (mode === 'open' || mode === 'hover') && importOwner === null)) {
    present('edge');
  } else if (next === 'desktop' && mode !== 'edge') {
    present('edge');
  } else {
    layoutEdges();
  }
}

function refreshForeground() {
  if (process.platform !== 'win32') return Promise.resolve();
  foregroundRead ??= foreground.request('state', { ownerPid: process.pid })
    .then(context => setForegroundContext(['desktop', 'guixu', 'explorer'].includes(context) ? context : 'blocked'))
    .catch(() => setForegroundContext('blocked'))
    .finally(() => { foregroundRead = null; });
  return foregroundRead;
}

async function showPanel(next = 'open', target = placement) {
  if (!dock || !arrow || quitting) return;
  await refreshForeground();
  if (quitting || (next === 'preview' && !dragging.size)) return;
  if (foregroundContext === 'desktop' || foregroundContext === 'guixu' ||
      (foregroundContext === 'explorer' && (next === 'preview' || importOwner !== null))) {
    present(next, target);
  }
}

async function checkPointer() {
  if (checkingPointer) return;
  checkingPointer = true;
  try { await refreshForeground(); }
  finally { checkingPointer = false; }
  if (quitting || !canShowArrow()) return;
  if (!arrow.isVisible() || arrow.isMinimized()) {
    if (arrow.isMinimized()) arrow.restore();
    showEdge(arrow, true);
    arrow.moveTop();
  }
  if (mode !== 'edge' && mode !== 'hover') return;
  if (mode === 'edge' && foregroundContext !== 'desktop') return;
  const point = screen.getCursorScreenPoint();
  const nearby = pointerNearArrow(point);
  if (mode === 'edge' && waitForPointerExit) {
    if (!nearby) waitForPointerExit = false;
    return;
  }
  if (importOwner !== null || dragging.size) return;
  const wantsChange = mode === 'edge' ? nearby : !nearby && !containsPointer(dock.getBounds(), point, 5);
  if (!wantsChange) { hoverSince = null; return; }
  const now = Date.now();
  hoverSince ??= now;
  const delay = mode === 'edge' ? hoverDelay : hoverCloseDelay;
  if (now - hoverSince >= delay) present(mode === 'edge' ? 'hover' : 'edge');
}

function present(next, target = placement) {
  if (!dock || dock.isDestroyed()) return;
  clearTimeout(fileDragTimer);
  clearTimeout(blurTimer);
  const previous = mode;
  mode = next;
  hoverSince = null;
  const panel = surfaces.get(dock.webContents.id);
  if (next === 'edge' || next === 'tray') {
    previewPlacement = null;
    dragging.clear();
    dock.hide();
  } else {
    if (previous === 'edge' || previous === 'tray' || next === 'preview') dock.setBounds(panelPosition(target));
    if (next === 'preview' || next === 'hover') dock.showInactive();
    else {
      previewPlacement = null;
      dock.show();
      dock.focus();
    }
    if (dock.isAlwaysOnTop() !== (pinned || next === 'preview' || next === 'hover')) {
      dock.setAlwaysOnTop(pinned || next === 'preview' || next === 'hover');
    }
  }
  sendState(panel);
  layoutEdges();
  if (next === 'edge') waitForPointerExit = previous !== 'edge' && pointerNearArrow(screen.getCursorScreenPoint());
  changeMenu();
}

function dockOn(edge, display = displayFor(placement.displayId), point) {
  const area = display.workArea;
  const ratio = point ? ratioFor(area, edge, point) : .5;
  placement = { edge, ratio, displayId: display.id };
  savePreferences();
  present('edge');
}

function savePreferences() {
  if (!preferencesFile || !placement) return;
  try { writeFileSync(preferencesFile, JSON.stringify({ ...placement, pinned }), 'utf8'); }
  catch (error) { console.warn('Unable to save dock position:', error.message); }
}

function togglePin() {
  pinned = !pinned;
  if (mode === 'open') dock.setAlwaysOnTop(pinned);
  sendState(surfaces.get(dock.webContents.id));
  savePreferences();
  changeMenu();
}

function changeMenu() {
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: '打开归序', click: () => void showPanel() },
    { label: '收回屏幕边缘', click: () => present('edge'), enabled: mode !== 'edge' },
    {
      label: '停靠位置',
      submenu: Object.entries(edges).map(([edge, label]) => ({
        label, type: 'radio', checked: placement.edge === edge, click: () => dockOn(edge),
      })),
    },
    { label: '保持置顶', type: 'checkbox', checked: pinned, click: togglePin },
    { label: '隐藏到托盘', enabled: mode !== 'tray', click: () => present('tray') },
    { type: 'separator' },
    { label: '退出归序', click: () => app.quit() },
  ]));
}

function makeWindow(role, bounds) {
  const window = new BrowserWindow({
    ...bounds, show: false, frame: false, transparent: true, resizable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
    focusable: role === 'dock', movable: role === 'dock', minWidth: 1, minHeight: 1,
    hasShadow: false, title: role === 'dock' ? '归序 · 桌面浮窗' : '归序 · 屏幕边缘',
    icon: join(root, 'desktop', 'icon.ico'),
    webPreferences: {
      preload: join(root, 'desktop', 'preload.cjs'),
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: role !== 'arrow',
    },
  });
  window.setBounds(bounds);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  const id = window.webContents.id;
  surfaces.set(id, { window, role, bounds, page: role === 'dock' ? panelPage : edgePage, edge: role === 'dock' ? null : placement.edge });
  window.webContents.on('render-process-gone', () => {
    dragging.delete(id);
    if (mode === 'preview') queuePreviewClose();
  });
  return window;
}

function surfaceFor(event) {
  const surface = surfaces.get(event.sender.id);
  return surface && event.senderFrame?.url === surface.page ? surface : null;
}

function queuePreviewClose() {
  clearTimeout(fileDragTimer);
  if (mode !== 'preview' || dragging.size || importOwner !== null) return;
  fileDragTimer = setTimeout(() => {
    if (mode === 'preview' && !dragging.size && importOwner === null) present('edge');
  }, 650);
}

async function moveArchive(paths) {
  if (!paths.length || quitting) return;
  if (importOwner !== null) { sendDock('island:import-busy'); return; }
  importOwner = 'native';
  await showPanel('open', previewPlacement ?? placement);
  sendDock('island:import-progress', 0, 0);
  try {
    const result = await archiveBatch(store, paths, {
      root: process.env.GUIXU_ARCHIVE_ROOT,
      trashItem: path => shell.trashItem(path),
      progress: (current, total) => sendDock('island:import-progress', current, total),
    });
    sendDock('island:import-result', result.completed, result.errors.slice(0, 80), result.errors.length,
      { folders: result.folders, files: result.files, root: result.root });
  } catch (error) {
    console.error('Archive operation:', error.message);
    sendDock('island:import-result', 0, ['无法准备归档盘，原件仍在原位置。']);
  } finally {
    importOwner = null;
  }
}

function registerEvents() {
  ipcMain.handle('island:media-state', async event => {
    if (surfaceFor(event)?.role !== 'dock') return null;
    try { return await media.request('state'); } catch { return null; }
  });
  ipcMain.handle('island:media-control', async (event, command) => {
    if (surfaceFor(event)?.role !== 'dock') return false;
    const { action, source, value } = command ?? {};
    if (!['play', 'pause', 'previous', 'next', 'seek', 'volume', 'mute'].includes(action)) return false;
    if (typeof source !== 'string' || source.length > 512) return false;
    if (action === 'seek' && !(Number.isFinite(value) && value >= 0 && value <= 31536000)) return false;
    if (action === 'volume' && !(Number.isFinite(value) && value >= 0 && value <= 100)) return false;
    if (action === 'mute' && typeof value !== 'boolean') return false;
    try { return await media.request(action, { source, value }); } catch { return false; }
  });
  ipcMain.on('island:action', (event, action) => {
    const surface = surfaceFor(event);
    if (!surface) return;
    if (action === 'state') { sendState(surface); return; }
    if (action === 'expand' && surface.role === 'arrow') { void showPanel(); return; }
    if (surface.role !== 'dock') return;
    if (action === 'collapse') present('edge');
    if (action === 'idle' && mode === 'open' && !dock.isFocused() && importOwner === null && !moving) present('edge');
    if (action === 'pin') togglePin();
  });
  ipcMain.on('island:file-drag', async (event, action, point) => {
    const surface = surfaceFor(event);
    if (!surface) return;
    const id = event.sender.id;
    if (action === 'leave') {
      dragging.delete(id);
      queuePreviewClose();
      return;
    }
    if (action !== 'enter') return;
    if (!canReceiveFiles()) return;
    clearTimeout(fileDragTimer);
    dragging.add(id);
    if (mode !== 'edge' && mode !== 'hover') return;
    const display = displayFor(placement.displayId);
    const pointer = Number.isFinite(point?.x) && Number.isFinite(point?.y) ? point : screen.getCursorScreenPoint();
    const edge = surface.edge ?? placement.edge;
    previewPlacement = { edge, displayId: display.id, ratio: ratioFor(display.workArea, edge, pointer) };
    await showPanel('preview', previewPlacement);
  });
  ipcMain.on('island:archive-drop', (event, paths) => {
    if (surfaceFor(event) && Array.isArray(paths)) void moveArchive(paths);
  });
  ipcMain.handle('island:archive-pick', async (event, kind) => {
    if (surfaceFor(event)?.role !== 'dock') return;
    const { canceled, filePaths } = await dialog.showOpenDialog(dock, {
      title: kind === 'folder' ? '选择要原样移动归档的文件夹' : '选择要移动归档的文件',
      properties: [kind === 'folder' ? 'openDirectory' : 'openFile', 'multiSelections'],
    });
    if (!canceled) await moveArchive(filePaths);
  });
  ipcMain.handle('island:archive-open', async (event, id) => {
    if (surfaceFor(event)?.role !== 'dock' || typeof id !== 'string') return '找不到归档。';
    const archive = await store.DB.prepare('SELECT path,kind FROM archives WHERE id=? AND owner=?').bind(id,localOwner).first();
    if (!archive) return '找不到归档。';
    return shell.openPath(archive.kind === 'folder' ? archive.path : dirname(archive.path));
  });

  dock.on('blur', () => {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      if (mode === 'open' && !dock.isFocused()) sendDock('island:blur');
    }, 220);
  });
  dock.on('focus', () => {
    clearTimeout(blurTimer);
    if (mode === 'hover') void showPanel();
  });
  if (process.platform === 'win32') {
    // Electron's draggable title-bar area receives native clicks rather than DOM clicks.
    dock.hookWindowMessage(WM_NCLBUTTONDBLCLK, hit => {
      if (hit.readInt32LE(0) !== HTCAPTION) return;
      setImmediate(() => {
        if (mode === 'open' || mode === 'preview' || mode === 'hover') present('edge');
      });
    });
  }
  dock.on('will-move', () => { moving = true; });
  dock.on('moved', () => {
    if (!moving) return;
    moving = false;
    const point = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(point);
    const edge = nearestEdge(display.workArea, point) ?? nearestEdge(display.bounds, point);
    if (edge) dockOn(edge, display, point);
  });
  dock.on('close', event => {
    if (!quitting) { event.preventDefault(); present('edge'); }
  });

  function updateDisplay() {
    placement.displayId = displayFor(placement.displayId).id;
    if (mode === 'open' || mode === 'preview' || mode === 'hover') dock.setBounds(panelPosition(previewPlacement ?? placement));
    layoutEdges();
    savePreferences();
  }
  screen.on('display-metrics-changed', updateDisplay);
  screen.on('display-removed', updateDisplay);
}

async function start() {
  const path = process.env.GUIXU_DATA_DIR || join(root, '.local', 'data');
  const assets = await loadAssets(join(root, 'public'));
  store = openLocalStore(path);
  protocol.handle('guixu', async packet => {
    const url = new URL(packet.url);
    if (url.hostname !== 'desktop') return new Response('Not found', { status: 404 });
    const headers = new Headers(packet.headers);
    headers.set('oai-authenticated-user-id', localOwner);
    const options = { method: packet.method, headers };
    if (packet.body) Object.assign(options, { body: packet.body, duplex: 'half' });
    return handle(new Request(url, options), store, assets);
  });
  preferencesFile = join(app.getPath('userData'), 'island.json');
  let preferences = {};
  try { preferences = JSON.parse(readFileSync(preferencesFile, 'utf8')) ?? {}; } catch {}
  pinned = preferences.pinned !== false;
  const display = displayFor(preferences.displayId);
  const edge = Object.hasOwn(edges, preferences.edge) ? preferences.edge : 'top';
  const ratio = Number.isFinite(preferences.ratio) ? Math.max(0, Math.min(1, preferences.ratio)) : .5;
  placement = { edge, ratio, displayId: display.id };

  dock = makeWindow('dock', panelPosition(placement));
  arrow = makeWindow('arrow', edgeBounds(display.workArea, edge, ratio, true));
  sensor = makeWindow('sensor', edgeBounds(display.workArea, edge, ratio));
  topSensor = makeWindow('sensor', edgeBounds(display.workArea, 'top', .5));
  dock.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  dock.webContents.session.setPermissionCheckHandler(() => false);
  registerEvents();
  tray = new Tray(join(root, 'desktop', 'icon.ico'));
  tray.setToolTip('归序 · 桌面浮窗');
  tray.on('click', () => void showPanel());
  updateShortcut();
  await Promise.all([
    dock.loadURL(panelPage),
    ...[arrow, sensor, topSensor].map(window => window.loadURL(edgePage)),
  ]);
  present('edge');
  pointerTimer = setInterval(checkPointer, 80);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => void showPanel());
  app.on('before-quit', event => {
    if (importOwner !== null) { event.preventDefault(); return; }
    quitting = true;
    clearTimeout(fileDragTimer);
    clearTimeout(blurTimer);
    clearInterval(pointerTimer);
    savePreferences();
  });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    media.close();
    foreground.close();
    store?.close();
  });
  app.whenReady().then(start).catch(error => {
    console.error(error);
    dialog.showErrorBox('无法启动归序', error.message);
    app.quit();
  });
}

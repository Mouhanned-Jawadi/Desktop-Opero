/**
 * Opero Desktop — Electron Main Process
 *
 * Responsibilities:
 *  - Spin up the local Express server (serves React build + proxies API)
 *  - Create and manage the BrowserWindow
 *  - System tray integration
 *  - Native application menu
 *  - Window state persistence (position, size, maximised)
 *  - IPC handlers for renderer requests
 */

require('dotenv').config();

const {
    app,
    BrowserWindow,
    shell,
    Menu,
    Tray,
    dialog,
    ipcMain,
    nativeImage,
    session
} = require('electron');
const path  = require('path');
const fs    = require('fs');
const { startServer, stopServer } = require('./server');

// ── Constants ────────────────────────────────────────────────────────────────

const isDev        = process.argv.includes('--dev');
const ICON_PATH    = path.join(__dirname, 'assets', 'icon.png');
const TRAY_PATH    = path.join(__dirname, 'assets', 'tray-icon.png');
const STATE_FILE   = path.join(app.getPath('userData'), 'window-state.json');

// ── Window state helpers ──────────────────────────────────────────────────────

function loadWindowState () {
    try {
        if (fs.existsSync(STATE_FILE)) {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        }
    } catch { /* ignore */ }
    return { width: 1440, height: 900, isMaximized: false };
}

function saveWindowState (win) {
    try {
        const state = win.isMaximized()
            ? { ...loadWindowState(), isMaximized: true }
            : { ...win.getBounds(), isMaximized: false };
        fs.writeFileSync(STATE_FILE, JSON.stringify(state));
    } catch { /* ignore */ }
}

// ── Globals ──────────────────────────────────────────────────────────────────

let mainWindow    = null;
let tray          = null;
let serverPort    = null;
app.isQuitting    = false;

// ── Single instance lock ──────────────────────────────────────────────────────

if (!app.requestSingleInstanceLock()) {
    app.quit();
    process.exit(0);
}

app.on('second-instance', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    }
});

// ── Security: disable navigation to external origins ────────────────────────

app.on('web-contents-created', (_, contents) => {
    contents.on('will-navigate', (e, url) => {
        const allowed = [
            `http://localhost:${serverPort}`,
            `http://127.0.0.1:${serverPort}`,
            'https://www.opero.cloud-ip.cc',
            'https://accounts.google.com',
            'https://oauth2.googleapis.com',
            'https://www.googleapis.com',
            'https://apis.google.com',
        ];
        if (!allowed.some(a => url.startsWith(a))) {
            e.preventDefault();
            shell.openExternal(url);
        }
    });
});

// ── Create main window ────────────────────────────────────────────────────────

async function createWindow () {
    // Start local server first so we know the port
    serverPort = await startServer(isDev);

    const state   = loadWindowState();
    const appIcon = nativeImage.createFromPath(ICON_PATH);

    mainWindow = new BrowserWindow({
        width     : state.width  || 1440,
        height    : state.height || 900,
        x         : state.x,
        y         : state.y,
        minWidth  : 1100,
        minHeight : 700,
        title     : 'Opero',
        icon      : appIcon,
        show      : false,          // shown after ready-to-show
        backgroundColor: '#f8fafc',
        webPreferences: {
            preload            : path.join(__dirname, 'preload.js'),
            contextIsolation   : true,
            nodeIntegration    : false,
            webSecurity        : true,
            sandbox            : false,
            spellcheck         : false,
        }
    });

    if (state.isMaximized) mainWindow.maximize();

    // ── F12 toggles DevTools in any mode (useful for diagnosing issues) ────
    mainWindow.webContents.on('before-input-event', (_, input) => {
        if (input.key === 'F12' && input.type === 'keyDown') {
            if (mainWindow.webContents.isDevToolsOpened()) {
                mainWindow.webContents.closeDevTools();
            } else {
                mainWindow.webContents.openDevTools({ mode: 'detach' });
            }
        }
    });

    // ── Load the app ────────────────────────────────────────────────────────
    mainWindow.loadURL(`http://localhost:${serverPort}`);

    // ── Show once the DOM is ready ──────────────────────────────────────────
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
    });

    // ── Open external links in the default browser ──────────────────────────
    // Allow Google OAuth popups to open inside Electron so the credential
    // callback can fire back to the renderer page.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (
            url.startsWith('https://accounts.google.com') ||
            url.startsWith('https://oauth2.googleapis.com') ||
            url.startsWith('https://www.googleapis.com')
        ) {
            return { action: 'allow' };
        }
        shell.openExternal(url);
        return { action: 'deny' };
    });

    // ── Persist window state ────────────────────────────────────────────────
    ['resize', 'move', 'close'].forEach(ev => {
        mainWindow.on(ev, () => saveWindowState(mainWindow));
    });

    // ── Minimise to tray on close ───────────────────────────────────────────
    mainWindow.on('close', (e) => {
        if (!app.isQuitting) {
            e.preventDefault();
            mainWindow.hide();
            // First-time notification
            if (!loadWindowState()._trayNotified) {
                tray.displayBalloon({
                    title  : 'Opero is still running',
                    content: 'Opero is running in the background. Right-click the tray icon to quit.',
                    iconType: 'info',
                });
                const s = loadWindowState();
                s._trayNotified = true;
                try { fs.writeFileSync(STATE_FILE, JSON.stringify(s)); } catch {}
            }
        }
    });

    mainWindow.on('closed', () => { mainWindow = null; });

    setupTray();
    setupMenu();
}

// ── System tray ───────────────────────────────────────────────────────────────

function setupTray () {
    const icon = nativeImage.createFromPath(TRAY_PATH).resize({ width: 16, height: 16 });
    tray = new Tray(icon);
    tray.setToolTip('Opero — Workspace Management');

    const menu = Menu.buildFromTemplate([
        {
            label: 'Open Opero',
            click: () => { mainWindow?.show(); mainWindow?.focus(); }
        },
        { type: 'separator' },
        {
            label: 'Reload',
            click: () => mainWindow?.webContents.reload()
        },
        { type: 'separator' },
        {
            label: 'Quit Opero',
            click: () => { app.isQuitting = true; app.quit(); }
        }
    ]);

    tray.setContextMenu(menu);
    tray.on('click',        () => { mainWindow?.show(); mainWindow?.focus(); });
    tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

// ── Application menu ──────────────────────────────────────────────────────────

function setupMenu () {
    const template = [
        {
            label  : 'Opero',
            submenu: [
                {
                    label: 'About Opero',
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type   : 'info',
                            title  : 'About Opero',
                            message: 'Opero Desktop',
                            detail : `Version ${app.getVersion()}\nWorkspace Management Platform\n\n© 2026 Opero\nhttps://www.opero.cloud-ip.cc`,
                            buttons: ['OK'],
                            icon   : nativeImage.createFromPath(ICON_PATH)
                        });
                    }
                },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { type: 'separator' },
                {
                    label      : 'Quit',
                    accelerator: 'CmdOrCtrl+Q',
                    click      : () => { app.isQuitting = true; app.quit(); }
                }
            ]
        },
        {
            label  : 'Edit',
            submenu: [
                { role: 'undo' }, { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
                { role: 'selectAll' }
            ]
        },
        {
            label  : 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                ...(isDev ? [{ role: 'toggleDevTools' }] : []),
                { type: 'separator' },
                { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label  : 'Window',
            submenu: [
                { role: 'minimize' },
                { role: 'zoom' },
                { type: 'separator' },
                {
                    label      : 'Open in Browser',
                    accelerator: 'CmdOrCtrl+Shift+O',
                    click      : () => shell.openExternal(`http://localhost:${serverPort}`)
                }
            ]
        },
        {
            label  : 'Help',
            submenu: [
                {
                    label: 'Visit opero.cloud-ip.cc',
                    click: () => shell.openExternal('https://www.opero.cloud-ip.cc')
                },
                { type: 'separator' },
                {
                    label: 'Check for Updates…',
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type   : 'info',
                            title  : 'No Updates',
                            message: 'You are running the latest version of Opero Desktop.',
                            buttons: ['OK']
                        });
                    }
                }
            ]
        }
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('get-app-version',  ()  => app.getVersion());
ipcMain.handle('get-backend-url',  ()  => process.env.OPERO_BACKEND_URL || 'https://www.opero.cloud-ip.cc');
ipcMain.handle('get-server-port',  ()  => serverPort);
ipcMain.handle('open-external',    (_, url) => shell.openExternal(url));

ipcMain.handle('show-notification', (_, { title, body }) => {
    if (tray) {
        tray.displayBalloon({ title, content: body, iconType: 'info' });
    }
});

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        // On Windows / Linux we keep running in tray, not quitting.
        // The app.isQuitting flag gates actual quit.
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    } else {
        mainWindow?.show();
        mainWindow?.focus();
    }
});

app.on('before-quit', () => {
    app.isQuitting = true;
    stopServer();
});

/**
 * Opero Desktop — Preload Script
 *
 * Runs in a privileged context before the renderer page loads.
 * Uses contextBridge to expose a safe, minimal API to the renderer
 * without enabling nodeIntegration.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    /** Whether the app is running inside Electron */
    isElectron  : true,

    /** Current OS platform: 'win32' | 'darwin' | 'linux' */
    platform    : process.platform,

    /** Semantic version string of the packaged app */
    getVersion  : () => ipcRenderer.invoke('get-app-version'),

    /** The backend base URL configured in .env */
    getBackendUrl : () => ipcRenderer.invoke('get-backend-url'),

    /** The local server port (for debugging) */
    getServerPort : () => ipcRenderer.invoke('get-server-port'),

    /** Open a URL in the OS default browser */
    openExternal  : (url) => ipcRenderer.invoke('open-external', url),

    /** Show a Windows balloon notification via the system tray */
    showNotification : ({ title, body }) =>
        ipcRenderer.invoke('show-notification', { title, body })
});

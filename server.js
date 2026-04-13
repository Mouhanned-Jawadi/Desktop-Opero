/**
 * Opero Desktop — Local Express Server
 *
 * Starts on a random free port and:
 *  1. Serves the React SPA from ./build/ (static files)
 *  2. Proxies /api/* → OPERO_BACKEND_URL  (REST API)
 *  3. Proxies /socket.io/* → OPERO_BACKEND_URL  (WebSocket)
 *
 * This means the React app never knows it's inside Electron — it behaves
 * exactly like a normal web deployment.
 */

require('dotenv').config();

const express               = require('express');
const path                  = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

let httpServer = null;

/**
 * Starts the local server.
 * @param {boolean} isDev  - When true, points backend at localhost:5000
 * @returns {Promise<number>}  The port the server is listening on
 */
const startServer = (isDev = false) => {
    return new Promise((resolve, reject) => {
        const BACKEND_URL =
            process.env.OPERO_BACKEND_URL ||
            (isDev
                ? 'http://localhost:5000'
                : 'https://back-opero-production.up.railway.app');

        console.log(`[Opero Server] Backend target: ${BACKEND_URL}`);

        const expressApp = express();

        // ── API proxy ────────────────────────────────────────────────────────
        // IMPORTANT: use pathFilter here (not app.use('/api', proxy)).
        // When Express mounts middleware with app.use('/api', ...) it strips
        // the '/api' prefix before the proxy sees the path, so
        // POST /api/auth/login becomes POST /auth/login on the backend → 404.
        // pathFilter lets the proxy do its own matching without stripping.
        const apiProxy = createProxyMiddleware({
            pathFilter   : '/api',
            target       : BACKEND_URL,
            changeOrigin : true,
            secure       : true,
            on: {
                error: (err, req, res) => {
                    console.error('[Proxy] API error:', err.message);
                    if (!res.headersSent) {
                        res.status(502).json({ message: 'Backend unreachable. Please check your connection.' });
                    }
                }
            }
        });

        // ── Socket.IO proxy ──────────────────────────────────────────────────
        const socketProxy = createProxyMiddleware({
            pathFilter   : '/socket.io',
            target       : BACKEND_URL,
            changeOrigin : true,
            secure       : true,
            ws           : true,            // upgrade WebSocket connections
            on: {
                error: (err) => console.error('[Proxy] Socket.IO error:', err.message)
            }
        });

        // Mount both proxies at root so path prefixes are preserved
        expressApp.use(apiProxy);
        expressApp.use(socketProxy);

        // ── Serve React SPA ──────────────────────────────────────────────────
        const buildPath = path.join(__dirname, 'build');
        expressApp.use(express.static(buildPath, {
            maxAge : '1d',          // cache static assets for 1 day
            etag   : true
        }));

        // SPA fallback — all unmatched routes serve index.html
        expressApp.get('*', (req, res) => {
            res.sendFile(path.join(buildPath, 'index.html'));
        });

        // ── Listen on a fixed port (required for Google OAuth origin registration) ─
        // Bind to all interfaces (not just 127.0.0.1) so that both the IPv4
        // loopback (127.0.0.1) and the IPv6 loopback (::1) are covered.
        // Windows 11 resolves "localhost" to ::1 by default, which would cause
        // connection-refused errors if we only bound to 127.0.0.1.
        const PORT = parseInt(process.env.OPERO_LOCAL_PORT || '4242', 10);
        httpServer = expressApp.listen(PORT, () => {
            const { port } = httpServer.address();
            console.log(`[Opero Server] Listening on http://localhost:${port}`);
            resolve(port);
        });

        httpServer.on('error', (err) => {
            console.error('[Opero Server] Failed to start:', err.message);
            reject(err);
        });

        // Forward WebSocket upgrade events to the socket.io proxy
        httpServer.on('upgrade', socketProxy.upgrade);
    });
};

const stopServer = () => {
    if (httpServer) {
        httpServer.close();
        httpServer = null;
        console.log('[Opero Server] Stopped');
    }
};

module.exports = { startServer, stopServer };

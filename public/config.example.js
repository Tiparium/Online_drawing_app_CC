// Example frontend runtime configuration.
// Copy to public/config.js (or let deploy.sh generate it) and set API_BASE/WS_BASE to your backend URL.
window.__CONFIG = {
  API_BASE: 'https://your-backend.example.com', // where /api/* lives
  WS_BASE: 'wss://your-backend.example.com'     // websocket endpoint (leave blank to use same-origin)
};
// Legacy globals still respected
window.__API_BASE = window.__CONFIG.API_BASE;
window.__WS_BASE = window.__CONFIG.WS_BASE;

const { createProxyMiddleware } = require('http-proxy-middleware');

/**
 * CRA's package.json "proxy" uses a short default socket timeout.
 * Review / export endpoints can take longer while Mongo streams large Detection docs.
 */
module.exports = function setupProxy(app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://localhost:5001',
      changeOrigin: true,
      timeout: 900000,
      proxyTimeout: 900000
    })
  );
};

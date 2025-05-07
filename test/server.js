
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const app = express();
const PORT = 3000;

// ESP32-CAM stream URL
const ESP32_STREAM_URL = 'http://192.168.4.1';

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Proxy the ESP32 stream requests
app.use('/stream', createProxyMiddleware({
  target: ESP32_STREAM_URL,
  changeOrigin: true,
  pathRewrite: {
    '^/stream': '/stream' // keep the /stream path when forwarding
  },
  onError: (err, req, res) => {
    console.error('Proxy error:', err);
    res.status(500).send('Error connecting to ESP32-CAM stream');
  }
}));

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Make sure your computer is connected to the ESP32-CAM WiFi network`);
});
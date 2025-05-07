const express = require('express');
const path = require('path');
const http = require('http');

const app = express();
const PORT = 3000;

// ESP32-CAM stream URL
const ESP32_STREAM_URL = 'http://192.168.4.1/stream';

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Stream endpoint - handle the ESP32-CAM stream directly
app.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'multipart/x-mixed-replace; boundary=frame');
  
  // Create HTTP request to ESP32-CAM
  const streamReq = http.get(ESP32_STREAM_URL, (streamRes) => {
    // Forward the headers that we want to keep
    res.setHeader('Content-Type', streamRes.headers['content-type']);
    
    // Pipe the stream directly to our response
    streamRes.pipe(res);
    
    // Handle errors from the ESP32-CAM stream
    streamRes.on('error', (err) => {
      console.error('Stream error:', err);
      if (!res.headersSent) {
        res.status(500).send('Error connecting to ESP32-CAM stream');
      }
    });
  });
  
  // Handle errors with the ESP32-CAM connection
  streamReq.on('error', (err) => {
    console.error('Connection error:', err);
    if (!res.headersSent) {
      res.status(500).send('Error connecting to ESP32-CAM stream');
    }
  });
  
  // Clean up when client disconnects
  req.on('close', () => {
    streamReq.destroy();
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Make sure your computer is connected to the ESP32-CAM WiFi network`);
});
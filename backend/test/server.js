const express = require('express');
const path = require('path');
const http = require('http');

const app = express();
const PORT = 3000;

// ESP32-CAM stream URL
const ESP32_STREAM_URL = 'http://192.168.4.1/stream';

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Store connected clients
const clients = new Set();
let streamConnection = null;
let reconnectTimer = null;
const RECONNECT_DELAY = 5000; // 5 seconds

// Connect to ESP32-CAM stream
function connectToStream() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  console.log('Connecting to ESP32-CAM stream...');
  
  const request = http.get(ESP32_STREAM_URL, (response) => {
    console.log('Connected to ESP32-CAM stream');
    
    if (response.statusCode !== 200) {
      console.error(`Unexpected status code: ${response.statusCode}`);
      scheduleReconnect();
      return;
    }

    const contentType = response.headers['content-type'];
    if (!contentType || !contentType.includes('multipart/x-mixed-replace')) {
      console.error(`Unexpected content type: ${contentType}`);
      scheduleReconnect();
      return;
    }

    streamConnection = response;
    
    let buffer = Buffer.alloc(0);
    const boundary = contentType.split('boundary=')[1];
    const boundaryBuffer = Buffer.from(`\r\n--${boundary}\r\n`);
    let headersSent = false;
    
    response.on('data', (chunk) => {
      // Append new data to buffer
      buffer = Buffer.concat([buffer, chunk]);
      
      // Find the boundary markers and extract frames
      let boundaryIndex;
      while ((boundaryIndex = buffer.indexOf(boundaryBuffer)) !== -1) {
        const frameData = buffer.slice(0, boundaryIndex + boundaryBuffer.length);
        buffer = buffer.slice(boundaryIndex + boundaryBuffer.length);
        
        // Send frame to all connected clients
        for (const client of clients) {
          if (!headersSent && client.writable) {
            client.setHeader('Content-Type', `multipart/x-mixed-replace; boundary=${boundary}`);
            headersSent = true;
          }
          if (client.writable) {
            client.write(frameData);
          }
        }
      }
    });
    
    response.on('error', (err) => {
      console.error('Stream error:', err);
      scheduleReconnect();
    });
    
    response.on('end', () => {
      console.log('Stream ended');
      scheduleReconnect();
    });
  });
  
  request.on('error', (err) => {
    console.error('Connection error:', err);
    scheduleReconnect();
  });
  
  streamConnection = request;
}

function scheduleReconnect() {
  if (streamConnection) {
    streamConnection.destroy();
    streamConnection = null;
  }
  
  if (!reconnectTimer) {
    console.log(`Scheduling reconnect in ${RECONNECT_DELAY}ms`);
    reconnectTimer = setTimeout(connectToStream, RECONNECT_DELAY);
  }
}

// Connect to the stream when server starts
connectToStream();

// Stream endpoint - broadcast to client
app.get('/stream', (req, res) => {
  console.log('New client connected');
  
  // Add this client to our set
  clients.add(res);
  
  // Set proper headers for MJPEG stream
  res.setHeader('Cache-Control', 'no-cache, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Connection', 'close');
  
  // If we're not currently connected to the stream, try to reconnect
  if (!streamConnection) {
    connectToStream();
  }
  
  // When client disconnects, remove from client list
  req.on('close', () => {
    console.log('Client disconnected');
    clients.delete(res);
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Make sure your computer is connected to the ESP32-CAM WiFi network`);
});
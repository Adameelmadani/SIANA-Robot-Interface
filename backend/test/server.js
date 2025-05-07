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

// Store the latest boundary and frame data
let currentBoundary = '';
let currentFrameBuffer = Buffer.alloc(0);
let isConnectedToCamera = false;

// Connect to ESP32-CAM stream
function connectToStream() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  console.log('Connecting to ESP32-CAM stream...');
  isConnectedToCamera = false;
  
  const request = http.get(ESP32_STREAM_URL, (response) => {
    console.log('Connected to ESP32-CAM stream:', response.statusCode);
    
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
    isConnectedToCamera = true;
    
    // Extract boundary from content-type header
    currentBoundary = contentType.split('boundary=')[1];
    console.log(`Stream boundary: ${currentBoundary}`);
    
    let buffer = Buffer.alloc(0);
    
    response.on('data', (chunk) => {
      // Append new data to buffer
      buffer = Buffer.concat([buffer, chunk]);
      
      // Process the buffer to find frames
      processBuffer(buffer).then(remaining => {
        buffer = remaining;
      }).catch(err => {
        console.error('Error processing buffer:', err);
      });
    });
    
    response.on('error', (err) => {
      console.error('Stream error:', err);
      isConnectedToCamera = false;
      scheduleReconnect();
    });
    
    response.on('end', () => {
      console.log('Stream ended');
      isConnectedToCamera = false;
      scheduleReconnect();
    });
  });
  
  request.on('error', (err) => {
    console.error('Connection error:', err);
    isConnectedToCamera = false;
    scheduleReconnect();
  });
  
  streamConnection = request;
}

async function processBuffer(buffer) {
  if (!currentBoundary) return buffer;
  
  const boundaryTag = `--${currentBoundary}`;
  const startBoundaryPattern = Buffer.from(`\r\n${boundaryTag}`);
  const endBoundaryPattern = Buffer.from(`${boundaryTag}--`);
  
  let startIdx = buffer.indexOf(startBoundaryPattern);
  
  if (startIdx === -1) {
    // No boundary found, keep the entire buffer for next time
    return buffer;
  }
  
  // We found a boundary, let's extract the frame
  const frameStart = startIdx + startBoundaryPattern.length;
  
  // Look for the next boundary or end boundary
  let nextStartIdx = buffer.indexOf(startBoundaryPattern, frameStart);
  const endIdx = buffer.indexOf(endBoundaryPattern, frameStart);
  
  if (nextStartIdx === -1 && endIdx === -1) {
    // No end of frame yet, keep everything
    return buffer;
  }
  
  let frameEnd;
  if (endIdx !== -1 && (nextStartIdx === -1 || endIdx < nextStartIdx)) {
    // We found an end boundary
    frameEnd = endIdx;
  } else {
    // We found the next start boundary
    frameEnd = nextStartIdx;
  }
  
  // Extract the frame data (including headers)
  const frameData = buffer.slice(frameStart, frameEnd);
  
  // Store the current frame
  currentFrameBuffer = Buffer.concat([
    Buffer.from(`--${currentBoundary}\r\n`),
    frameData
  ]);
  
  // Send this frame to all connected clients
  for (const client of clients) {
    if (client.writable) {
      client.write(currentFrameBuffer);
    }
  }
  
  // Return the buffer after this frame for further processing
  return buffer.slice(frameEnd);
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
  
  // Set proper headers for MJPEG stream
  res.writeHead(200, {
    'Cache-Control': 'no-cache, private',
    'Pragma': 'no-cache',
    'Connection': 'close',
    'Content-Type': `multipart/x-mixed-replace; boundary=${currentBoundary}`
  });
  
  // If we have a current frame, send it immediately
  if (currentFrameBuffer.length > 0 && isConnectedToCamera) {
    res.write(currentFrameBuffer);
  }
  
  // Add this client to our set
  clients.add(res);
  
  // If we're not currently connected to the stream, try to reconnect
  if (!streamConnection || !isConnectedToCamera) {
    connectToStream();
  }
  
  // When client disconnects, remove from client list
  req.on('close', () => {
    console.log('Client disconnected');
    clients.delete(res);
  });
});

// API endpoint to check camera status
app.get('/api/status', (req, res) => {
  res.json({
    connected: isConnectedToCamera,
    clientCount: clients.size
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Make sure your computer is connected to the ESP32-CAM WiFi network`);
});
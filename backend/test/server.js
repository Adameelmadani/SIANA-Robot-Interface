const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static client page
app.use(express.static('public'));

// Connected clients
const clients = new Set();

// Connect to ESP32-CAM stream and forward frames
async function streamCamera() {
  try {
    console.log('Connecting to ESP32-CAM stream...');
    const response = await fetch('http://192.168.4.1/stream');
    
    if (!response.ok) {
      throw new Error(`Failed to connect to camera: ${response.statusText}`);
    }
    
    console.log('Connected to camera stream');
    
    const reader = response.body.getReader();
    
    // MJPEG stream boundary detection variables
    const boundary = Buffer.from('\r\n--frame\r\n');
    let buffer = Buffer.alloc(0);
    
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        console.log('Stream ended');
        break;
      }
      
      // Append new data to buffer
      buffer = Buffer.concat([buffer, Buffer.from(value)]);
      
      // Find frame boundaries
      let boundaryIndex;
      while ((boundaryIndex = buffer.indexOf(boundary)) !== -1) {
        // Extract frame
        const frame = buffer.slice(0, boundaryIndex);
        
        // Remove processed frame from buffer
        buffer = buffer.slice(boundaryIndex + boundary.length);
        
        // Check if it's a valid JPEG and has content-type header
        if (frame.includes('Content-Type: image/jpeg')) {
          // Find the start of actual JPEG data (after headers)
          const jpegStart = frame.indexOf('\r\n\r\n');
          if (jpegStart !== -1) {
            const jpegData = frame.slice(jpegStart + 4);
            
            // Send to all connected clients
            clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(jpegData);
              }
            });
          }
        }
      }
    }
  } catch (error) {
    console.error('Stream error:', error);
    // Try to reconnect after delay
    setTimeout(streamCamera, 5000);
  }
}

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('Client connected');
  clients.add(ws);
  
  ws.on('close', () => {
    console.log('Client disconnected');
    clients.delete(ws);
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // Start streaming
  streamCamera();
});
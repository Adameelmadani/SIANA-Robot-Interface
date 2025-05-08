/**
 * ESP32-CAM Stream Relay Test
 * 
 * This script demonstrates how to connect to an ESP32-CAM stream
 * and relay it to multiple clients through a Node.js server.
 */

const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const EventEmitter = require('events');

// Create express app and http server
const app = express();
const server = http.createServer(app);
const PORT = 3030;

// Serve a simple test page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>ESP32-CAM Stream Relay Test</title>
      <style>
        body { font-family: Arial, sans-serif; text-align: center; }
        #stream-container { margin: 20px auto; max-width: 640px; }
        #status { margin: 10px 0; color: #666; }
        img { width: 100%; border: 1px solid #ddd; }
      </style>
    </head>
    <body>
      <h1>ESP32-CAM Stream Relay Test</h1>
      <div id="status">Connecting to server...</div>
      <div id="stream-container">
        <img id="stream" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" />
      </div>
      
      <script>
        const ws = new WebSocket(\`ws://\${window.location.hostname}:\${window.location.port}/stream\`);
        const img = document.getElementById('stream');
        const status = document.getElementById('status');
        
        ws.onopen = () => {
          status.textContent = 'Connected to server, waiting for stream...';
          status.style.color = '#008800';
        };
        
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'frame') {
              img.src = \`data:image/jpeg;base64,\${data.data}\`;
              status.textContent = 'Streaming';
            } else if (data.type === 'status') {
              status.textContent = data.message;
              status.style.color = data.connected ? '#008800' : '#880000';
            }
          } catch (e) {
            console.error('Error parsing message:', e);
          }
        };
        
        ws.onclose = () => {
          status.textContent = 'Connection closed';
          status.style.color = '#880000';
        };
        
        ws.onerror = () => {
          status.textContent = 'Connection error';
          status.style.color = '#880000';
        };
      </script>
    </body>
    </html>
  `);
});

// WebSocket server
const wss = new WebSocket.Server({ server, path: '/stream' });

// Store client connections
const clients = new Set();

// Handle new WebSocket connections
wss.on('connection', (ws) => {
  console.log('New client connected');
  clients.add(ws);
  
  // Send initial status
  ws.send(JSON.stringify({
    type: 'status',
    connected: cameraRelay.isConnected(),
    message: cameraRelay.isConnected() ? 'Connected to camera' : 'Connecting to camera...'
  }));
  
  ws.on('close', () => {
    console.log('Client disconnected');
    clients.delete(ws);
  });
});

// Camera Stream Relay implementation
class CameraStreamRelay extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.connectionAttempts = 0;
    this.maxAttempts = 20;
    this.streamRequest = null;
    this.connectionTimeout = null;
    this.esp32CamIp = '192.168.4.1'; // Default ESP32-CAM IP address
  }
  
  connect(ipAddress) {
    if (ipAddress) {
      this.esp32CamIp = ipAddress;
    }
    
    if (this.connectionAttempts >= this.maxAttempts) {
      console.log('Max connection attempts reached. Stopping attempts.');
      return;
    }
    
    console.log(`Connecting to ESP32-CAM at http://${this.esp32CamIp}/stream`);
    this.connectionAttempts++;
    
    // Clear any existing connection
    this.disconnect();
    
    // Set a timeout for connection
    this.connectionTimeout = setTimeout(() => {
      console.log('Connection timeout');
      this.disconnect();
      setTimeout(() => this.connect(), 5000);
    }, 10000);
    
    // Connect to the MJPEG stream
    this.streamRequest = http.get(`http://${this.esp32CamIp}/stream`, (res) => {
      clearTimeout(this.connectionTimeout);
      
      if (res.statusCode !== 200) {
        console.error(`Failed to connect to stream: ${res.statusCode}`);
        setTimeout(() => this.connect(), 5000);
        return;
      }
      
      console.log('Connected to ESP32-CAM stream');
      this.connected = true;
      this.connectionAttempts = 0;
      
      // Notify clients of successful connection
      this.broadcastStatus(true, 'Connected to camera');
      
      // Get boundary from content-type header
      const boundary = this.getBoundary(res.headers['content-type']);
      if (!boundary) {
        console.error('Could not find boundary in Content-Type header');
        this.disconnect();
        return;
      }
      
      // Process the MJPEG stream
      this.processMjpegStream(res, boundary);
    });
    
    this.streamRequest.on('error', (err) => {
      clearTimeout(this.connectionTimeout);
      console.error('Error connecting to ESP32-CAM:', err.message);
      this.connected = false;
      
      // Notify clients of disconnection
      this.broadcastStatus(false, 'Connection to camera failed');
      
      // Try to reconnect after delay
      setTimeout(() => this.connect(), 5000);
    });
  }
  
  disconnect() {
    if (this.streamRequest) {
      this.streamRequest.destroy();
      this.streamRequest = null;
    }
    
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    
    if (this.connected) {
      this.connected = false;
      this.broadcastStatus(false, 'Disconnected from camera');
    }
  }
  
  isConnected() {
    return this.connected;
  }
  
  getBoundary(contentType) {
    if (!contentType) return null;
    const matches = contentType.match(/boundary=([^\s;]+)/i);
    return matches ? matches[1] : 'frame'; // Default to 'frame' if not found
  }
  
  processMjpegStream(stream, boundary) {
    let buffer = Buffer.alloc(0);
    const boundaryBuffer = Buffer.from(`--${boundary}\r\n`, 'utf8');
    const endMarkerBuffer = Buffer.from('\r\n\r\n', 'utf8');
    
    stream.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      
      let startMarkerIndex;
      while ((startMarkerIndex = buffer.indexOf(boundaryBuffer)) !== -1) {
        // Found the start of a frame
        buffer = buffer.slice(startMarkerIndex + boundaryBuffer.length);
        
        // Find the header end
        const headerEndIndex = buffer.indexOf(endMarkerBuffer);
        if (headerEndIndex === -1) continue;
        
        // Extract the Content-Length from headers
        const headers = buffer.slice(0, headerEndIndex).toString();
        const contentLengthMatch = headers.match(/Content-Length:\s*(\d+)/i);
        if (!contentLengthMatch) continue;
        
        const contentLength = parseInt(contentLengthMatch[1], 10);
        
        // Check if we have the complete frame
        const frameStartIndex = headerEndIndex + endMarkerBuffer.length;
        if (buffer.length >= frameStartIndex + contentLength) {
          // Extract the frame
          const frameBuffer = buffer.slice(frameStartIndex, frameStartIndex + contentLength);
          
          // Send the frame to all connected clients
          this.broadcastFrame(frameBuffer);
          
          // Remove the processed frame from buffer
          buffer = buffer.slice(frameStartIndex + contentLength);
        } else {
          // Incomplete frame, wait for more data
          break;
        }
      }
    });
    
    stream.on('error', (err) => {
      console.error('Stream error:', err.message);
      this.disconnect();
      setTimeout(() => this.connect(), 5000);
    });
    
    stream.on('end', () => {
      console.log('Stream ended');
      this.disconnect();
      setTimeout(() => this.connect(), 5000);
    });
  }
  
  broadcastFrame(frameBuffer) {
    const frameBase64 = frameBuffer.toString('base64');
    
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'frame',
          data: frameBase64
        }));
      }
    });
  }
  
  broadcastStatus(connected, message) {
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'status',
          connected: connected,
          message: message
        }));
      }
    });
  }
}

// Create and start the camera relay
const cameraRelay = new CameraStreamRelay();

// Start the server
server.listen(PORT, () => {
  console.log(`ESP32-CAM Stream Relay Test running at http://localhost:${PORT}`);
  console.log(`WebSocket server running at ws://localhost:${PORT}/stream`);
  
  // Connect to the ESP32-CAM
  cameraRelay.connect();
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  cameraRelay.disconnect();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
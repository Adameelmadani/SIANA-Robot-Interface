const express = require('express');
const http = require('http');
const cors = require('cors');
const morgan = require('morgan');
const { PassThrough } = require('stream');

// Create Express app
const app = express();
app.use(cors());
app.use(morgan('dev')); // Logging middleware

// Create a stream PassThrough to hold our camera stream
const cameraStream = new PassThrough();

// Store the latest frame for clients that connect later
let latestFrame = Buffer.from([]);
let boundaryString = '';
let isFirstChunk = true;
let cameraConnected = false;
let lastCameraActivity = Date.now();
const connectionTimeout = 10000; // 10 seconds

// Increase raw body limit and add better error handling
app.use(express.raw({
  type: 'multipart/x-mixed-replace',
  limit: '100mb', // Increased limit for larger frame sizes
  inflate: true,
  verify: (req, res, buf, encoding) => {
    // Add verification function to handle aborted requests better
    req.rawBody = buf;
  }
}));

// Disable timeout for streaming connections
app.use((req, res, next) => {
  if (req.path === '/stream' || req.path === '/view') {
    req.setTimeout(0);
    res.setTimeout(0);
  }
  next();
});

// Improved middleware to handle raw data for the stream
app.use('/stream', (req, res, next) => {
  if (req.method === 'POST') {
    // Mark camera as connected
    if (!cameraConnected) {
      console.log('ESP32-CAM connected');
      cameraConnected = true;
    }
    
    // Update last activity timestamp
    lastCameraActivity = Date.now();
    
    // Handle aborted connections more gracefully
    req.on('aborted', () => {
      console.log('Request aborted by ESP32-CAM');
      cameraConnected = false;
      // Don't call next() to prevent the error from bubbling up
    });
    
    // Set up chunked transfer for incoming data
    req.on('data', (chunk) => {
      // Process incoming data from ESP32-CAM
      if (isFirstChunk) {
        console.log('First chunk received, size:', chunk.length);
        // Extract boundary from first chunk if present
        const headerText = chunk.toString();
        const boundaryMatch = headerText.match(/boundary=(.+)/);
        if (boundaryMatch && boundaryMatch[1]) {
          boundaryString = boundaryMatch[1];
          console.log(`Boundary detected: ${boundaryString}`);
        }
        isFirstChunk = false;
      }
      
      // Push to the stream for real-time clients
      try {
        cameraStream.write(chunk);
      } catch (err) {
        console.error('Error writing to stream:', err);
      }
      
      // Store latest frame data (using a fixed size buffer approach)
      try {
        latestFrame = Buffer.concat([latestFrame, chunk]);
        // Prevent memory issues by limiting buffer size
        if (latestFrame.length > 5 * 1024 * 1024) { // 5MB limit
          latestFrame = latestFrame.slice(-1 * 1024 * 1024); // Keep last 1MB
        }
      } catch (err) {
        console.error('Error storing frame data:', err);
      }
    });
    
    req.on('end', () => {
      console.log('ESP32-CAM stream ended');
      cameraConnected = false;
      next();
    });
    
    req.on('error', (err) => {
      console.error('Stream error:', err);
      cameraConnected = false;
      next(err);
    });
    
    // Keep the connection alive
    res.writeHead(200, {
      'Connection': 'keep-alive',
      'Content-Type': 'text/plain',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no' // Disable proxy buffering
    });
    
    // Send periodic keep-alive responses
    const keepAliveInterval = setInterval(() => {
      try {
        if (!res.finished) {
          res.write(' '); // Send a space character as keep-alive
        } else {
          clearInterval(keepAliveInterval);
        }
      } catch (e) {
        clearInterval(keepAliveInterval);
      }
    }, 5000);
    
    req.on('close', () => {
      clearInterval(keepAliveInterval);
      cameraConnected = false;
      console.log('ESP32-CAM disconnected');
    });
  } else {
    next();
  }
});

// Route to receive the stream from ESP32-CAM
app.post('/stream', (req, res) => {
  // This is intentionally left empty as the middleware does all the work
  // and keeps the connection open with keep-alive packets
});

// Connection monitoring
setInterval(() => {
  const now = Date.now();
  if (cameraConnected && (now - lastCameraActivity > connectionTimeout)) {
    console.log('Camera connection timed out');
    cameraConnected = false;
  }
}, 5000);

// Route to serve the stream to clients
app.get('/view', (req, res) => {
  // Disable timeout and keep connection alive
  req.socket.setTimeout(0);
  res.connection.setTimeout(0);
  
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
    'Cache-Control': 'no-cache, no-store, max-age=0, must-revalidate',
    'Pragma': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // Disable nginx buffering
  });
  
  // Send the latest frame to new connections immediately
  if (latestFrame.length > 0) {
    try {
      res.write(latestFrame);
    } catch (err) {
      console.error('Error sending initial frame:', err);
    }
  }
  
  // Create a separate stream for this client
  const clientStream = new PassThrough();
  
  // Pipe camera stream to this client's stream
  const pipeStream = cameraStream.pipe(clientStream);
  
  // Handle data for this specific client
  clientStream.on('data', (chunk) => {
    try {
      if (!res.finished) {
        res.write(chunk);
      }
    } catch (err) {
      console.error('Error writing to client:', err);
      cleanup();
    }
  });
  
  // Cleanup function for when client disconnects
  const cleanup = () => {
    try {
      clientStream.destroy();
      pipeStream.destroy();
    } catch (err) {
      console.error('Error during cleanup:', err);
    }
  };
  
  // Handle client disconnect
  req.on('close', () => {
    console.log('Client disconnected from stream');
    cleanup();
  });
  
  req.on('error', (err) => {
    console.error('Client error:', err);
    cleanup();
  });
  
  // Monitor connection and send periodic keep-alive
  const clientKeepAlive = setInterval(() => {
    try {
      if (!res.finished) {
        res.write('\r\n'); // Send empty line as keep-alive
      } else {
        clearInterval(clientKeepAlive);
      }
    } catch (e) {
      clearInterval(clientKeepAlive);
    }
  }, 20000);
});

// Route to get the latest JPEG frame
app.get('/snapshot', (req, res) => {
  if (latestFrame.length > 0) {
    try {
      // Parse the multipart data to extract just the JPEG
      const frameString = latestFrame.toString();
      const contentTypeMatch = frameString.match(/Content-Type: image\/jpeg\r\n\r\n([\s\S]*?)(?:\r\n--frame|$)/);
      
      if (contentTypeMatch && contentTypeMatch[1]) {
        // Find the binary position after the header
        const headerEndPos = frameString.indexOf(contentTypeMatch[1]);
        const jpegData = latestFrame.slice(headerEndPos);
        
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Content-Length': jpegData.length,
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        res.end(jpegData);
      } else {
        res.status(500).send('Could not extract JPEG from stream');
      }
    } catch (err) {
      console.error('Error processing snapshot:', err);
      res.status(500).send('Error processing image data');
    }
  } else {
    res.status(404).send('No frames available yet');
  }
});

// HTML page to view the stream
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>ESP32-CAM Stream Viewer</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: Arial, sans-serif; text-align: center; margin: 20px; }
        .container { max-width: 800px; margin: 0 auto; }
        .stream-container { margin: 20px 0; }
        img { max-width: 100%; border: 1px solid #ddd; }
        .buttons { margin: 20px 0; }
        button { padding: 10px 15px; margin: 0 10px; cursor: pointer; }
        .status { padding: 10px; margin: 10px 0; border-radius: 5px; }
        .connected { background-color: #d4edda; }
        .disconnected { background-color: #f8d7da; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>ESP32-CAM Stream</h1>
        <div id="status" class="status disconnected">Camera Status: Checking...</div>
        <div class="stream-container">
          <img id="stream" src="/view" alt="ESP32-CAM Stream" onerror="handleStreamError()" />
        </div>
        <div class="buttons">
          <button onclick="document.getElementById('stream').src='/snapshot'">Take Snapshot</button>
          <button onclick="document.getElementById('stream').src='/view'">Resume Stream</button>
          <button onclick="checkStatus()">Check Connection</button>
        </div>
      </div>
      
      <script>
        // Check camera status periodically
        function updateStatus() {
          fetch('/api/status')
            .then(response => response.json())
            .then(data => {
              const statusDiv = document.getElementById('status');
              if (data.connected) {
                statusDiv.className = 'status connected';
                statusDiv.textContent = 'Camera Status: Connected';
              } else {
                statusDiv.className = 'status disconnected';
                statusDiv.textContent = 'Camera Status: Disconnected';
              }
            })
            .catch(err => console.error('Error checking status:', err));
        }
        
        function handleStreamError() {
          console.log('Stream error detected, reconnecting...');
          setTimeout(() => {
            document.getElementById('stream').src = '/view';
          }, 2000);
        }
        
        function checkStatus() {
          updateStatus();
        }
        
        // Check status on page load and periodically
        updateStatus();
        setInterval(updateStatus, 5000);
      </script>
    </body>
    </html>
  `);
});

// API endpoint to get stream info
app.get('/api/status', (req, res) => {
  res.json({
    connected: cameraConnected,
    lastActivity: lastCameraActivity,
    boundary: boundaryString,
    frameSize: latestFrame.length
  });
});

// Handle errors globally
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  if (req.path === '/stream' && err.type === 'request.aborted') {
    // Handle aborted stream requests specially
    console.log('Stream connection aborted, waiting for reconnection...');
    return;
  }
  
  if (!res.headersSent) {
    res.status(500).send('Server error');
  }
});

// Start the server
const PORT = process.env.PORT || 8000;
http.createServer(app).listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`- Stream endpoint: http://localhost:${PORT}/stream (for ESP32-CAM to POST to)`);
  console.log(`- View stream: http://localhost:${PORT}/view`);
  console.log(`- Get snapshot: http://localhost:${PORT}/snapshot`);
  console.log(`- Stream status: http://localhost:${PORT}/api/status`);
});
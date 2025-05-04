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

// Middleware to handle raw data for the stream
app.use('/stream', (req, res, next) => {
  if (req.method === 'POST') {
    req.rawBody = [];
    
    req.on('data', (chunk) => {
      // Process incoming data from ESP32-CAM
      if (isFirstChunk) {
        // Extract boundary from first chunk
        const headerText = chunk.toString();
        const boundaryMatch = headerText.match(/boundary=(.+)/);
        if (boundaryMatch && boundaryMatch[1]) {
          boundaryString = boundaryMatch[1];
          console.log(`Boundary detected: ${boundaryString}`);
        }
        isFirstChunk = false;
      }
      
      // Add chunk to raw body
      req.rawBody.push(chunk);
      
      // Push to the stream for real-time clients
      cameraStream.write(chunk);
    });
    
    req.on('end', () => {
      // When the stream ends, save the latest complete buffer
      latestFrame = Buffer.concat(req.rawBody);
      next();
    });
  } else {
    next();
  }
});

// Route to receive the stream from ESP32-CAM
app.post('/stream', (req, res) => {
  console.log('ESP32-CAM connected and streaming');
  res.status(200).end();
});

// Route to serve the stream to clients
app.get('/view', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Pragma': 'no-cache'
  });
  
  // Send the latest frame to new connections immediately
  if (latestFrame.length > 0) {
    res.write(latestFrame);
  }
  
  // Pipe the ongoing stream to this client
  const stream = cameraStream.pipe(new PassThrough());
  
  stream.on('data', (chunk) => {
    res.write(chunk);
  });
  
  // Handle client disconnect
  req.on('close', () => {
    stream.destroy();
    console.log('Client disconnected from stream');
  });
});

// Route to get the latest JPEG frame
app.get('/snapshot', (req, res) => {
  if (latestFrame.length > 0) {
    // Parse the multipart data to extract just the JPEG
    const frameString = latestFrame.toString();
    const contentTypeMatch = frameString.match(/Content-Type: image\/jpeg\r\n\r\n([\s\S]*?)(?:\r\n--frame|$)/);
    
    if (contentTypeMatch && contentTypeMatch[1]) {
      // Find the binary position after the header
      const headerEndPos = frameString.indexOf(contentTypeMatch[1]);
      const jpegData = latestFrame.slice(headerEndPos);
      
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': jpegData.length
      });
      res.end(jpegData);
    } else {
      res.status(500).send('Could not extract JPEG from stream');
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
      <style>
        body { font-family: Arial, sans-serif; text-align: center; margin: 20px; }
        .container { max-width: 800px; margin: 0 auto; }
        .stream-container { margin: 20px 0; }
        img { max-width: 100%; border: 1px solid #ddd; }
        .buttons { margin: 20px 0; }
        button { padding: 10px 15px; margin: 0 10px; cursor: pointer; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>ESP32-CAM Stream</h1>
        <div class="stream-container">
          <img id="stream" src="/view" alt="ESP32-CAM Stream" />
        </div>
        <div class="buttons">
          <button onclick="document.getElementById('stream').src='/snapshot'">Take Snapshot</button>
          <button onclick="document.getElementById('stream').src='/view'">Resume Stream</button>
        </div>
      </div>
    </body>
    </html>
  `);
});

// API endpoint to get stream info
app.get('/api/status', (req, res) => {
  res.json({
    streaming: latestFrame.length > 0,
    boundary: boundaryString,
    lastFrameSize: latestFrame.length
  });
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
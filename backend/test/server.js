
/**
 * This code provides a Node.js Express server that acts as an intermediary
 * between an ESP32-CAM and web clients. It addresses the ESP32-CAM's
 * limitation of only supporting a single client connection.
 */

const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;

// Configuration
const ESP32_STREAM_URL = 'http://192.168.4.1/stream';
const FRAMES_DIR = path.join(__dirname, 'frames');
const MAX_FRAMES = 5;
const FRAME_DELAY = 50; // 50ms delay between frame captures

// Global variables
let latestFrame = null;
let frameCount = 0;
let capturing = true;
let streamRequest = null;

// Create frames directory if it doesn't exist
function createFramesDirectory() {
  if (!fs.existsSync(FRAMES_DIR)) {
    try {
      fs.mkdirSync(FRAMES_DIR, { recursive: true });
      return true;
    } catch (err) {
      console.error(`Error creating frames directory: ${err}`);
      return false;
    }
  }
  return true;
}

// Clean up old frames
function cleanupFrames() {
  try {
    const files = fs.readdirSync(FRAMES_DIR)
      .map(file => path.join(FRAMES_DIR, file))
      .filter(file => fs.statSync(file).isFile())
      .sort();
      
    if (files.length > MAX_FRAMES) {
      const filesToDelete = files.slice(0, files.length - MAX_FRAMES);
      filesToDelete.forEach(file => {
        try {
          fs.unlinkSync(file);
        } catch (err) {
          console.error(`Error deleting file ${file}: ${err}`);
        }
      });
    }
  } catch (err) {
    console.error(`Error in cleanup: ${err}`);
  }
}

// Function to handle MJPEG stream
function captureFrames() {
  if (!createFramesDirectory()) {
    console.error('Failed to create frames directory. Exiting capture function.');
    capturing = false;
    return;
  }

  console.log(`Connecting to ESP32-CAM stream at ${ESP32_STREAM_URL}`);
  
  const connect = () => {
    if (!capturing) return;
    
    // Clear any existing request
    if (streamRequest) {
      streamRequest.abort();
      streamRequest = null;
    }
    
    streamRequest = http.get(ESP32_STREAM_URL, (res) => {
      if (res.statusCode !== 200) {
        console.error(`Failed to connect to stream: ${res.statusCode}`);
        setTimeout(connect, 5000); // Retry after 5 seconds
        return;
      }

      console.log('Connected to ESP32-CAM stream');
      
      // Get boundary from content type
      const contentType = res.headers['content-type'];
      const boundaryMatch = contentType && contentType.match(/boundary=([^;]+)/i);
      if (!boundaryMatch) {
        console.error('Could not find boundary in Content-Type header');
        setTimeout(connect, 5000);
        return;
      }
      
      const boundary = boundaryMatch[1];
      let buffer = Buffer.alloc(0);
      
      res.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        
        // Look for JPEG markers in the buffer
        // JPEG files start with FF D8 and end with FF D9
        let startIdx = buffer.indexOf(Buffer.from([0xFF, 0xD8]));
        while (startIdx !== -1) {
          let endIdx = buffer.indexOf(Buffer.from([0xFF, 0xD9]), startIdx);
          
          if (endIdx !== -1) {
            // We have a complete JPEG
            endIdx += 2; // Include the FF D9 marker
            const frameBuffer = buffer.slice(startIdx, endIdx);
            
            // Save the frame
            latestFrame = frameBuffer;
            
            // Save frame to disk
            const frameFilename = path.join(FRAMES_DIR, `frame_${String(frameCount).padStart(5, '0')}.jpg`);
            try {
              fs.writeFileSync(frameFilename, frameBuffer);
              frameCount++;
              cleanupFrames();
            } catch (err) {
              console.error(`Error saving frame to ${frameFilename}: ${err}`);
            }
            
            // Remove processed data from buffer
            buffer = buffer.slice(endIdx);
            
            // Look for the next JPEG start
            startIdx = buffer.indexOf(Buffer.from([0xFF, 0xD8]));
          } else {
            // Incomplete JPEG, wait for more data
            break;
          }
        }
      });
      
      res.on('error', (err) => {
        console.error(`Stream error: ${err}`);
        setTimeout(connect, 5000);
      });
      
      res.on('end', () => {
        console.log('Stream ended');
        setTimeout(connect, 5000);
      });
    });
    
    streamRequest.on('error', (err) => {
      console.error(`Connection error: ${err}`);
      setTimeout(connect, 5000);
    });
  };
  
  connect();
}

// Set up Express routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'templates', 'index.html'));
});

app.get('/frame', (req, res) => {
  if (!latestFrame) {
    res.status(404).send('No frame available');
    return;
  }
  
  res.writeHead(200, {
    'Content-Type': 'image/jpeg',
    'Content-Length': latestFrame.length
  });
  res.end(latestFrame);
});

app.get('/frames/:filename', (req, res) => {
  const filePath = path.join(FRAMES_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).send('File not found');
    return;
  }
  res.sendFile(filePath);
});

// Start capturing frames and server
createFramesDirectory();
captureFrames();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Stopping capture and server...');
  capturing = false;
  if (streamRequest) {
    streamRequest.abort();
  }
  process.exit();
});
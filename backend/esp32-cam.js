/**
 * ESP32-CAM stream handler module that connects to the ESP32-CAM's MJPEG stream,
 * captures frames, and makes them available to multiple clients.
 * Based on the implementation from the test directory.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class ESP32CamHandler extends EventEmitter {
  constructor() {
    super();
    // Configuration
    this.streamUrl = 'http://192.168.4.1/stream';
    this.framesDir = path.join(__dirname, 'frames');
    this.maxFrames = 10; // Increased from 5 to match the lower frame rate
    
    // State variables
    this.latestFrame = null;
    this.frameCount = 0;
    this.capturing = false;
    this.streamRequest = null;
    this.connected = false;
  }

  // Create frames directory if it doesn't exist
  createFramesDirectory() {
    if (!fs.existsSync(this.framesDir)) {
      try {
        fs.mkdirSync(this.framesDir, { recursive: true });
        return true;
      } catch (err) {
        console.error(`Error creating frames directory: ${err}`);
        return false;
      }
    }
    return true;
  }

  // Clean up old frames
  cleanupFrames() {
    try {
      const files = fs.readdirSync(this.framesDir)
        .map(file => path.join(this.framesDir, file))
        .filter(file => fs.statSync(file).isFile())
        .sort();
        
      if (files.length > this.maxFrames) {
        const filesToDelete = files.slice(0, files.length - this.maxFrames);
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

  // Start capturing frames from the ESP32-CAM
  start(ipAddress) {
    if (this.capturing) {
      console.log('Already capturing frames');
      return;
    }
    
    if (ipAddress) {
      this.streamUrl = `http://${ipAddress}/stream`;
    }
    
    if (!this.createFramesDirectory()) {
      console.error('Failed to create frames directory. Cannot start capturing.');
      return;
    }
    
    this.capturing = true;
    console.log(`Starting ESP32-CAM frame capture from ${this.streamUrl}`);
    this.captureFrames();
  }

  // Main function to capture frames (using the test approach)
  captureFrames() {
    const connect = () => {
      if (!this.capturing) return;
      
      // Clear any existing request
      if (this.streamRequest) {
        this.streamRequest.abort();
        this.streamRequest = null;
      }
      
      this.streamRequest = http.get(this.streamUrl, (res) => {
        if (res.statusCode !== 200) {
          console.error(`Failed to connect to stream: ${res.statusCode}`);
          this.connected = false;
          this.emit('disconnected');
          setTimeout(connect, 5000); // Retry after 5 seconds
          return;
        }

        console.log('Connected to ESP32-CAM stream');
        this.connected = true;
        this.emit('connected');
        
        // Get boundary from content type
        const contentType = res.headers['content-type'];
        const boundaryMatch = contentType && contentType.match(/boundary=([^;]+)/i);
        if (!boundaryMatch) {
          console.error('Could not find boundary in Content-Type header');
          this.connected = false;
          this.emit('disconnected');
          setTimeout(connect, 5000);
          return;
        }
        
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
              this.latestFrame = frameBuffer;
              
              // Emit frame event for WebSockets to use
              this.emit('frame', frameBuffer);
              
              // Save frame to disk
              const frameFilename = path.join(this.framesDir, `frame_${String(this.frameCount).padStart(5, '0')}.jpg`);
              try {
                fs.writeFileSync(frameFilename, frameBuffer);
                this.frameCount++;
                this.cleanupFrames();
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
          this.connected = false;
          this.emit('disconnected');
          setTimeout(connect, 5000);
        });
        
        res.on('end', () => {
          console.log('Stream ended');
          this.connected = false;
          this.emit('disconnected');
          setTimeout(connect, 5000);
        });
      });
      
      this.streamRequest.on('error', (err) => {
        console.error(`Connection error: ${err}`);
        this.connected = false;
        this.emit('disconnected');
        setTimeout(connect, 5000);
      });
    };
    
    connect();
  }

  // Stop capturing frames
  stop() {
    this.capturing = false;
    this.connected = false;
    
    if (this.streamRequest) {
      this.streamRequest.abort();
      this.streamRequest = null;
    }
    
    console.log('ESP32-CAM frame capture stopped');
  }

  // Get the latest frame
  getLatestFrame() {
    return this.latestFrame;
  }

  // Check if connected to stream
  isConnected() {
    return this.connected;
  }
}

// Create and export a singleton instance
module.exports = new ESP32CamHandler();
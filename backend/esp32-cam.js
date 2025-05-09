/**
 * ESP32-CAM stream handler module that connects to the ESP32-CAM's MJPEG stream,
 * captures frames, and forwards them directly to clients without storing them.
 */

const http = require('http');
const EventEmitter = require('events');

class ESP32CamHandler extends EventEmitter {
  constructor() {
    super();
    // Configuration
    this.streamUrl = 'http://192.168.4.1/stream';
    
    // State variables
    this.latestFrame = null;
    this.capturing = false;
    this.streamRequest = null;
    this.connected = false;
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
    
    this.capturing = true;
    console.log(`Starting ESP32-CAM frame capture from ${this.streamUrl}`);
    this.captureFrames();
  }

  // Main function to capture frames
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
              
              // Save the frame in memory only
              this.latestFrame = frameBuffer;
              
              // Emit frame event for WebSockets to use
              this.emit('frame', frameBuffer);
              
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
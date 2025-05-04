const http = require('http');
const EventEmitter = require('events');

class CameraStream extends EventEmitter {
  constructor() {
    super();
    this.isConnected = false;
    this.currentFrame = null;
    this.camIP = null;
    this.connectionAttempts = 0;
    this.maxAttempts = 5;
    this.retryInterval = 5000; // 5 seconds
    this.request = null;
  }

  // Connect to the camera stream
  connect(ip = '192.168.4.1', port = 80) {
    if (this.isConnected) {
      console.log('Already connected to camera stream');
      return;
    }

    this.camIP = ip;
    console.log(`Attempting to connect to camera at http://${ip}:${port}/stream`);
    
    const options = {
      hostname: ip,
      port: port,
      path: '/stream',
      method: 'GET'
    };

    this.request = http.request(options, (res) => {
      console.log(`Camera stream response status: ${res.statusCode}`);
      
      if (res.statusCode !== 200) {
        console.error(`Failed to connect to camera stream: ${res.statusCode}`);
        this.handleConnectionFailure();
        return;
      }

      this.isConnected = true;
      this.connectionAttempts = 0;
      this.emit('connected');

      // Parse boundary from content-type header
      const contentType = res.headers['content-type'] || '';
      const boundaryMatch = contentType.match(/boundary=(.+)$/);
      const boundary = boundaryMatch ? boundaryMatch[1] : 'frame';
      
      console.log(`Stream boundary: ${boundary}`);

      // Variables to help parse multipart MIME stream
      let imageBuffer = Buffer.alloc(0);
      let isCollectingData = false;
      let frameStart = '--' + boundary;
      let frameEnd = Buffer.from('\r\n\r\n');
      
      res.on('data', (chunk) => {
        // Add new chunk to our buffer
        imageBuffer = Buffer.concat([imageBuffer, chunk]);

        // Look for frame start if not collecting data
        if (!isCollectingData) {
          const startIndex = imageBuffer.indexOf(frameStart);
          if (startIndex >= 0) {
            imageBuffer = imageBuffer.slice(startIndex);
            isCollectingData = true;
          }
        }

        // Look for content boundary (after headers) if collecting data
        if (isCollectingData) {
          const headerEndIndex = imageBuffer.indexOf(frameEnd);
          if (headerEndIndex >= 0) {
            // Get start of JPEG data (after headers)
            const jpegStart = headerEndIndex + frameEnd.length;
            
            // Look for end of this part (next boundary)
            const jpegEnd = imageBuffer.indexOf(Buffer.from(`\r\n--${boundary}`), jpegStart);
            
            if (jpegEnd > jpegStart) {
              // We have a complete frame
              const jpegBuffer = imageBuffer.slice(jpegStart, jpegEnd);
              
              // Set as current frame and emit event
              this.currentFrame = jpegBuffer;
              this.emit('frame', jpegBuffer);
              
              // Remove processed data from buffer
              imageBuffer = imageBuffer.slice(jpegEnd);
              isCollectingData = false;
            }
          }
        }

        // Prevent buffer from growing too large if we can't find boundaries
        if (imageBuffer.length > 1000000) { // 1MB limit
          imageBuffer = Buffer.alloc(0);
          isCollectingData = false;
        }
      });

      res.on('error', (err) => {
        console.error('Error in camera stream:', err);
        this.handleDisconnect();
      });

      res.on('end', () => {
        console.log('Camera stream ended');
        this.handleDisconnect();
      });
    });

    this.request.on('error', (err) => {
      console.error(`Camera connection error: ${err.message}`);
      this.handleConnectionFailure();
    });

    this.request.end();
  }

  handleConnectionFailure() {
    this.connectionAttempts++;
    if (this.connectionAttempts < this.maxAttempts) {
      console.log(`Retrying camera connection (${this.connectionAttempts}/${this.maxAttempts}) in ${this.retryInterval/1000}s...`);
      setTimeout(() => this.connect(this.camIP), this.retryInterval);
    } else {
      console.error('Max camera connection attempts reached. Giving up.');
      this.emit('error', new Error('Failed to connect to camera after multiple attempts'));
    }
  }

  handleDisconnect() {
    if (this.isConnected) {
      this.isConnected = false;
      this.emit('disconnected');
      
      // Try to reconnect
      setTimeout(() => {
        if (!this.isConnected) {
          console.log('Attempting to reconnect to camera...');
          this.connect(this.camIP);
        }
      }, this.retryInterval);
    }
  }

  disconnect() {
    if (this.request) {
      this.request.destroy();
    }
    this.isConnected = false;
    this.emit('disconnected');
    console.log('Disconnected from camera stream');
  }

  getLatestFrame() {
    return this.currentFrame;
  }
  
  isStreamConnected() {
    return this.isConnected;
  }
}

module.exports = new CameraStream();

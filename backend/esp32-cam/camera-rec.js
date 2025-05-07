const EventEmitter = require('events');
const http = require('http');

class CameraStream extends EventEmitter {
    constructor() {
        super();
        this.connected = false;
        this.req = null;
        this.cameraIp = '192.168.4.1'; // Default ESP32-CAM IP
        this.streamPath = '/stream';
        this.boundaryPattern = Buffer.from('\r\n--frame\r\n');
        this.contentLengthPattern = /Content-Length: (\d+)/i;
        this.buffer = Buffer.alloc(0);
        this.latestFrame = null;
        this.lastFrameTime = 0;
    }

    connect(ip = null) {
        // Allow overriding the default IP
        if (ip) {
            this.cameraIp = ip;
        }

        console.log(`Attempting to connect to camera stream at http://${this.cameraIp}${this.streamPath}`);
        
        // Abort any existing request
        if (this.req) {
            this.req.destroy();
            this.req = null;
        }

        // Connect to the MJPEG stream
        this.req = http.get(`http://${this.cameraIp}${this.streamPath}`, (res) => {
            console.log(`Connected to camera stream with status: ${res.statusCode}`);
            
            if (res.statusCode !== 200) {
                this.emit('disconnected', `Failed to connect: HTTP ${res.statusCode}`);
                console.error(`Failed to connect to camera: HTTP ${res.statusCode}`);
                this.connected = false;
                return;
            }

            this.connected = true;
            this.emit('connected');
            
            // Handle stream data
            res.on('data', (chunk) => {
                this._processStreamChunk(chunk);
            });

            res.on('end', () => {
                console.log('Camera stream ended');
                this.connected = false;
                this.emit('disconnected', 'Stream ended');
            });

        }).on('error', (err) => {
            console.error(`Error connecting to camera: ${err.message}`);
            this.connected = false;
            this.emit('disconnected', err.message);
            
            // Retry connection after delay
            setTimeout(() => this.connect(), 5000);
        });

        // Set a timeout
        this.req.setTimeout(10000, () => {
            console.error('Camera stream request timeout');
            this.req.destroy();
            this.connected = false;
            this.emit('disconnected', 'Request timeout');
            
            // Retry connection after delay
            setTimeout(() => this.connect(), 5000);
        });
    }

    _processStreamChunk(chunk) {
        // Append the new chunk to our buffer
        this.buffer = Buffer.concat([this.buffer, chunk]);
        
        // Try to extract frames from the buffer
        let frameStart = this.buffer.indexOf(this.boundaryPattern);
        
        while (frameStart !== -1) {
            // Look for the next boundary after this one
            const nextFrameStart = this.buffer.indexOf(this.boundaryPattern, frameStart + this.boundaryPattern.length);
            
            if (nextFrameStart !== -1) {
                // Extract the frame data between boundaries
                const frameData = this.buffer.slice(frameStart + this.boundaryPattern.length, nextFrameStart);
                
                // Find Content-Length in the frame data
                const frameText = frameData.toString('ascii', 0, 100); // Just look at the header part
                const match = this.contentLengthPattern.exec(frameText);
                
                if (match) {
                    const contentLength = parseInt(match[1], 10);
                    
                    // Find the end of headers (double CRLF)
                    const headersEnd = frameData.indexOf(Buffer.from('\r\n\r\n'));
                    
                    if (headersEnd !== -1 && headersEnd + 4 + contentLength <= frameData.length) {
                        // Extract the JPEG data
                        const jpegData = frameData.slice(headersEnd + 4, headersEnd + 4 + contentLength);
                        
                        // Store the latest frame
                        this.latestFrame = jpegData;
                        this.lastFrameTime = Date.now();
                        
                        // Emit the frame
                        this.emit('frame', jpegData);
                    }
                }
                
                // Remove the processed frame from the buffer
                this.buffer = this.buffer.slice(nextFrameStart);
                
                // Look for the next frame
                frameStart = this.buffer.indexOf(this.boundaryPattern);
            } else {
                // We don't have a complete frame yet, wait for more data
                break;
            }
        }
        
        // Instead of resetting the buffer when it gets too large,
        // we'll periodically check if we have unprocessable data at the start
        // and trim that if needed
        if (frameStart === -1 && this.buffer.length > 50000) {  // More than 50KB unprocessable data
            // Look for a partial frame delimiter near the end of the buffer
            const partialBoundaryAtEnd = this.hasPartialBoundaryAtEnd();
            if (partialBoundaryAtEnd > 0) {
                // Keep only the last part that might contain a boundary start
                this.buffer = this.buffer.slice(this.buffer.length - partialBoundaryAtEnd);
            } else {
                // If no partial boundary at the end, and the buffer is very large,
                // we might be getting corrupt data, so discard some old data
                const discardBytes = Math.floor(this.buffer.length / 2);
                console.log(`Buffer contains ${this.buffer.length} bytes with no frame boundary, discarding ${discardBytes} bytes`);
                this.buffer = this.buffer.slice(discardBytes);
            }
        }
    }

    // Helper method to check if there's a partial boundary at the end of the buffer
    hasPartialBoundaryAtEnd() {
        // Check if the end of the buffer contains part of a boundary pattern
        const boundaryLen = this.boundaryPattern.length;
        
        // Check for progressively smaller parts of the boundary at the end of the buffer
        for (let i = boundaryLen - 1; i > 0; i--) {
            const partialBoundary = this.boundaryPattern.slice(0, i);
            if (this.buffer.indexOf(partialBoundary, this.buffer.length - i) !== -1) {
                return i;  // Return how many bytes might be part of a boundary
            }
        }
        
        return 0; // No partial boundary found
    }

    getLatestFrame(callback) {
        // If we have a recent frame (within the last 5 seconds), return it
        if (this.latestFrame && Date.now() - this.lastFrameTime < 5000) {
            callback(this.latestFrame);
            return true;
        }
        callback(null);
        return false;
    }

    disconnect() {
        if (this.req) {
            this.req.destroy();
            this.req = null;
        }
        this.connected = false;
        this.emit('disconnected', 'Manually disconnected');
    }

    isStreamConnected() {
        return this.connected;
    }
}

// Export a singleton instance
module.exports = new CameraStream();

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
        this.contentTypePattern = /Content-Type: image\/jpeg/i;
        this.buffer = Buffer.alloc(0);
        this.latestFrame = null;
        this.lastFrameTime = 0;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
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
        this.req = http.get({
            hostname: this.cameraIp,
            path: this.streamPath,
            timeout: 10000 // 10 second timeout
        }, (res) => {
            console.log(`Connected to camera stream with status: ${res.statusCode}`);
            
            if (res.statusCode !== 200) {
                this.emit('disconnected', `Failed to connect: HTTP ${res.statusCode}`);
                console.error(`Failed to connect to camera: HTTP ${res.statusCode}`);
                this.connected = false;
                this.scheduleReconnect();
                return;
            }

            // Reset reconnect attempts on successful connection
            this.reconnectAttempts = 0;
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
                this.scheduleReconnect();
            });

        }).on('error', (err) => {
            console.error(`Error connecting to camera: ${err.message}`);
            this.connected = false;
            this.emit('disconnected', err.message);
            this.scheduleReconnect();
        });

        // Set a timeout
        this.req.setTimeout(10000, () => {
            console.error('Camera stream request timeout');
            this.req.destroy();
            this.connected = false;
            this.emit('disconnected', 'Request timeout');
            this.scheduleReconnect();
        });
    }

    scheduleReconnect() {
        this.reconnectAttempts++;
        let delay = Math.min(5000 * this.reconnectAttempts, 30000); // Increasing delay up to 30 seconds
        
        if (this.reconnectAttempts <= this.maxReconnectAttempts) {
            console.log(`Scheduling reconnection attempt ${this.reconnectAttempts} in ${delay/1000} seconds`);
            setTimeout(() => this.connect(), delay);
        } else {
            console.error(`Maximum reconnection attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
            // Emit a special event to notify that we've stopped trying
            this.emit('reconnect_failed');
            
            // Reset reconnect counter so we can try again later if requested
            setTimeout(() => {
                this.reconnectAttempts = 0;
            }, 60000); // Reset after 1 minute
        }
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
                
                // Process the frame data (extract JPEG)
                this._extractAndEmitFrame(frameData);
                
                // Remove the processed frame from the buffer
                this.buffer = this.buffer.slice(nextFrameStart);
                
                // Look for the next frame
                frameStart = this.buffer.indexOf(this.boundaryPattern);
            } else {
                // We don't have a complete frame yet, wait for more data
                break;
            }
        }
        
        // If buffer gets very large without finding frame boundaries, do some cleanup
        if (frameStart === -1 && this.buffer.length > 100000) { // 100KB
            // See if we can find a partial boundary at the end to keep
            const partialBoundarySize = this._findPartialBoundaryAtEnd();
            if (partialBoundarySize > 0) {
                // Keep only the partial boundary
                this.buffer = this.buffer.slice(this.buffer.length - partialBoundarySize);
                console.log(`Large buffer truncated, keeping ${partialBoundarySize} bytes of possible boundary`);
            } else {
                // Keep only the last portion of the buffer
                const keepSize = 8192; // 8KB
                this.buffer = this.buffer.slice(-keepSize);
                console.log(`Large buffer truncated, keeping last ${keepSize} bytes`);
            }
        }
    }

    _extractAndEmitFrame(frameData) {
        try {
            // Convert to string for header inspection
            const frameHeader = frameData.slice(0, 200).toString('ascii');
            
            // Check for JPEG content type
            if (!this.contentTypePattern.test(frameHeader)) {
                return; // Not a JPEG frame
            }
            
            // Find Content-Length
            const match = this.contentLengthPattern.exec(frameHeader);
            if (!match) {
                return; // No content length found
            }
            
            const contentLength = parseInt(match[1], 10);
            if (isNaN(contentLength) || contentLength <= 0 || contentLength > 1000000) {
                console.warn(`Invalid content length: ${match[1]}`);
                return; // Invalid content length
            }
            
            // Find the start of actual JPEG data (after headers)
            const headersEnd = frameData.indexOf(Buffer.from('\r\n\r\n'));
            if (headersEnd === -1) {
                return; // No end of headers found
            }
            
            // Extract the JPEG data
            const jpegStartPos = headersEnd + 4;
            
            // Ensure we have enough data
            if (jpegStartPos + contentLength > frameData.length) {
                console.warn(`Incomplete frame: expected ${contentLength} bytes, got ${frameData.length - jpegStartPos}`);
                return; // Not enough data
            }
            
            const jpegData = frameData.slice(jpegStartPos, jpegStartPos + contentLength);
            
            // Simple JPEG validation: Check for JPEG magic bytes (FF D8 FF)
            if (jpegData[0] === 0xFF && jpegData[1] === 0xD8 && jpegData[2] === 0xFF) {
                // Store the latest frame
                this.latestFrame = jpegData;
                this.lastFrameTime = Date.now();
                
                // Emit the frame
                this.emit('frame', jpegData);
            } else {
                console.warn('Invalid JPEG data (wrong magic bytes)');
            }
        } catch (error) {
            console.error('Error processing frame:', error);
        }
    }

    _findPartialBoundaryAtEnd() {
        // Check if the end of the buffer contains part of a boundary pattern
        const boundaryLen = this.boundaryPattern.length;
        
        // Check for progressively smaller parts of the boundary at the end of the buffer
        for (let i = boundaryLen - 1; i > 0; i--) {
            const partialBoundary = this.boundaryPattern.slice(0, i);
            const searchStart = Math.max(0, this.buffer.length - i);
            
            if (this.buffer.slice(searchStart).indexOf(partialBoundary) !== -1) {
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
        this.buffer = Buffer.alloc(0); // Clear the buffer
        this.emit('disconnected', 'Manually disconnected');
    }

    isStreamConnected() {
        return this.connected;
    }
}

// Export a singleton instance
module.exports = new CameraStream();

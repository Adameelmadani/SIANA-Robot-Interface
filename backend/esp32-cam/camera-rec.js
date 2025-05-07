const EventEmitter = require('events');
const http = require('http');

class CameraStream extends EventEmitter {
    constructor() {
        super();
        this.connected = false;
        this.connectionAttempts = 0;
        this.maxAttempts = 20;
        this.streamRequest = null;
        this.connectionTimeout = null;
    }

    connect(ipAddress = '192.168.4.1') {
        if (this.connectionAttempts >= this.maxAttempts) {
            console.log('Max connection attempts reached. Stopping attempts.');
            return;
        }

        console.log(`Attempting to connect to ESP32-CAM stream at http://${ipAddress}/stream`);
        this.connectionAttempts++;

        // Clear any existing connection
        this.disconnect();

        // Set a timeout to mark connection as failed if it takes too long
        this.connectionTimeout = setTimeout(() => {
            console.log('Connection timeout');
            this.disconnect();
            
            // Try to reconnect after delay
            setTimeout(() => this.connect(ipAddress), 5000);
        }, 10000);

        // Connect to the MJPEG stream
        this.streamRequest = http.get(`http://${ipAddress}/stream`, (res) => {
            clearTimeout(this.connectionTimeout);
            
            if (res.statusCode !== 200) {
                console.error(`Failed to connect to stream: ${res.statusCode}`);
                this.emit('disconnected');
                
                // Try to reconnect after delay
                setTimeout(() => this.connect(ipAddress), 5000);
                return;
            }
            
            console.log('Connected to ESP32-CAM stream');
            this.connected = true;
            this.connectionAttempts = 0;
            this.emit('connected');

            // MJPEG streams use multipart/x-mixed-replace
            let boundary = this.getBoundary(res.headers['content-type']);
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
            console.error('Error connecting to ESP32-CAM stream:', err);
            this.connected = false;
            this.emit('disconnected');
            
            // Try to reconnect after delay
            setTimeout(() => this.connect(ipAddress), 5000);
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
            this.emit('disconnected');
        }
    }

    isStreamConnected() {
        return this.connected;
    }

    getBoundary(contentType) {
        if (!contentType) return null;
        const matches = contentType.match(/boundary=([^\s;]+)/i);
        return matches ? matches[1] : 'frame';  // Default to 'frame' if not found
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
                    
                    // Emit the frame
                    this.emit('frame', frameBuffer);
                    
                    // Remove the processed frame from buffer
                    buffer = buffer.slice(frameStartIndex + contentLength);
                } else {
                    // Incomplete frame, wait for more data
                    break;
                }
            }
        });
        
        stream.on('error', (err) => {
            console.error('Stream error:', err);
            this.disconnect();
            
            // Try to reconnect after delay
            setTimeout(() => this.connect(), 5000);
        });
        
        stream.on('end', () => {
            console.log('Stream ended');
            this.disconnect();
            
            // Try to reconnect after delay
            setTimeout(() => this.connect(), 5000);
        });
    }
}

module.exports = new CameraStream();

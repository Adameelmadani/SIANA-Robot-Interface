
const EventEmitter = require('events');
const http = require('http');
const fs = require('fs');
const path = require('path');

class FrameCapture extends EventEmitter {
    constructor(options = {}) {
        super();
        this.cameraIP = options.cameraIP || '192.168.4.1';
        this.framesDir = options.framesDir || path.join(__dirname, 'frames');
        this.maxFrames = options.maxFrames || 10;
        this.connected = false;
        this.request = null;
        this.frameCounter = 0;
        
        // Create frames directory if it doesn't exist
        if (!fs.existsSync(this.framesDir)) {
            fs.mkdirSync(this.framesDir, { recursive: true });
        } else {
            // Clean any existing frames
            this.cleanFrames();
        }
    }

    connect() {
        console.log(`Connecting to ESP32-CAM at http://${this.cameraIP}/stream`);
        
        this.request = http.get(`http://${this.cameraIP}/stream`, (res) => {
            if (res.statusCode !== 200) {
                console.error(`Failed to connect: ${res.statusCode}`);
                this.emit('error', new Error(`HTTP Error: ${res.statusCode}`));
                this.scheduleReconnect();
                return;
            }
            
            console.log('Connected to ESP32-CAM stream');
            this.connected = true;
            this.emit('connected');
            
            // Get the boundary for the MJPEG stream
            const contentType = res.headers['content-type'];
            const boundary = this.getBoundary(contentType);
            if (!boundary) {
                console.error('Could not determine stream boundary');
                this.scheduleReconnect();
                return;
            }
            
            this.processStream(res, boundary);
        });
        
        this.request.on('error', (err) => {
            console.error('Connection error:', err);
            this.connected = false;
            this.emit('error', err);
            this.scheduleReconnect();
        });
    }
    
    getBoundary(contentType) {
        if (!contentType) return null;
        const matches = contentType.match(/boundary=([^\s;]+)/i);
        return matches ? matches[1] : 'frame';
    }
    
    processStream(stream, boundary) {
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
                
                // Extract the Content-Length
                const headers = buffer.slice(0, headerEndIndex).toString();
                const contentLengthMatch = headers.match(/Content-Length:\s*(\d+)/i);
                if (!contentLengthMatch) continue;
                
                const contentLength = parseInt(contentLengthMatch[1], 10);
                const frameStartIndex = headerEndIndex + endMarkerBuffer.length;
                
                if (buffer.length >= frameStartIndex + contentLength) {
                    // We have a complete frame
                    const frameData = buffer.slice(frameStartIndex, frameStartIndex + contentLength);
                    this.saveFrame(frameData);
                    
                    // Remove processed data from buffer
                    buffer = buffer.slice(frameStartIndex + contentLength);
                } else {
                    // Need more data
                    break;
                }
            }
        });
        
        stream.on('end', () => {
            console.log('Stream ended');
            this.connected = false;
            this.emit('disconnected');
            this.scheduleReconnect();
        });
        
        stream.on('error', (err) => {
            console.error('Stream error:', err);
            this.connected = false;
            this.emit('error', err);
            this.scheduleReconnect();
        });
    }
    
    saveFrame(frameData) {
        this.frameCounter++;
        const filename = path.join(this.framesDir, `frame-${Date.now()}.jpg`);
        
        fs.writeFile(filename, frameData, (err) => {
            if (err) {
                console.error('Error saving frame:', err);
                return;
            }
            
            this.emit('frame', {
                path: filename,
                timestamp: Date.now()
            });
            
            // Clean up old frames periodically
            if (this.frameCounter % 5 === 0) {
                this.cleanFrames();
            }
        });
    }
    
    cleanFrames() {
        fs.readdir(this.framesDir, (err, files) => {
            if (err) {
                console.error('Error reading frames directory:', err);
                return;
            }
            
            // Sort by creation time (oldest first)
            const sortedFiles = files
                .filter(file => file.endsWith('.jpg'))
                .map(file => ({
                    name: file,
                    path: path.join(this.framesDir, file),
                    ctime: fs.statSync(path.join(this.framesDir, file)).ctimeMs
                }))
                .sort((a, b) => a.ctime - b.ctime);
            
            // Remove excess frames
            if (sortedFiles.length > this.maxFrames) {
                const filesToDelete = sortedFiles.slice(0, sortedFiles.length - this.maxFrames);
                filesToDelete.forEach(file => {
                    fs.unlink(file.path, (err) => {
                        if (err) console.error(`Error deleting ${file.path}:`, err);
                    });
                });
            }
        });
    }
    
    scheduleReconnect() {
        if (this.request) {
            this.request.destroy();
            this.request = null;
        }
        
        setTimeout(() => {
            console.log('Attempting to reconnect...');
            this.connect();
        }, 5000);
    }
    
    disconnect() {
        if (this.request) {
            this.request.destroy();
            this.request = null;
        }
        this.connected = false;
        this.emit('disconnected');
    }
    
    isConnected() {
        return this.connected;
    }
    
    getLatestFrame() {
        return new Promise((resolve, reject) => {
            fs.readdir(this.framesDir, (err, files) => {
                if (err) {
                    return reject(err);
                }
                
                const jpgFiles = files.filter(file => file.endsWith('.jpg'));
                if (jpgFiles.length === 0) {
                    return reject(new Error('No frames available'));
                }
                
                // Get the most recent frame
                const sortedFiles = jpgFiles
                    .map(file => ({
                        name: file,
                        path: path.join(this.framesDir, file),
                        ctime: fs.statSync(path.join(this.framesDir, file)).ctimeMs
                    }))
                    .sort((a, b) => b.ctime - a.ctime);
                
                resolve(sortedFiles[0].path);
            });
        });
    }
}

module.exports = FrameCapture;
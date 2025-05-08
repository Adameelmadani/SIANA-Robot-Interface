
const express = require('express');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const http = require('http');
const FrameCapture = require('./frame-capture');

class FrameServer {
    constructor(options = {}) {
        this.port = options.port || 3001;
        this.framesDir = options.framesDir || path.join(__dirname, 'frames');
        this.frameRate = options.frameRate || 24; // frames per second to send to clients
        this.frameInterval = 1000 / this.frameRate;
        
        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocket.Server({ server: this.server });
        this.clients = new Set();
        
        // Set up the frame capture
        this.frameCapture = new FrameCapture({
            cameraIP: options.cameraIP || '192.168.4.1',
            framesDir: this.framesDir,
            maxFrames: options.maxFrames || 30
        });
        
        this.setupRoutes();
        this.setupWebSocket();
    }
    
    setupRoutes() {
        // Serve a simple page to test the stream
        this.app.get('/', (req, res) => {
            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>ESP32-CAM Stream</title>
                    <style>
                        body { font-family: Arial, sans-serif; text-align: center; }
                        #stream { max-width: 100%; height: auto; }
                        .status { margin: 10px 0; padding: 5px; border-radius: 5px; }
                        .connected { background-color: #d4edda; color: #155724; }
                        .disconnected { background-color: #f8d7da; color: #721c24; }
                    </style>
                </head>
                <body>
                    <h1>ESP32-CAM Stream</h1>
                    <div id="statusContainer" class="status disconnected">
                        Camera Status: <span id="status">Disconnected</span>
                    </div>
                    <div>
                        <img id="stream" src="/placeholder.jpg" alt="Camera Stream">
                    </div>
                    <script>
                        const ws = new WebSocket('ws://' + window.location.host + '/stream');
                        const streamEl = document.getElementById('stream');
                        const statusEl = document.getElementById('status');
                        const statusContainer = document.getElementById('statusContainer');
                        
                        ws.onopen = () => {
                            console.log('WebSocket connected');
                        };
                        
                        ws.onmessage = (event) => {
                            try {
                                const data = JSON.parse(event.data);
                                
                                if (data.type === 'frame') {
                                    // Update the image with the new frame
                                    streamEl.src = "data:image/jpeg;base64," + data.data;
                                } else if (data.type === 'status') {
                                    // Update the connection status
                                    statusEl.textContent = data.connected ? 'Connected' : 'Disconnected';
                                    statusContainer.className = 'status ' + 
                                        (data.connected ? 'connected' : 'disconnected');
                                }
                            } catch (e) {
                                console.error('Error processing message:', e);
                            }
                        };
                        
                        ws.onclose = () => {
                            console.log('WebSocket disconnected');
                            statusEl.textContent = 'Connection Lost';
                            statusContainer.className = 'status disconnected';
                            
                            // Try to reconnect after 5 seconds
                            setTimeout(() => {
                                location.reload();
                            }, 5000);
                        };
                    </script>
                </body>
                </html>
            `);
        });
        
        // Serve a placeholder image
        this.app.get('/placeholder.jpg', (req, res) => {
            res.sendFile(path.join(__dirname, 'placeholder.jpg'));
        });
        
        // API to get the latest frame
        this.app.get('/api/latest-frame', async (req, res) => {
            try {
                const framePath = await this.frameCapture.getLatestFrame();
                res.sendFile(framePath);
            } catch (err) {
                console.error('Error sending latest frame:', err);
                res.status(404).send('No frames available');
            }
        });
    }
    
    setupWebSocket() {
        this.wss.on('connection', (ws) => {
            console.log('Client connected');
            this.clients.add(ws);
            
            // Send current status
            ws.send(JSON.stringify({
                type: 'status',
                connected: this.frameCapture.isConnected()
            }));
            
            ws.on('close', () => {
                console.log('Client disconnected');
                this.clients.delete(ws);
            });
        });
        
        // Handle new frames event
        this.frameCapture.on('frame', async (frameInfo) => {
            // Only broadcast if we have clients
            if (this.clients.size > 0) {
                try {
                    const frameData = await fs.promises.readFile(frameInfo.path);
                    const base64Frame = frameData.toString('base64');
                    
                    // Broadcast to all connected clients
                    this.broadcastFrame(base64Frame);
                } catch (err) {
                    console.error('Error reading frame:', err);
                }
            }
        });
        
        // Handle connection status changes
        this.frameCapture.on('connected', () => {
            this.broadcastStatus(true);
        });
        
        this.frameCapture.on('disconnected', () => {
            this.broadcastStatus(false);
        });
    }
    
    broadcastFrame(frameData) {
        const message = JSON.stringify({
            type: 'frame',
            data: frameData
        });
        
        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        }
    }
    
    broadcastStatus(connected) {
        const message = JSON.stringify({
            type: 'status',
            connected: connected
        });
        
        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        }
    }
    
    start() {
        // Start the server
        this.server.listen(this.port, () => {
            console.log(`Frame server running on http://localhost:${this.port}`);
        });
        
        // Start the frame capture
        this.frameCapture.connect();
    }
    
    stop() {
        this.frameCapture.disconnect();
        this.server.close();
    }
}

module.exports = FrameServer;
const express = require('express');
const multer = require('multer');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');

// Import our camera stream modules
const cameraStream = require('./esp32-cam/camera-rec');
const esp32Cam = require('./esp32-cam');

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3000;

// WebSocket server for both frontend and Pi connections
const wss = new WebSocket.Server({ server, path: '/robot' }); 

// Store connections
let frontendConnections = new Set();
let piConnection = null;

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
    // The connection is initially unknown
    let isRaspberryPi = false;
    
    console.log('New WebSocket connection from:', req.socket.remoteAddress);
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            // Identify if this is the Raspberry Pi based on the initial message
            if (data.type === 'identity' && data.device === 'raspberry_pi') {
                console.log('Raspberry Pi identified and connected');
                
                // Store this connection as the Pi
                piConnection = ws;
                isRaspberryPi = true;
                
                // Notify all frontend clients that Pi is connected
                frontendConnections.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ 
                            type: 'status', 
                            connected: true 
                        }));
                    }
                });
                
                // Try to connect to the camera stream
                const piIp = req.socket.remoteAddress.replace(/^::ffff:/, '');
                cameraStream.connect(piIp);
                
                return;
            }
            
            // Handle control messages from frontend to Pi
            if (!isRaspberryPi && data.type === 'control') {
                if (piConnection && piConnection.readyState === WebSocket.OPEN) {
                    piConnection.send(JSON.stringify(data));
                    console.log(`Command forwarded to Pi: ${data.direction} - ${data.isActive}`);
                } else {
                    console.log('Cannot forward command: Pi not connected');
                    // Inform the client that Pi isn't connected
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Raspberry Pi is not connected'
                    }));
                }
            }
            
            // Handle servo motor messages from frontend to Pi
            if (!isRaspberryPi && data.type === 'servo') {
                if (piConnection && piConnection.readyState === WebSocket.OPEN) {
                    piConnection.send(JSON.stringify(data));
                    console.log(`Servo command forwarded to Pi: Motor ${data.motor_id}, Direction: ${data.value}, Active: ${data.is_active}`);
                } else {
                    console.log('Cannot forward servo command: Pi not connected');
                    // Inform the client that Pi isn't connected
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Raspberry Pi is not connected'
                    }));
                }
            }

            // Handle stream request from frontend
            if (!isRaspberryPi && data.type === 'stream_request') {
                if (cameraStream.isStreamConnected()) {
                    ws.cameraStreamEnabled = true;
                    console.log('Camera stream requested by client. Stream is active.');
                    
                    // Send initial confirmation
                    ws.send(JSON.stringify({
                        type: 'stream_status',
                        connected: true
                    }));
                } else {
                    console.log('Camera stream requested but camera is not connected');
                    ws.send(JSON.stringify({
                        type: 'stream_status',
                        connected: false,
                        message: 'Camera is not connected'
                    }));
                }
            }
            
            // Forward Pi messages to all frontend clients
            if (isRaspberryPi) {
                frontendConnections.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(message);
                    }
                });
            }
            
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    });
    
    ws.on('close', () => {
        if (isRaspberryPi) {
            console.log('Raspberry Pi disconnected');
            piConnection = null;
            
            // Notify all frontend clients that Pi is disconnected
            frontendConnections.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ 
                        type: 'status', 
                        connected: false 
                    }));
                }
            });
        } else {
            console.log('Frontend client disconnected');
            frontendConnections.delete(ws);
        }
    });
    
    // If not a Pi connection, add to frontend connections
    if (!isRaspberryPi) {
        frontendConnections.add(ws);
        
        // Send initial Pi connection status
        ws.send(JSON.stringify({ 
            type: 'status', 
            connected: piConnection !== null && piConnection.readyState === WebSocket.OPEN 
        }));
    }
});

// Camera stream events
cameraStream.on('frame', (frameBuffer) => {
    // Convert frame buffer to base64
    const frameBase64 = frameBuffer.toString('base64');
    
    // Send frame to all connected frontend clients that requested the stream
    frontendConnections.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.cameraStreamEnabled) {
            client.send(JSON.stringify({
                type: 'camera_frame',
                data: frameBase64
            }));
        }
    });
});

cameraStream.on('connected', () => {
    console.log('Camera stream connected successfully');
    // Notify all frontend clients
    frontendConnections.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'stream_status',
                connected: true
            }));
        }
    });
});

cameraStream.on('disconnected', () => {
    console.log('Camera stream disconnected');
    // Notify all frontend clients
    frontendConnections.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'stream_status',
                connected: false
            }));
        }
    });
});

// ESP32Cam direct stream events
esp32Cam.on('connected', () => {
    console.log('ESP32-CAM direct stream connected');
});

esp32Cam.on('disconnected', () => {
    console.log('ESP32-CAM direct stream disconnected');
});

// Add routes for serving frames directly (not through WebSockets)
app.get('/cam-stream', (req, res) => {
    res.sendFile(path.join(__dirname, 'templates', 'cam-stream.html'));
});

app.get('/frame', (req, res) => {
    const frame = esp32Cam.getLatestFrame();
    if (!frame) {
        res.status(404).send('No frame available');
        return;
    }
    
    res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': frame.length
    });
    res.end(frame);
});

// Enable CORS for development
app.use(cors());

// Serve static files from the frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function(req, file, cb) {
        // Create a unique filename
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'));
        }
    }
});

// API route for processing images
app.post('/api/process-image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            console.error('No file uploaded');
            return res.status(400).json({ error: 'No image file uploaded' });
        }
        
        console.log('File received:', req.file.originalname);
        console.log('File saved to:', req.file.path);

        // Create output directory if it doesn't exist
        const outputDir = path.join(__dirname, 'outputs');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
            console.log('Created output directory:', outputDir);
        }

        // Define input and output paths
        const inputPath = req.file.path;
        const outputPath = path.join(outputDir, 'processed-' + path.basename(inputPath));
        console.log('Output path will be:', outputPath);

        // Get the absolute path to the Python script
        const pythonScriptPath = path.resolve(path.join(__dirname, '../ai/process_image.py'));
        console.log('Python script path:', pythonScriptPath);

        // Check if Python script exists
        if (!fs.existsSync(pythonScriptPath)) {
            console.error('Python script not found at:', pythonScriptPath);
            return res.status(500).json({ error: 'Image processing script not found' });
        }

        // Determine which Python command to use based on OS
        let pythonCommand = 'python';
        if (process.platform === 'win32') {
            // On Windows, try 'py' first
            try {
                require('child_process').execSync('py --version');
                pythonCommand = 'py';
                console.log('Using Python command: py');
            } catch (error) {
                // Fall back to python
                console.log('Falling back to python command');
            }
        } else if (process.platform === 'darwin' || process.platform === 'linux') {
            // On macOS/Linux, try python3 first
            try {
                require('child_process').execSync('python3 --version');
                pythonCommand = 'python3';
                console.log('Using Python command: python3');
            } catch (error) {
                console.log('Falling back to python command');
            }
        }

        // Run the Python script to process the image
        console.log(`Spawning ${pythonCommand} process with arguments:`, [pythonScriptPath, inputPath, outputPath]);
        const pythonProcess = spawn(pythonCommand, [
            pythonScriptPath,
            inputPath,
            outputPath
        ]);

        let pythonError = '';
        pythonProcess.stderr.on('data', (data) => {
            const errorText = data.toString();
            pythonError += errorText;
            console.error('Python stderr:', errorText);
        });

        pythonProcess.stdout.on('data', (data) => {
            console.log('Python stdout:', data.toString());
        });

        pythonProcess.on('close', (code) => {
            console.log(`Python process exited with code ${code}`);
            
            if (code !== 0) {
                console.error(`Python error: ${pythonError}`);
                return res.status(500).json({ error: `Failed to process image: ${pythonError}` });
            }

            // Check if output file exists
            if (!fs.existsSync(outputPath)) {
                console.error('Output file was not generated at:', outputPath);
                return res.status(500).json({ error: 'Output file was not generated' });
            }

            console.log('Image processed successfully, reading file');
            // Read the processed image file
            const processedImage = fs.readFileSync(outputPath);
            const base64Image = Buffer.from(processedImage).toString('base64');
            
            console.log('Sending processed image to client');
            // Send the processed image back to the client
            res.json({ processedImage: base64Image });

            // Clean up temporary files
            setTimeout(() => {
                try {
                    fs.unlinkSync(inputPath);
                    fs.unlinkSync(outputPath);
                    console.log('Temporary files cleaned up');
                } catch (err) {
                    console.error('Error cleaning up temporary files:', err);
                }
            }, 60000); // Clean up after 1 minute
        });
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: `Internal server error: ${error.message}` });
    }
});

// Handle all other requests by serving the main HTML file
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/interface.html'));
});

// Start the server
server.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
    console.log(`WebSocket server is running on ws://localhost:${port}/robot`);
    console.log(`Direct camera stream available at http://localhost:${port}/cam-stream`);
    
    // Try to connect to the ESP32-CAM when server starts
    cameraStream.connect();
    esp32Cam.start();
});
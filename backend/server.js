const express = require('express');
const multer = require('multer');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');

// Import our camera stream module
const esp32Cam = require('./esp32-cam');

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3000;

// WebSocket server for both frontend and Pi connections
const wss = new WebSocket.Server({ server, path: '/robot' }); 

// Store connections
let frontendConnections = new Set();
let piConnection = null;
let processingQueue = []; // Queue for frames waiting to be processed
let isProcessing = false; // Flag to prevent multiple simultaneous processing

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
                esp32Cam.start(piIp);
                
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
                if (esp32Cam.isConnected()) {
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
            
            // Handle real-time detection toggle
            if (!isRaspberryPi && data.type === 'detection_mode') {
                ws.realTimeDetectionEnabled = data.enabled;
                console.log(`Real-time detection ${data.enabled ? 'enabled' : 'disabled'} for client`);
                
                // Send confirmation
                ws.send(JSON.stringify({
                    type: 'detection_status',
                    enabled: data.enabled
                }));
            }
            
            // Handle stream cancellation request
            if (!isRaspberryPi && data.type === 'cancel_stream') {
                ws.cameraStreamEnabled = false;
                console.log('Camera stream cancelled by client');
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

// Process frames for object detection
async function processFrameForDetection(frameBuffer) {
    if (!frameBuffer) return null;
    
    try {
        // Save frame to temporary file
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const inputPath = path.join(tempDir, `frame_${Date.now()}.jpg`);
        const outputPath = path.join(tempDir, `processed_${Date.now()}.jpg`);
        
        fs.writeFileSync(inputPath, frameBuffer);
        
        // Get the absolute path to the Python script
        const pythonScriptPath = path.resolve(path.join(__dirname, '../ai/process_image.py'));
        
        // Determine which Python command to use based on OS
        let pythonCommand = 'python';
        if (process.platform === 'win32') {
            try {
                require('child_process').execSync('py --version');
                pythonCommand = 'py';
            } catch (error) {
                console.log('Falling back to python command');
            }
        } else if (process.platform === 'darwin' || process.platform === 'linux') {
            try {
                require('child_process').execSync('python3 --version');
                pythonCommand = 'python3';
            } catch (error) {
                console.log('Falling back to python command');
            }
        }
        
        return new Promise((resolve, reject) => {
            const pythonProcess = spawn(pythonCommand, [
                pythonScriptPath,
                inputPath,
                outputPath
            ]);
            
            let pythonError = '';
            pythonProcess.stderr.on('data', (data) => {
                pythonError += data.toString();
            });
            
            pythonProcess.on('close', (code) => {
                if (code !== 0) {
                    console.error(`Python error: ${pythonError}`);
                    // Clean up files
                    try {
                        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                    } catch (err) {}
                    reject(new Error(`Failed to process frame: ${pythonError}`));
                    return;
                }
                
                // Read the processed image file
                try {
                    if (!fs.existsSync(outputPath)) {
                        reject(new Error('Processed file not found'));
                        return;
                    }
                    
                    const processedImage = fs.readFileSync(outputPath);
                    const base64Image = Buffer.from(processedImage).toString('base64');
                    
                    // Clean up files
                    try {
                        fs.unlinkSync(inputPath);
                        fs.unlinkSync(outputPath);
                    } catch (err) {
                        console.error('Error cleaning up temporary files:', err);
                    }
                    
                    resolve(base64Image);
                } catch (err) {
                    console.error('Error reading processed image:', err);
                    reject(err);
                }
            });
        });
    } catch (error) {
        console.error('Error in processFrameForDetection:', error);
        return null;
    }
}

// Process the queue of frames
async function processQueue() {
    if (isProcessing || processingQueue.length === 0) return;
    
    isProcessing = true;
    
    try {
        const { frameBuffer, clients } = processingQueue.shift();
        
        const base64Image = await processFrameForDetection(frameBuffer);
        
        if (base64Image) {
            // Send processed frame to all clients who requested it
            clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN && client.realTimeDetectionEnabled) {
                    client.send(JSON.stringify({
                        type: 'detection_frame',
                        data: base64Image
                    }));
                }
            });
        }
    } catch (error) {
        console.error('Error in processQueue:', error);
    } finally {
        isProcessing = false;
        
        // Process next item in queue
        if (processingQueue.length > 0) {
            processQueue();
        }
    }
}

// Camera stream events
esp32Cam.on('frame', (frameBuffer) => {
    // Convert frame buffer to base64
    const frameBase64 = frameBuffer.toString('base64');
    
    // Keep track of clients requesting real-time detection
    const detectionClients = Array.from(frontendConnections).filter(
        client => client.readyState === WebSocket.OPEN && client.realTimeDetectionEnabled
    );
    
    // Send frame to all connected frontend clients that requested the stream
    frontendConnections.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.cameraStreamEnabled) {
            client.send(JSON.stringify({
                type: 'camera_frame',
                data: frameBase64
            }));
        }
    });
    
    // If we have clients with real-time detection enabled and 
    // the queue is not too large, add the frame to the processing queue
    if (detectionClients.length > 0 && processingQueue.length < 3) { // Increased from 2 to 3
        processingQueue.push({
            frameBuffer,
            clients: detectionClients
        });
        
        // Start processing if not already processing
        if (!isProcessing) {
            processQueue();
        }
    }
});

esp32Cam.on('connected', () => {
    console.log('ESP32-CAM stream connected successfully');
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

esp32Cam.on('disconnected', () => {
    console.log('ESP32-CAM stream disconnected');
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
    esp32Cam.start();
});
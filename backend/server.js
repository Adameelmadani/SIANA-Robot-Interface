const express = require('express');
const multer = require('multer');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');

let piServerUrl = 'ws://192.168.12.116'; // Default Pi server URL

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3000;

// WebSocket server for frontend connections
const wss = new WebSocket.Server({ server, path: '/robot' }); 

// Store connections
let frontendConnections = new Set();
let piConnection = null;

// Function to connect to the Raspberry Pi WebSocket server
function connectToPi() {
    console.log(`Connecting to Raspberry Pi at ${piServerUrl}...`);
    const ws = new WebSocket(piServerUrl);
    
    ws.on('open', () => {
        console.log(`Connected to Raspberry Pi at ${piServerUrl}`);
        piConnection = ws;
        
        // Notify all connected frontend clients
        frontendConnections.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'status', connected: true }));
            }
        });
    });
    
    ws.on('message', (message) => {
        console.log('Message from Pi:', message.toString());
        
        // Forward messages to all connected frontend clients
        frontendConnections.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    });
    
    ws.on('close', () => {
        console.log('Disconnected from Raspberry Pi');
        piConnection = null;
        
        // Notify all connected frontend clients
        frontendConnections.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'status', connected: false }));
            }
        });
        
        // Try to reconnect after a delay
        setTimeout(connectToPi, 5000);
    });
    
    ws.on('error', (error) => {
        console.error('Error connecting to Raspberry Pi:', error.message);
    });
}

// Handle frontend WebSocket connections
wss.on('connection', (ws) => {
    console.log('Frontend client connected');
    frontendConnections.add(ws);
    
    // Send initial connection status
    ws.send(JSON.stringify({ 
        type: 'status', 
        connected: piConnection !== null && piConnection.readyState === WebSocket.OPEN 
    }));
    
    ws.on('message', (message) => {
        // Forward control commands to Raspberry Pi
        try {
            const data = JSON.parse(message);
            if (data.type === 'control' && piConnection && piConnection.readyState === WebSocket.OPEN) {
                piConnection.send(JSON.stringify(data));
                console.log(`Command forwarded to Pi: ${data.direction} - ${data.isActive}`);
            }
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    });
    
    ws.on('close', () => {
        console.log('Frontend client disconnected');
        frontendConnections.delete(ws);
    });
});

// Connect to the Raspberry Pi WebSocket server
connectToPi();

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
    console.log(`Connecting to Raspberry Pi WebSocket server at ${piServerUrl}`);
});
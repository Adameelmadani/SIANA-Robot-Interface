
const FrameServer = require('./frame-server');
const fs = require('fs');
const path = require('path');

// Create a basic placeholder image if it doesn't exist
const placeholderPath = path.join(__dirname, 'placeholder.jpg');
if (!fs.existsSync(placeholderPath)) {
    // Generate a simple placeholder image
    const { createCanvas } = require('canvas');
    const canvas = createCanvas(640, 480);
    const ctx = canvas.getContext('2d');
    
    // Fill background
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 0, 640, 480);
    
    // Add text
    ctx.fillStyle = '#fff';
    ctx.font = '24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Waiting for camera stream...', 320, 240);
    
    // Save the image
    const buffer = canvas.toBuffer('image/jpeg');
    fs.writeFileSync(placeholderPath, buffer);
    console.log('Created placeholder image');
}

// Start the frame server
const server = new FrameServer({
    port: 3001,
    cameraIP: '192.168.4.1', // ESP32-CAM IP address
    maxFrames: 30, // Keep 30 frames max in storage
    frameRate: 15  // Send frames to clients at 15 fps
});

server.start();

console.log('Test server running. Open http://localhost:3001 in your browser to view the stream');
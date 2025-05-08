const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const app = express();
const port = 3000;
const FRAMES_DIR = './frames';
const MAX_FRAMES = 5;
const ESP32_STREAM_URL = "[http://192.168.4.1/stream](http://192.168.4.1/stream)"; // ESP32-CAM URL
let frame_count = 0;

// Create frames directory if it doesn't exist
if (!fs.existsSync(FRAMES_DIR)) {
    fs.mkdirSync(FRAMES_DIR);
}

function cleanupFrames() {
    fs.readdir(FRAMES_DIR, (err, files) => {
        if (err) {
            console.error("Error reading directory:", err);
            return; // Exit,  don't try to process files.
        }
        if (files.length > MAX_FRAMES) {
            files.sort((a, b) => {
                const numA = parseInt(a.replace('frame_', '').replace('.jpg', ''), 10);
                const numB = parseInt(b.replace('frame_', '').replace('.jpg', ''), 10);
                return numA - numB;
            });
            const filesToDelete = files.slice(0, files.length - MAX_FRAMES);
            filesToDelete.forEach(file => {
                fs.unlink(path.join(FRAMES_DIR, file), (err) => {
                    if (err) {
                        console.error(`Error deleting file ${file}:`, err);
                    }
                });
            });
        }
    });
}

function captureFrames() {
    const ffmpeg = spawn('ffmpeg', [
        '-i', ESP32_STREAM_URL,
        '-q:v', '2',        // Quality
        '-f', 'image2',
        '-update', '1',
        path.join(FRAMES_DIR, 'frame_%05d.jpg') // Naming convention
    ]);

    ffmpeg.stderr.on('data', (data) => {
        console.error(`ffmpeg stderr: ${data}`);
    });

    ffmpeg.on('close', (code) => {
        console.log(`ffmpeg process exited with code ${code}`);
        // Consider restarting ffmpeg here if the stream is interrupted
        //  setTimeout(captureFrames, 5000); // Restart after 5 seconds
    });
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/frame', (req, res) => {
    fs.readdir(FRAMES_DIR, (err, files) => {
        if (err) {
            console.error("Error reading frames directory:", err);
            res.status(500).send("Internal Server Error");
            return;
        }

        if (files.length === 0) {
            // Send a placeholder if no frames are available.
            res.contentType('image/jpeg');
            res.end(); // Send empty response.
            return;
        }
        // Sort files to get the latest frame.
        files.sort((a, b) => {
            const numA = parseInt(a.replace('frame_', '').replace('.jpg', ''), 10);
            const numB = parseInt(b.replace('frame_', '').replace('.jpg', ''), 10);
            return numA - numB;
        });
        const latestFrame = files[files.length - 1];
        fs.readFile(path.join(FRAMES_DIR, latestFrame), (err, data) => {
            if (err) {
                console.error("Error reading latest frame:", err);
                res.status(500).send("Internal Server Error");
                return;
            }
            res.contentType('image/jpeg');
            res.send(data);
        });
    });
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
    captureFrames(); // Start capturing frames
});
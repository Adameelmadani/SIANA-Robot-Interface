/**
 * ESP32-CAM stream handler module that uses FFmpeg to capture frames from the ESP32-CAM's MJPEG stream
 * and serves them via HTTP.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class ESP32CamHandler extends EventEmitter {
  constructor() {
    super();
    // Configuration
    this.streamUrl = 'http://192.168.4.1/stream';
    this.framesDir = path.join(__dirname, 'frames');
    this.maxFrames = 5;
    
    // State variables
    this.latestFrame = null;
    this.capturing = false;
    this.ffmpegProcess = null;
    this.connected = false;
  }

  // Create frames directory if it doesn't exist
  createFramesDirectory() {
    if (!fs.existsSync(this.framesDir)) {
      try {
        fs.mkdirSync(this.framesDir, { recursive: true });
        console.log(`Created frames directory: ${this.framesDir}`);
        return true;
      } catch (err) {
        console.error(`Error creating frames directory: ${err}`);
        return false;
      }
    }
    return true;
  }

  // Clean up old frames to prevent disk from filling up
  cleanupFrames() {
    try {
      fs.readdir(this.framesDir, (err, files) => {
        if (err) {
          console.error("Error reading directory:", err);
          return;
        }
        
        if (files.length > this.maxFrames) {
          files.sort((a, b) => {
            const numA = parseInt(a.replace('frame_', '').replace('.jpg', ''), 10);
            const numB = parseInt(b.replace('frame_', '').replace('.jpg', ''), 10);
            return numA - numB;
          });
          
          const filesToDelete = files.slice(0, files.length - this.maxFrames);
          filesToDelete.forEach(file => {
            fs.unlink(path.join(this.framesDir, file), (err) => {
              if (err) {
                console.error(`Error deleting file ${file}:`, err);
              }
            });
          });
        }
      });
    } catch (err) {
      console.error(`Error in cleanup: ${err}`);
    }
  }

  // Start capturing frames from the ESP32-CAM
  start(ipAddress) {
    if (this.capturing) {
      console.log('Already capturing frames');
      return;
    }
    
    if (ipAddress) {
      this.streamUrl = `http://${ipAddress}/stream`;
    }
    
    if (!this.createFramesDirectory()) {
      console.error('Failed to create frames directory. Cannot start capturing.');
      return;
    }
    
    this.capturing = true;
    console.log(`Starting ESP32-CAM frame capture from ${this.streamUrl}`);
    this.captureFrames();
  }

  // Main function to capture frames using FFmpeg
  captureFrames() {
    if (this.ffmpegProcess) {
      this.ffmpegProcess.kill();
    }
    
    try {
      this.ffmpegProcess = spawn('ffmpeg', [
        '-i', this.streamUrl,
        '-q:v', '2',        // Quality
        '-f', 'image2',
        '-update', '1',
        path.join(this.framesDir, 'frame_%05d.jpg') // Naming convention
      ]);
      
      this.connected = true;
      this.emit('connected');

      this.ffmpegProcess.stderr.on('data', (data) => {
        console.error(`ffmpeg stderr: ${data}`);
      });

      this.ffmpegProcess.on('close', (code) => {
        console.log(`ffmpeg process exited with code ${code}`);
        this.connected = false;
        this.emit('disconnected');
        
        // Restart FFmpeg after a delay if we're still supposed to be capturing
        if (this.capturing) {
          console.log('Attempting to restart FFmpeg in 5 seconds...');
          setTimeout(() => this.captureFrames(), 5000);
        }
      });
      
      // Set up a watcher for the frames directory
      this.setupFrameWatcher();
      
    } catch (error) {
      console.error(`Error starting FFmpeg: ${error}`);
      this.connected = false;
      this.emit('disconnected');
      
      // Try to restart after a delay
      if (this.capturing) {
        setTimeout(() => this.captureFrames(), 5000);
      }
    }
  }
  
  // Watch for new frames and emit events
  setupFrameWatcher() {
    // Check for new frames periodically
    setInterval(() => {
      if (!this.capturing) return;
      
      fs.readdir(this.framesDir, (err, files) => {
        if (err) {
          console.error("Error reading frames directory:", err);
          return;
        }
        
        if (files.length === 0) return;
        
        // Sort files to get the latest frame
        files.sort((a, b) => {
          const numA = parseInt(a.replace('frame_', '').replace('.jpg', ''), 10);
          const numB = parseInt(b.replace('frame_', '').replace('.jpg', ''), 10);
          return numB - numA; // Descending order to get latest first
        });
        
        const latestFrameFile = files[0];
        
        // Read the latest frame
        fs.readFile(path.join(this.framesDir, latestFrameFile), (err, data) => {
          if (err) {
            console.error(`Error reading latest frame: ${err}`);
            return;
          }
          
          // Save the latest frame in memory
          this.latestFrame = data;
          
          // Emit frame event
          this.emit('frame', data);
          
          // Clean up old frames
          this.cleanupFrames();
        });
      });
    }, 100); // Check every 100ms
  }

  // Stop capturing frames
  stop() {
    this.capturing = false;
    
    if (this.ffmpegProcess) {
      this.ffmpegProcess.kill();
      this.ffmpegProcess = null;
    }
    
    this.connected = false;
    console.log('ESP32-CAM frame capture stopped');
  }

  // Get the latest frame for direct HTTP serving
  getLatestFrame() {
    return this.latestFrame;
  }

  // Check if connected to stream
  isConnected() {
    return this.connected;
  }
}

// Create and export a singleton instance
module.exports = new ESP32CamHandler();
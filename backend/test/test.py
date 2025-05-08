"""
This code provides a Python Flask server that acts as an intermediary
between an ESP32-CAM and web clients.  It addresses the ESP32-CAM's
limitation of only supporting a single client connection.

Key Functionality:
1. ESP32-CAM Stream Capture:
    - The server continuously fetches JPEG frames from the ESP32-CAM's
      streaming endpoint (http://192.168.4.1/stream).
    -  It's assumed the ESP32-CAM is configured as a WiFi access point
       with the IP address 192.168.4.1.

2. Frame Storage:
    -  Each received frame is saved as a JPEG file in a temporary
       directory (./frames).
    -  The filename is a sequential number (frame_00001.jpg, frame_00002.jpg, etc.)
    -  Older frames are deleted to prevent disk overflow, keeping only the
       most recent frames (controlled by MAX_FRAMES).

3. Web Interface:
    -  The Flask server serves a simple HTML page ('index.html') that
       displays the latest captured frame.
    -  The page uses a continuously refreshing <img> tag to show the
       most recent JPEG image.  A small delay is introduced to manage
       refresh rate.

4. Multi-Client Support:
    -  The server architecture allows multiple web clients to view the
       stream simultaneously, even though the ESP32-CAM can only stream
       to one client.  Each client gets the latest saved frame.

5. Frame Serving Endpoint:
    -  The '/frame' route serves the latest frame to the client.  The
       client's browser caches the image, so we append a changing query
       parameter to the URL to force a reload of the image.

Important Considerations:
* ESP32-CAM Configuration:  This code assumes your ESP32-CAM is
    configured as a WiFi access point at 192.168.4.1 and is streaming
    video at /stream.  You'll need to configure your ESP32-CAM
    accordingly.  This is usually done in the ESP32-CAM Arduino code.
* Network Setup:  The server running this code must be able to
    connect to the ESP32-CAM (i.e., be on the same network or
    able to route to it).
* Frame Rate:  The frame rate is limited by the ESP32-CAM's
    capabilities, the network conditions, and the speed at which
    the server can save and serve frames.  The `time.sleep(0.05)`
    in the `capture_frames` function controls how often a new frame
    is grabbed from the ESP32-CAM.  Adjust this value as needed.
* Error Handling:  The code includes basic error handling (e.g.,
    checking for the existence of the frames directory).  More
    robust error handling should be added for a production
    environment.
* Performance: Saving each frame to disk can be I/O intensive.
    For higher frame rates or more users, consider alternative
    approaches like storing frames in memory (e.g., using a circular
    buffer) or using a streaming protocol like MJPEG directly, if
    your application allows for higher latency.  However, the direct
    streaming approach would require significant changes to this code
    and is more complex.
* Security: This code does not include any security measures
    (e.g., authentication).  If you are using this in a production
    environment, you will need to add appropriate security.
* index.html: This file should be in the same directory as the
    Python script.
"""

import cv2  # Import OpenCV
import threading
import time
import os
import shutil
from flask import Flask, Response, render_template, send_from_directory, request

app = Flask(__name__)

# Configuration
ESP32_STREAM_URL = "http://192.168.4.1/stream"  # ESP32-CAM stream URL
FRAMES_DIR = "./frames"  # Directory to store frames
MAX_FRAMES = 5  # Maximum number of frames to keep
FRAME_DELAY = 0.05 # Delay between frame captures.  Adjust as needed.

# Global variables
latest_frame = None
frame_count = 0
frame_lock = threading.Lock()
capturing = True

def create_frames_directory():
    """
    Creates the frames directory if it does not exist.
    """
    if not os.path.exists(FRAMES_DIR):
        try:
            os.makedirs(FRAMES_DIR)
        except OSError as e:
            print(f"Error creating frames directory: {e}")
            return False
    return True

def cleanup_frames():
    """
    Cleans up old frames, keeping only the last MAX_FRAMES.
    """
    files = sorted(os.listdir(FRAMES_DIR))
    if len(files) > MAX_FRAMES:
        files_to_delete = files[:-MAX_FRAMES]
        for file_name in files_to_delete:
            try:
                os.remove(os.path.join(FRAMES_DIR, file_name))
            except OSError as e:
                print(f"Error deleting frame {file_name}: {e}")

def capture_frames():
    """
    Continuously captures frames from the ESP32-CAM stream,
    saves them to files, and cleans up old frames.
    """
    global latest_frame, frame_count, capturing
    if not create_frames_directory():
        print("Failed to create frames directory.  Exiting capture thread.")
        capturing = False # Stop the capture thread.
        return

    # Use a try-except block to handle potential errors during the capture process
    try:
        # Use cv2.VideoCapture to get the video stream from the ESP32-CAM.
        cap = cv2.VideoCapture(ESP32_STREAM_URL)
        if not cap.isOpened():
            print(f"Error: Could not open stream from {ESP32_STREAM_URL}. Check ESP32-CAM connection and IP address.")
            capturing = False
            return

        while capturing:
            ret, frame = cap.read()  # Read a frame from the video stream.

            if not ret or frame is None:
                print("Error: Failed to receive frame (or frame is None).  Check ESP32-CAM stream.")
                # Attempt to reopen the connection.  You might want to add a delay here.
                cap.release()
                time.sleep(5) # Wait 5 seconds before retrying
                cap = cv2.VideoCapture(ESP32_STREAM_URL) # Re-create the capture object.
                if not cap.isOpened():
                    print("Error: Could not reopen stream.")
                    capturing = False # Stop capturing
                    break
                continue  # Go back to the beginning of the loop and try to read again.

            with frame_lock:
                latest_frame = frame # Store the frame

            # Save the frame to a file.
            frame_filename = os.path.join(FRAMES_DIR, f"frame_{frame_count:05d}.jpg")
            try:
                cv2.imwrite(frame_filename, frame)
            except OSError as e:
                print(f"Error saving frame to {frame_filename}: {e}")

            frame_count += 1
            cleanup_frames()
            time.sleep(FRAME_DELAY)  # Add a small delay to control frame rate.

        # Cleanly release the video capture object when the loop is finished.
        cap.release()

    except Exception as e:
        print(f"An error occurred in the capture_frames thread: {e}")
        capturing = False # Stop capturing
    finally:
        print("Capture thread finished.")

@app.route('/')
def index():
    """
    Serves the main HTML page, which displays the video stream.
    """
    return render_template('index.html')

@app.route('/frame')
def get_frame():
    """
    Serves the latest captured frame as a JPEG image.  The 'ts' parameter
    is a cache-busting timestamp.
    """
    global latest_frame
    with frame_lock: # Aquire the lock.
        if latest_frame is None:
            # Return a placeholder if no frame is available.
            return Response(b'', mimetype='image/jpeg') # Return empty JPEG
        else:
            # Encode the frame as a JPEG.
            ret, jpeg = cv2.imencode('.jpg', latest_frame)
            if not ret:
                return Response(b'', mimetype='image/jpeg')
            return Response(jpeg.tobytes(), mimetype='image/jpeg')

@app.route('/frames/<filename>')
def serve_frame(filename):
    """
    Serves a specific frame from the frames directory.  This route is not
    directly used by the current 'index.html', but it can be useful for
    debugging or for implementing alternative display methods.
    """
    return send_from_directory('frames', filename)

def start_server():
    """Starts the Flask server."""
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)

if __name__ == "__main__":
    # Create the frames directory.
    if not create_frames_directory():
        print("Failed to create frames directory. Exiting.")
        exit(1)

    # Start the frame capture thread.
    capture_thread = threading.Thread(target=capture_frames)
    capture_thread.daemon = True  # Allow the main thread to exit even if this thread is running.
    capture_thread.start()

    # Start the Flask server in the main thread.
    start_server()
    # Code will reach here only after the Flask server is stopped.
    capturing = False # Ensure the capture thread knows to stop.
    capture_thread.join() # Wait for the capture thread to finish.
    print("Server and capture thread stopped.")

import cv2
import numpy as np
import time
from ultralytics import YOLO
import yaml # For reading the data.yaml file
import json
import os
from datetime import datetime
from flask import Flask, Response, render_template
from flask_cors import CORS

# --- Flask App Initialization ---
app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# --- Configuration - MODIFY THESE ---
ESP32_STREAM_URL = "http://192.168.4.1/stream"  # IMPORTANT: Replace with your ESP32-CAM's IP

# --- YOLOv8 Model Configuration ---
YOLO_MODEL_PATH = "best.pt"  # Path to your trained YOLOv8 model
CONFIDENCE_THRESHOLD = 0.5  # Minimum confidence for detection

# Load the model
try:
    model = YOLO(YOLO_MODEL_PATH)
    print(f"Model loaded successfully from {YOLO_MODEL_PATH}")
except Exception as e:
    print(f"Error loading model: {e}")
    model = None

# Initialize camera
cap = None

def get_camera():
    global cap
    if cap is None or not cap.isOpened():
        # Try to connect to ESP32-CAM stream
        try:
            cap = cv2.VideoCapture(ESP32_STREAM_URL)
            if not cap.isOpened():
                print("Failed to open ESP32-CAM stream, using default camera")
                cap = cv2.VideoCapture(0)  # Fallback to default camera
        except Exception as e:
            print(f"Error connecting to ESP32-CAM: {e}")
            cap = cv2.VideoCapture(0)  # Fallback to default camera
    return cap

def generate_frames():
    while True:
        cap = get_camera()
        success, frame = cap.read()
        if not success:
            print("Failed to capture frame, reconnecting...")
            cap.release()
            cap = None
            time.sleep(1)
            continue

        # Process frame here (optional)
        # If you want to run object detection:
        if model is not None:
            results = model(frame)
            # Draw detections
            for result in results:
                boxes = result.boxes.cpu().numpy()
                for box in boxes:
                    x1, y1, x2, y2 = box.xyxy[0].astype(int)
                    conf = box.conf[0]
                    cls = int(box.cls[0])
                    if conf > CONFIDENCE_THRESHOLD:
                        # Draw bounding box
                        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                        # Add label
                        label = f"{model.names[cls]} {conf:.2f}"
                        cv2.putText(frame, label, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)

        # Encode frame to JPEG
        ret, buffer = cv2.imencode('.jpg', frame)
        frame_bytes = buffer.tobytes()
        
        # Yield the frame in MJPEG format
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')

@app.route('/video_feed')
def video_feed():
    return Response(generate_frames(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/')
def index():
    return render_template('index.html')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
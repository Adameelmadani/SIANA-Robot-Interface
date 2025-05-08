import cv2
import numpy as np
import time
from ultralytics import YOLO
import yaml # For reading the data.yaml file
import json
import os
from datetime import datetime

# --- Configuration - MODIFY THESE ---
ESP32_STREAM_URL = "http://192.168.4.1/stream"  # IMPORTANT: Replace with your ESP32-CAM's IP

# --- YOLOv8 Model Configuration ---
YOLO_MODEL_PATH = "C:/Users/libre/Desktop/SIANA/cam2/best.pt"        # Path to your downloaded best.pt
DATA_YAML_PATH = "C:/Users/libre/Desktop/SIANA/cam2/data.yaml"      # Path to your downloaded data.yaml
CONFIDENCE_THRESHOLD = 0.5  # Minimum confidence to display a detection

# --- Reporting Configuration - MODIFY THESE ---
OPERATOR_NAME = "Operator_A"
OPERATOR_ID = "EMP789"
OPERATOR_QUALIFICATION = "Certified Technician Level II"

DETECTIONS_BASE_DIR = "detection_reports" # Base directory for reports
IMAGES_SUBDIR = "images" # Subdirectory for images within DETECTIONS_BASE_DIR
JSON_REPORT_FILENAME = "maintenance_report.json"

# --- Create directories if they don't exist ---
detections_image_dir = os.path.join(DETECTIONS_BASE_DIR, IMAGES_SUBDIR)
os.makedirs(detections_image_dir, exist_ok=True) # exist_ok=True prevents error if dir already exists
json_report_path = os.path.join(DETECTIONS_BASE_DIR, JSON_REPORT_FILENAME)

# --- Load Class Labels from data.yaml ---
class_labels = []
try:
    with open(DATA_YAML_PATH, 'r') as f:
        data_config = yaml.safe_load(f)
        if 'names' in data_config:
            class_labels = data_config['names']
            print(f"[INFO] Loaded {len(class_labels)} class labels: {class_labels}")
        else:
            print(f"Error: 'names' key not found in {DATA_YAML_PATH}. Cannot load class labels.")
            exit()
except FileNotFoundError:
    print(f"Error: data.yaml file not found at {DATA_YAML_PATH}")
    exit()
except yaml.YAMLError as e:
    print(f"Error parsing YAML file {DATA_YAML_PATH}: {e}")
    exit()

# --- Load the YOLOv8 Model ---
print(f"[INFO] Loading YOLOv8 model from {YOLO_MODEL_PATH}...")
try:
    model = YOLO(YOLO_MODEL_PATH)
    # model = YOLO(YOLO_MODEL_PATH, task='detect').to('cpu') # Force CPU if needed
    print("[INFO] YOLOv8 model loaded successfully.")
except Exception as e:
    print(f"Error loading YOLOv8 model: {e}")
    exit()

# --- Connect to ESP32 Stream ---
print(f"[INFO] Connecting to ESP32 stream at {ESP32_STREAM_URL}...")
cap = cv2.VideoCapture(ESP32_STREAM_URL)

if not cap.isOpened():
    print(f"Error: Could not open video stream from {ESP32_STREAM_URL}")
    exit()
else:
    print("[INFO] Successfully connected to ESP32 stream.")

# --- Main Processing Loop ---
frame_count_fps = 0
start_time_fps = time.time()
# To prevent saving the same defect multiple times in quick succession
last_detection_time_per_class = {}
DETECTION_COOLDOWN_SECONDS = 5 # Only save a report for a class if 5s has passed

while True:
    ret, frame = cap.read()
    if not ret:
        print("Error: Can't receive frame. Exiting ...")
        time.sleep(1)
        break

    original_frame_height, original_frame_width = frame.shape[:2]
    current_time = datetime.now()

    # 1. Perform inference
    results = model(frame, verbose=False, conf=CONFIDENCE_THRESHOLD)

    if results and len(results) > 0:
        result = results[0]
        detected_this_frame_classes = set() # Keep track of classes detected in this frame

        for box in result.boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            confidence = float(box.conf[0])
            class_id = int(box.cls[0])

            defect_type = "Unknown"
            if 0 <= class_id < len(class_labels):
                defect_type = class_labels[class_id]
            else:
                defect_type = f"ClassID_{class_id}"

            detected_this_frame_classes.add(defect_type)
            display_text = f"{defect_type}: {confidence:.2f}"

            # Check cooldown for this specific class
            can_log_this_defect = True
            if defect_type in last_detection_time_per_class:
                if (current_time - last_detection_time_per_class[defect_type]).total_seconds() < DETECTION_COOLDOWN_SECONDS:
                    can_log_this_defect = False
            
            # Only log if above threshold and cooldown period has passed for this defect type
            if confidence >= CONFIDENCE_THRESHOLD and can_log_this_defect:
                last_detection_time_per_class[defect_type] = current_time # Update last detection time

                # --- Save Image and Create Report ---
                timestamp_str_file = current_time.strftime("%Y%m%d_%H%M%S_%f") # Microseconds for uniqueness
                timestamp_str_report = current_time.isoformat() # Standard ISO format for report

                image_filename = f"defect_{defect_type.replace(' ', '_')}_{timestamp_str_file}.jpg"
                image_save_path = os.path.join(detections_image_dir, image_filename)
                
                # Save the image (the full frame where detection occurred)
                cv2.imwrite(image_save_path, frame)
                print(f"[REPORT] Saved defect image to: {image_save_path}")

                report_entry = {
                    "operator_name": OPERATOR_NAME,
                    "operator_id": OPERATOR_ID,
                    "operator_qualification": OPERATOR_QUALIFICATION,
                    "defect_type": defect_type,
                    "detection_timestamp": timestamp_str_report,
                    "image_path": os.path.join(IMAGES_SUBDIR, image_filename) # Relative path for portability
                }

                # Append to JSON report
                report_data = []
                if os.path.exists(json_report_path):
                    try:
                        with open(json_report_path, 'r') as f_json:
                            report_data = json.load(f_json)
                            if not isinstance(report_data, list): # Ensure it's a list
                                report_data = []
                    except json.JSONDecodeError:
                        print(f"[WARNING] Could not decode existing JSON from {json_report_path}. Starting fresh.")
                        report_data = []
                
                report_data.append(report_entry)

                try:
                    with open(json_report_path, 'w') as f_json:
                        json.dump(report_data, f_json, indent=4)
                    print(f"[REPORT] Appended detection to {json_report_path}")
                except IOError as e:
                    print(f"[ERROR] Could not write to JSON report file: {e}")
                # --- End Save Image and Create Report ---


            # Draw bounding box and label on the display frame
            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
            text_size, _ = cv2.getTextSize(display_text, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
            rect_height = text_size[1] + 10
            cv2.rectangle(frame, (x1, y1 - rect_height), (x1 + text_size[0] + 5, y1 - 5), (0, 255, 0), -1)
            cv2.putText(frame, display_text, (x1 + 5, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX,
                        0.5, (0, 0, 0), 1, cv2.LINE_AA)

    # Calculate and display FPS
    frame_count_fps += 1
    elapsed_time_fps = time.time() - start_time_fps
    if elapsed_time_fps >= 1.0:
        fps = frame_count_fps / elapsed_time_fps
        cv2.putText(frame, f"FPS: {fps:.2f}", (original_frame_width - 150, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
        frame_count_fps = 0
        start_time_fps = time.time()

    # Display the resulting frame
    cv2.imshow('ESP32 Stream with YOLOv8 Detection & Reporting', frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

# --- Cleanup ---
print("[INFO] Cleaning up...")
cap.release()
cv2.destroyAllWindows()
print("[INFO] Exiting.")
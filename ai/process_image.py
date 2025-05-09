
from ultralytics import YOLO
import cv2
import sys
import os
import yaml
import base64

def process_image(input_path, output_path):
    try:
        # Print current working directory for debugging
        print(f"Current working directory: {os.getcwd()}", flush=True)
        
        # Get the absolute path to the model and data files
        script_dir = os.path.dirname(os.path.abspath(__file__))
        model_path = os.path.join(script_dir, "best.pt")
        data_yaml_path = os.path.join(script_dir, "data.yaml")
        
        print(f"Looking for model at: {model_path}", flush=True)
        print(f"Looking for data.yaml at: {data_yaml_path}", flush=True)
        
        # Check if model exists
        if not os.path.exists(model_path):
            print(f"Model not found at: {model_path}", file=sys.stderr, flush=True)
            raise Exception(f"Model file not found at {model_path}")
        
        # Load class labels from data.yaml
        class_labels = []
        if os.path.exists(data_yaml_path):
            try:
                with open(data_yaml_path, 'r') as f:
                    data_config = yaml.safe_load(f)
                    if 'names' in data_config:
                        class_labels = data_config['names']
                        print(f"Loaded {len(class_labels)} class labels: {class_labels}", flush=True)
                    else:
                        print(f"Warning: 'names' key not found in {data_yaml_path}", flush=True)
            except Exception as e:
                print(f"Error loading class labels: {str(e)}", file=sys.stderr, flush=True)
        
        # Verify input file exists
        print(f"Checking input image at: {input_path}", flush=True)
        if not os.path.exists(input_path):
            raise Exception(f"Input image does not exist: {input_path}")
        
        # Load the YOLO model with absolute path
        print(f"Loading YOLO model from: {model_path}", flush=True)
        model = YOLO(model_path)
        
        # Load the image
        print(f"Loading image from: {input_path}", flush=True)
        img = cv2.imread(input_path)
        if img is None:
            raise Exception(f"Could not load image from: {input_path}")
        
        # Set confidence threshold to match app.py
        confidence_threshold = 0.5
        
        # Perform detection with confidence threshold
        print(f"Running object detection with confidence threshold {confidence_threshold}...", flush=True)
        results = model(img, conf=confidence_threshold)
        
        # Get the first result
        result = results[0]
        
        # Get the annotated image
        print("Generating annotated image...", flush=True)
        annotated_img = result.plot()
        
        # Save the annotated image
        print(f"Saving result to: {output_path}", flush=True)
        cv2.imwrite(output_path, annotated_img)
        
        # Verify the output file was created
        if not os.path.exists(output_path):
            raise Exception(f"Failed to write output file to {output_path}")
        
        print("Image processing completed successfully", flush=True)
        return True
    except Exception as e:
        print(f"Error in process_image: {str(e)}", file=sys.stderr, flush=True)
        return False

if __name__ == "__main__":
    # This script accepts input and output paths as command-line arguments
    if len(sys.argv) != 3:
        print("Usage: python process_image.py <input_image_path> <output_image_path>", file=sys.stderr)
        sys.exit(1)
    
    input_path = sys.argv[1]
    output_path = sys.argv[2]
    
    print(f"Processing image: {input_path} -> {output_path}", flush=True)
    
    success = process_image(input_path, output_path)
    sys.exit(0 if success else 1)
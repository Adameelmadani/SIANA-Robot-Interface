
import sys
import json
import os
import cv2
import numpy as np
from ultralytics import YOLO
import yaml
import base64
from io import BytesIO
from PIL import Image
import traceback

# Configuration
MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "best.pt")
DATA_YAML_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.yaml")
CONFIDENCE_THRESHOLD = 0.5
DEFECTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../defects")

# Create defects directory if it doesn't exist
os.makedirs(DEFECTS_DIR, exist_ok=True)

# Load class labels from
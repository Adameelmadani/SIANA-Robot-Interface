# SIANA Robot Interface

![JavaScript](https://img.shields.io/badge/JavaScript-yellow)
![NodeJS](https://img.shields.io/badge/Node.js-green)
![Python](https://img.shields.io/badge/Python-blue)
![WebSocket](https://img.shields.io/badge/WebSocket-0080ff)
![Raspberry%20Pi](https://img.shields.io/badge/Raspberry%20Pi-c51a4a)
![ESP32--CAM](https://img.shields.io/badge/ESP32--CAM-black)

**SIANA Robot Interface** is the web interface and control stack for the SIANA inspection robot. It provides live robot teleoperation, servo control, ESP32-CAM streaming, and AI-powered defect detection using a YOLO model. The stack connects a browser UI to a Raspberry Pi controller via WebSockets, with a Node.js backend coordinating real-time commands and image processing.

> Built by **Adam El Madani**

---

## Features

- **Live robot teleoperation** — Forward/backward/left/right controls over WebSockets
- **Servo control panel** — Multi-servo arm control with buttons and a slider
- **ESP32-CAM streaming** — Live frames sent to the UI with stream status feedback
- **AI detection pipeline** — YOLO-based detection on images and real-time frames
- **Autonomous mode toggle** — Trigger autonomous mode from the UI
- **Image upload analysis** — Upload a photo and receive annotated results

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express, WebSocket (ws) |
| Frontend | HTML5, CSS3, Vanilla JavaScript |
| AI | Python, Ultralytics YOLO, OpenCV |
| Hardware | Raspberry Pi, ESP32-CAM |

---

## Prerequisites

- **Node.js 14+** and **npm**
- **Python 3.8+** with `ultralytics`, `opencv-python`, `pyyaml`
- **Raspberry Pi** with GPIO access and `adafruit-circuitpython-servokit`
- **ESP32-CAM** flashed with the Arduino sketch in `esp32-cam/`

---

## Local Setup

### 1. Clone the Repository

```bash
git clone https://github.com/Adameelmadani/SIANA-Robot-Interface.git
cd SIANA-Robot-Interface
```

### 2. Install Backend Dependencies

```bash
cd backend
npm install
```

### 3. Run the Backend Server

```bash
npm start
```

The server starts at **http://localhost:3000**.

### 4. Open the Interface

Open `http://localhost:3000` in your browser to access the interface.

---

## Raspberry Pi Setup

1. Install required packages:

```bash
pip install websocket-client RPi.GPIO adafruit-circuitpython-servokit
```

2. Update the WebSocket URL in `raspberrypi/raspberrypi.py` if needed:

```python
SERVER_URL = "ws://<server-ip>:3000/robot"
```

3. Run the controller on the Pi:

```bash
python3 raspberrypi/raspberrypi.py
```

---

## AI Model Setup

The YOLO model and data configuration are stored in `ai/`:

- `ai/best.pt`
- `ai/data.yaml`

The backend calls `ai/process_image.py` to generate annotated results.

---

## Project Structure

```
SIANA-Robot-Interface/
├── ai/
│   ├── best.pt
│   ├── data.yaml
│   └── process_image.py
├── backend/
│   ├── esp32-cam.js
│   ├── package.json
│   └── server.js
├── esp32-cam/
│   └── esp32-cam.ino
├── frontend/
│   ├── interface.html
│   ├── scripts/
│   └── styles/
└── raspberrypi/
    └── raspberrypi.py
```

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/process-image` | Upload an image and receive an annotated result |

### WebSocket Events (`/robot`)

| Direction | Type | Payload | Description |
|---|---|---|---|
| Client → Server | `identity` | `{ device: "raspberry_pi" }` | Identify the Pi connection |
| Client → Server | `control` | `{ direction, isActive, speed }` | Base locomotion commands |
| Client → Server | `servo` | `{ motor_id, value, is_active }` | Arm servo control |
| Client → Server | `automatic` | `{ enabled }` | Toggle autonomous mode |
| Client → Server | `stream_request` | `{}` | Request ESP32-CAM stream |
| Client → Server | `cancel_stream` | `{}` | Stop stream delivery |
| Client → Server | `detection_mode` | `{ enabled }` | Toggle real-time detection |
| Server → Client | `status` | `{ connected }` | Raspberry Pi connection state |
| Server → Client | `stream_status` | `{ connected }` | Camera stream connection state |
| Server → Client | `camera_frame` | `{ data }` | Base64 camera frame |
| Server → Client | `detection_frame` | `{ data }` | Base64 detection frame |
| Server → Client | `automatic_status` | `{ enabled }` | Autonomous mode status |

---

## License

No license has been specified yet. If you want, add a `LICENSE` file to define reuse terms.

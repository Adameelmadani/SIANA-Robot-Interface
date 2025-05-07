# ESP32-CAM Stream Server

This is a server that connects to an ESP32-CAM video stream once and rebroadcasts it to multiple clients. This approach reduces the load on the ESP32-CAM by having it handle only one connection (to the server) instead of multiple client connections.

## Features

- Single connection to ESP32-CAM
- Multi-client broadcasting
- Automatic reconnection if the stream fails
- Real-time status updates

## Setup Instructions

1. Make sure your computer is connected to the ESP32-CAM WiFi network (the ESP32 should be in AP mode)
2. Install dependencies:

import websocket
import json
import time
import logging

# Set up logging
logging.basicConfig(level=logging.INFO, 
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# WebSocket server URL (replace with your actual server address)
SERVER_URL = "ws://YOUR_SERVER_IP:3000/pi"

# Robot movement functions
def move_robot(direction, is_active):
    """
    Process robot movement commands
    """
    state = "pressed" if is_active else "released"
    print(f"ROBOT COMMAND: {direction} {state}")
    # Here you would implement actual robot control code

# WebSocket event handlers
def on_message(ws, message):
    try:
        data = json.loads(message)
        if data.get('type') == 'control':
            direction = data.get('direction', '')
            is_active = data.get('isActive', False)
            move_robot(direction, is_active)
    except Exception as e:
        logger.error(f"Error processing message: {e}")

def on_error(ws, error):
    logger.error(f"WebSocket error: {error}")

def on_close(ws, close_status_code, close_msg):
    logger.warning("WebSocket connection closed")
    # Attempt to reconnect
    time.sleep(5)
    connect_websocket()

def on_open(ws):
    logger.info("Connection established to server")
    # Send initial message to identify as Raspberry Pi
    ws.send(json.dumps({
        "type": "identity",
        "device": "raspberry_pi"
    }))

def connect_websocket():
    logger.info(f"Connecting to {SERVER_URL}...")
    ws = websocket.WebSocketApp(SERVER_URL,
                                on_open=on_open,
                                on_message=on_message,
                                on_error=on_error,
                                on_close=on_close)
    ws.run_forever()

if __name__ == "__main__":
    logger.info("Starting Raspberry Pi robot controller")
    connect_websocket()
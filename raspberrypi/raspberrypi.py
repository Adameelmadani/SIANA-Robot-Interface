import websocket
import json
import time
import logging
import RPi.GPIO as GPIO

# Set up logging
logging.basicConfig(level=logging.INFO, 
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# WebSocket server URL (replace with your actual server address)
SERVER_URL = "ws://192.168.12.1:3000/robot"

# Set up motor PINS
PIN_RIGHT_MOTORS_LPWM = 20
PIN_RIGHT_MOTORS_RPWM = 21
PIN_LEFT_MOTORS_LPWM = 23
PIN_LEFT_MOTORS_RPWM = 24

# PWM Parameters
PWM_FREQUENCY = 100  # Hz
DEFAULT_SPEED = 20   # Duty cycle percentage (0-100) for movement

# --- Global PWM Objects ---
# These will be initialized in setup_gpio()
pwm_right_lpwm = None
pwm_right_rpwm = None
pwm_left_lpwm = None
pwm_left_rpwm = None

# --- GPIO Setup and Cleanup ---
def setup_gpio():
    global pwm_right_lpwm, pwm_right_rpwm, pwm_left_lpwm, pwm_left_rpwm

    GPIO.setmode(GPIO.BCM)  # Use Broadcom SOC pin numbering
    GPIO.setwarnings(False) # Disable warnings

    # Setup motor pins as outputs
    pins = [PIN_RIGHT_MOTORS_LPWM, PIN_RIGHT_MOTORS_RPWM,
            PIN_LEFT_MOTORS_LPWM, PIN_LEFT_MOTORS_RPWM]
    for pin in pins:
        GPIO.setup(pin, GPIO.OUT)
        GPIO.output(pin, GPIO.LOW) # Initialize to LOW

    # Initialize PWM objects
    pwm_right_lpwm = GPIO.PWM(PIN_RIGHT_MOTORS_LPWM, PWM_FREQUENCY)
    pwm_right_rpwm = GPIO.PWM(PIN_RIGHT_MOTORS_RPWM, PWM_FREQUENCY)
    pwm_left_lpwm = GPIO.PWM(PIN_LEFT_MOTORS_LPWM, PWM_FREQUENCY)
    pwm_left_rpwm = GPIO.PWM(PIN_LEFT_MOTORS_RPWM, PWM_FREQUENCY)

    # Start PWM with 0% duty cycle (motors off)
    pwm_right_lpwm.start(0)
    pwm_right_rpwm.start(0)
    pwm_left_lpwm.start(0)
    pwm_left_rpwm.start(0)
    logger.info("GPIO and PWM initialized for motor control.")

def set_motor_speed(pwm_pin_forward, pwm_pin_backward, direction, speed):
    # ... (implementation as previously discussed) ...
    if direction == 1:      # Forward
        pwm_pin_forward.ChangeDutyCycle(speed)
        pwm_pin_backward.ChangeDutyCycle(0)
    elif direction == -1:   # Backward
        pwm_pin_forward.ChangeDutyCycle(0)
        pwm_pin_backward.ChangeDutyCycle(speed)
    else:                   # Stop
        pwm_pin_forward.ChangeDutyCycle(0)
        pwm_pin_backward.ChangeDutyCycle(0)

def all_motors_stop():
    # ... (implementation as previously discussed, calls set_motor_speed for both motor pairs with direction 0) ...
    logger.info("ROBOT COMMAND: All motors stop")
    if pwm_right_rpwm and pwm_right_lpwm and pwm_left_rpwm and pwm_left_lpwm:
        set_motor_speed(pwm_right_rpwm, pwm_right_lpwm, 0, 0)
        set_motor_speed(pwm_left_rpwm, pwm_left_lpwm, 0, 0)
    else:
        logger.warning("PWM objects not initialized, cannot stop motors via PWM.")

# cleanup gpio
def cleanup_gpio():
    logger.info("Stopping PWM and cleaning up GPIO.")
    # Check if PWM objects were initialized before trying to stop them
    if pwm_right_lpwm: pwm_right_lpwm.stop()
    if pwm_right_rpwm: pwm_right_rpwm.stop()
    if pwm_left_lpwm: pwm_left_lpwm.stop()
    if pwm_left_rpwm: pwm_left_rpwm.stop()
    GPIO.cleanup()
    logger.info("GPIO cleanup complete.")

# Robot movement functions
def move_robot(direction, is_active, speed=DEFAULT_SPEED):
    """
    Process robot movement commands.
    `direction`: "forward", "backward", "left", "right", "stop"
    `is_active`: True if the command should start movement, False to stop previous movement.
    `speed`: The desired speed (duty cycle 0-100). Defaults to DEFAULT_SPEED.
    """
    logger.info(f"ROBOT COMMAND: Direction: {direction}, Active: {is_active}, Speed: {speed}")

    # Ensure PWM objects are initialized before proceeding
    # These checks assume the global PWM variables are directly accessible.
    if not all([pwm_right_lpwm, pwm_right_rpwm, pwm_left_lpwm, pwm_left_rpwm]):
        logger.error("PWM objects not initialized. Cannot execute move_robot command.")
        return
    
    if not is_active: # If the command is to deactivate a movement, or any key release
        all_motors_stop()
        return

    # is_active is True, so execute the movement with the given speed
    if direction == "forward":
        set_motor_speed(pwm_right_rpwm, pwm_right_lpwm, 1, speed)
        set_motor_speed(pwm_left_rpwm, pwm_left_lpwm, 1, speed)
    elif direction == "backward":
        set_motor_speed(pwm_right_rpwm, pwm_right_lpwm, -1, speed)
        set_motor_speed(pwm_left_rpwm, pwm_left_lpwm, -1, speed)
    elif direction == "right": # Turn right: Left motors forward, Right motors backward (pivot turn)
        set_motor_speed(pwm_left_rpwm, pwm_left_lpwm, 1, speed)
        set_motor_speed(pwm_right_rpwm, pwm_right_lpwm, -1, speed)
    elif direction == "left":  # Turn left: Right motors forward, Left motors backward (pivot turn)
        set_motor_speed(pwm_right_rpwm, pwm_right_lpwm, 1, speed)
        set_motor_speed(pwm_left_rpwm, pwm_left_lpwm, -1, speed)
    elif direction == "stop": # Explicit stop command from server
        all_motors_stop()
    else:
        logger.warning(f"Unknown direction: {direction}. Stopping motors.")
        all_motors_stop()


# WebSocket event handlers
def on_message(ws, message):
    try:
        data = json.loads(message)
        if data.get('type') == 'control':
            direction = data.get('direction', '')
            is_active = data.get('isActive', False)
            speed = data.get('speed',DEFAULT_SPEED)
            move_robot(direction, is_active, speed)
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

# --- Main Execution ---
if __name__ == "__main__":
    try:
        logger.info("Starting gpio setup")
        setup_gpio()
        logger.info("Starting Raspberry Pi robot controller")
        connect_websocket()
    except KeyboardInterrupt:
        logger.info("Program interrupted by user (Ctrl+C).")
    except Exception as e:
        logger.error(f"An unexpected error occurred in the main execution: {e}")
    finally:
        logger.info("Initiating shutdown sequence...")
        all_motors_stop() # Ensure motors are stopped before cleaning up GPIO
        cleanup_gpio()    # Clean up GPIO resources
        logger.info("Program terminated.")

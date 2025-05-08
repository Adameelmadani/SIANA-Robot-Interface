import websocket
import json
import time
import logging
import RPi.GPIO as GPIO
from adafruit_servokit import ServoKit # Added for arm servos

# Set up logging
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# WebSocket server URL (replace with your actual server address)
SERVER_URL = "ws://192.168.12.1:3000/robot" # Replace if different

# --- DC Motor (Base Locomotion) Configuration ---
PIN_RIGHT_MOTORS_LPWM = 20
PIN_RIGHT_MOTORS_RPWM = 21
PIN_LEFT_MOTORS_LPWM = 24
PIN_LEFT_MOTORS_RPWM = 23
DC_PWM_FREQUENCY = 8000  # Hz for DC motors via RPi.GPIO
DEFAULT_DC_SPEED = 100   # Duty cycle percentage (0-100) for DC motors

# --- Robotic Arm Servo (PCA9685 & ServoKit) Configuration ---
# Channels on PCA9685 for the first three arm servos
SERVO_ARM_CHANNELS = [0, 1, 2] # S4 (Base), S3 (Shoulder), S2 (Elbow)
CALIBRATED_STOP_THROTTLES = {
    0: 0.0670,  # Stop throttle for servo on PCA channel 0
    1: 0.0670,  # Stop throttle for servo on PCA channel 1
    2: 0.0670   # Stop throttle for servo on PCA channel 2
    # Add more if S1 (channel 3) is also continuous and needs calibration
}
SERVO_MOVEMENT_THROTTLE_VALUE = 0.23 # Throttle for "left" or "right" movement
SERVO_PCA_ADDRESS = 0x40 # Default I2C address for PCA9685
SERVO_PWM_FREQUENCY = 50 # Common for servos, ServoKit default is often 50Hz

# --- Global PWM Objects (DC Motors) ---
pwm_right_lpwm = None
pwm_right_rpwm = None
pwm_left_lpwm = None
pwm_left_rpwm = None

# --- Global ServoKit Object (Arm Servos) ---
kit = None

# --- GPIO Setup (DC Motors) ---
def setup_dc_motors_gpio():
    global pwm_right_lpwm, pwm_right_rpwm, pwm_left_lpwm, pwm_left_rpwm
    logger.info("Setting up GPIO for DC Motors...")
    GPIO.setmode(GPIO.BCM)
    GPIO.setwarnings(False)
    pins = [PIN_RIGHT_MOTORS_LPWM, PIN_RIGHT_MOTORS_RPWM,
            PIN_LEFT_MOTORS_LPWM, PIN_LEFT_MOTORS_RPWM]
    for pin in pins:
        GPIO.setup(pin, GPIO.OUT)
        GPIO.output(pin, GPIO.LOW)

    try:
        pwm_right_lpwm = GPIO.PWM(PIN_RIGHT_MOTORS_LPWM, DC_PWM_FREQUENCY)
        pwm_right_rpwm = GPIO.PWM(PIN_RIGHT_MOTORS_RPWM, DC_PWM_FREQUENCY)
        pwm_left_lpwm = GPIO.PWM(PIN_LEFT_MOTORS_LPWM, DC_PWM_FREQUENCY)
        pwm_left_rpwm = GPIO.PWM(PIN_LEFT_MOTORS_RPWM, DC_PWM_FREQUENCY)
    except Exception as e:
        logger.error(f"Error initializing RPi.GPIO PWM for DC motors: {e}")
        raise # Critical failure

    pwm_right_lpwm.start(0)
    pwm_right_rpwm.start(0)
    pwm_left_lpwm.start(0)
    pwm_left_rpwm.start(0)
    logger.info("DC Motor GPIO and RPi.GPIO PWM initialized.")

# --- ServoKit Setup (Arm Servos) ---
def setup_arm_servos():
    global kit
    logger.info("Setting up ServoKit for Arm Servos...")
    try:
        kit = ServoKit(channels=16, address=SERVO_PCA_ADDRESS, frequency=SERVO_PWM_FREQUENCY)
        logger.info(f"ServoKit initialized (PCA9685 on I2C addr 0x{SERVO_PCA_ADDRESS:02X}, Freq: {SERVO_PWM_FREQUENCY}Hz).")
        # Set initial state for defined continuous arm servos
        for motor_id in SERVO_ARM_CHANNELS:
            if motor_id in CALIBRATED_STOP_THROTTLES:
                stop_throttle = CALIBRATED_STOP_THROTTLES[motor_id]
                kit.continuous_servo[motor_id].throttle = stop_throttle
                logger.info(f"  Arm servo on channel {motor_id} initialized to stop throttle: {stop_throttle:.4f}")
            else:
                logger.warning(f"  No calibrated stop throttle for arm servo {motor_id}. Leaving at ServoKit default.")
    except ValueError as e: # Often happens if PCA9685 not found
        logger.error(f"Error initializing ServoKit (PCA9685): {e}. Is I2C enabled and PCA9685 connected correctly at address 0x{SERVO_PCA_ADDRESS:02X}?")
        kit = None # Ensure kit is None if setup failed
    except Exception as e:
        logger.error(f"Unexpected error initializing ServoKit: {e}")
        kit = None

# --- DC Motor Control Functions ---
def set_dc_motor_speed(pwm_pin_forward, pwm_pin_backward, direction, speed):
    if direction == 1:
        pwm_pin_forward.ChangeDutyCycle(speed)
        pwm_pin_backward.ChangeDutyCycle(0)
    elif direction == -1:
        pwm_pin_forward.ChangeDutyCycle(0)
        pwm_pin_backward.ChangeDutyCycle(speed)
    else:
        pwm_pin_forward.ChangeDutyCycle(0)
        pwm_pin_backward.ChangeDutyCycle(0)

def all_dc_motors_stop():
    logger.info("DC_MOTORS COMMAND: All motors stop")
    if pwm_right_rpwm and pwm_right_lpwm and pwm_left_rpwm and pwm_left_lpwm:
        set_dc_motor_speed(pwm_right_rpwm, pwm_right_lpwm, 0, 0)
        set_dc_motor_speed(pwm_left_rpwm, pwm_left_lpwm, 0, 0) # Corrected pin usage for left DC
    else:
        logger.warning("DC_MOTORS: RPi.GPIO PWM objects not initialized, cannot stop DC motors.")

def cleanup_dc_motors_gpio():
    logger.info("Stopping RPi.GPIO PWM and cleaning up GPIO for DC Motors.")
    if pwm_right_lpwm: pwm_right_lpwm.stop()
    if pwm_right_rpwm: pwm_right_rpwm.stop()
    if pwm_left_lpwm: pwm_left_lpwm.stop()
    if pwm_left_rpwm: pwm_left_rpwm.stop()
    GPIO.cleanup()
    logger.info("DC Motor GPIO cleanup complete.")

# --- Arm Servo Control Functions ---
def control_servo_motor(motor_id, value_direction_str, is_active):
    global kit
    if kit is None:
        logger.error("ARM_SERVO CMD: ServoKit not initialized. Cannot control servo.")
        return

    if motor_id not in SERVO_ARM_CHANNELS:
        logger.warning(f"ARM_SERVO CMD: Invalid motor_id {motor_id} received. Expected one of {SERVO_ARM_CHANNELS}.")
        return

    stop_throttle = CALIBRATED_STOP_THROTTLES.get(motor_id)
    if stop_throttle is None: # Should not happen if SERVO_ARM_CHANNELS and CALIBRATED_STOP_THROTTLES are aligned
        logger.error(f"ARM_SERVO CMD: No calibrated stop throttle for motor_id {motor_id}. Using 0.0.")
        stop_throttle = 0.0

    target_throttle = stop_throttle # Default to stop

    if is_active:
        if value_direction_str == "right":
            target_throttle = SERVO_MOVEMENT_THROTTLE_VALUE
            logger.info(f"ARM_SERVO CMD: Motor {motor_id} RUN RIGHT (Throttle: {target_throttle:.4f})")
        elif value_direction_str == "left":
            target_throttle = -SERVO_MOVEMENT_THROTTLE_VALUE
            logger.info(f"ARM_SERVO CMD: Motor {motor_id} RUN LEFT (Throttle: {target_throttle:.4f})")
        else:
            logger.warning(f"ARM_SERVO CMD: Invalid value_direction '{value_direction_str}' for motor {motor_id}. Stopping.")
            # target_throttle remains stop_throttle
    else: # is_active is False
        logger.info(f"ARM_SERVO CMD: Motor {motor_id} STOP (Throttle: {target_throttle:.4f})")
        # target_throttle is already stop_throttle

    try:
        kit.continuous_servo[motor_id].throttle = target_throttle
    except IndexError: # Should be caught by motor_id in SERVO_ARM_CHANNELS check, but good practice
        logger.error(f"ARM_SERVO CMD: Motor id {motor_id} is out of range for ServoKit channels.")
    except Exception as e:
        logger.error(f"ARM_SERVO CMD: Error setting throttle for motor {motor_id}: {e}")

def all_arm_servos_stop():
    global kit
    if kit is not None:
        logger.info("ARM_SERVO COMMAND: Stopping all defined arm servos.")
        for motor_id in SERVO_ARM_CHANNELS:
            stop_throttle = CALIBRATED_STOP_THROTTLES.get(motor_id)
            if stop_throttle is not None:
                try:
                    kit.continuous_servo[motor_id].throttle = stop_throttle
                    logger.debug(f"  Arm servo {motor_id} throttle set to {stop_throttle:.4f}")
                except Exception as e:
                    logger.error(f"  Error stopping arm servo {motor_id}: {e}")
    else:
        logger.info("ARM_SERVO COMMAND: ServoKit not initialized, cannot stop arm servos.")


# --- DC Motor Movement Function (Base Locomotion) ---
def move_robot_base(direction, is_active, speed=DEFAULT_DC_SPEED):
    logger.info(f"DC_MOTORS CMD: Direction: {direction}, Active: {is_active}, Speed: {speed}")
    if not all([pwm_right_lpwm, pwm_right_rpwm, pwm_left_lpwm, pwm_left_rpwm]):
        logger.error("DC_MOTORS: RPi.GPIO PWM objects not initialized. Cannot execute move_robot_base command.")
        return

    if not is_active:
        all_dc_motors_stop()
        return

    # Using corrected pin usage for left DC motor as per your previous script
    # (PIN_LEFT_MOTORS_RPWM=23 is fwd, PIN_LEFT_MOTORS_LPWM=24 is bwd)
    if direction == "forward":
        set_dc_motor_speed(pwm_right_rpwm, pwm_right_lpwm, 1, speed)
        set_dc_motor_speed(pwm_left_rpwm, pwm_left_lpwm, 1, speed)
    elif direction == "backward":
        set_dc_motor_speed(pwm_right_rpwm, pwm_right_lpwm, -1, speed)
        set_dc_motor_speed(pwm_left_rpwm, pwm_left_lpwm, -1, speed)
    elif direction == "right":
        set_dc_motor_speed(pwm_left_rpwm, pwm_left_lpwm, 1, speed)
        set_dc_motor_speed(pwm_right_rpwm, pwm_right_lpwm, -1, speed)
    elif direction == "left":
        set_dc_motor_speed(pwm_right_rpwm, pwm_right_lpwm, 1, speed)
        set_dc_motor_speed(pwm_left_rpwm, pwm_left_lpwm, -1, speed)
    elif direction == "stop":
        all_dc_motors_stop()
    else:
        logger.warning(f"DC_MOTORS: Unknown direction: {direction}. Stopping DC motors.")
        all_dc_motors_stop()


# --- WebSocket Event Handlers ---
def on_message(ws, message):
    try:
        data = json.loads(message)
        message_type = data.get('type', '').lower()
        logger.debug(f"Received message: {data}")

        if message_type == 'control': # For DC motor base (locomotion)
            direction = data.get('direction', '')
            is_active = data.get('isActive', False)
            # Assuming speed from message is 0-100 for DC motor duty cycle
            dc_speed = data.get('speed', DEFAULT_DC_SPEED)
            try: # Ensure speed is a valid integer for DC motors
                dc_speed = int(dc_speed)
                if not (0 <= dc_speed <= 100):
                    logger.warning(f"DC motor speed {dc_speed} out of range (0-100). Clamping.")
                    dc_speed = max(0, min(100, dc_speed))
            except (ValueError, TypeError):
                logger.warning(f"Invalid DC motor speed value '{data.get('speed')}'. Using default {DEFAULT_DC_SPEED}.")
                dc_speed = DEFAULT_DC_SPEED
            move_robot_base(direction, is_active, dc_speed)

        elif message_type == 'servo': # For arm servo control
            motor_id_val = data.get('motor_id')
            value_direction_str = data.get('value', '').lower() # "left" or "right"
            is_active_servo = data.get('is_active', False)

            # Validate motor_id
            motor_id = -1 # Default to invalid
            if isinstance(motor_id_val, int) and motor_id_val in SERVO_ARM_CHANNELS:
                motor_id = motor_id_val
            else:
                try: # Try converting if it's a string like "0", "1", "2"
                    motor_id_int = int(motor_id_val)
                    if motor_id_int in SERVO_ARM_CHANNELS:
                        motor_id = motor_id_int
                except (ValueError, TypeError):
                    pass # Keep motor_id as -1 (invalid)
            
            if motor_id == -1: # Check if validation failed
                logger.warning(f"ARM_SERVO CMD: Invalid or missing motor_id: '{motor_id_val}'. Expected one of {SERVO_ARM_CHANNELS}.")
                return

            # Validate value_direction
            if value_direction_str not in ["left", "right"]:
                logger.warning(f"ARM_SERVO CMD: Invalid value_direction '{value_direction_str}' for motor {motor_id}. Must be 'left' or 'right'.")
                # Stop the servo if it was supposed to be active with an invalid direction
                if is_active_servo:
                    control_servo_motor(motor_id, "", False) # Force stop
                return

            control_servo_motor(motor_id, value_direction_str, is_active_servo)
        else:
            logger.warning(f"Received unknown message type: '{message_type}'")

    except json.JSONDecodeError:
        logger.error(f"Error decoding JSON: {message}")
    except Exception as e:
        logger.error(f"Error processing message: {e} (Message: {message})")
        import traceback
        logger.error(traceback.format_exc())


def on_error(ws, error):
    logger.error(f"WebSocket error: {error}")

def on_close(ws, close_status_code, close_msg):
    logger.warning(f"WebSocket connection closed. Code: {close_status_code}, Msg: {close_msg}")
    logger.info("Attempting to reconnect in 5 seconds...")
    time.sleep(5)
    connect_websocket()

def on_open(ws):
    logger.info("Connection established to server")
    ws.send(json.dumps({"type": "identity", "device": "raspberry_pi"}))

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
        setup_dc_motors_gpio()
        setup_arm_servos() # Initialize ServoKit and arm servos
        logger.info("Starting Raspberry Pi robot controller (DC Base + Servo Arm)")
        connect_websocket()
    except KeyboardInterrupt:
        logger.info("Program interrupted by user (Ctrl+C).")
    except Exception as e:
        logger.error(f"An unexpected error occurred in main execution: {e}")
        import traceback
        logger.error(traceback.format_exc())
    finally:
        logger.info("Initiating shutdown sequence...")
        all_dc_motors_stop()    # Stop DC base motors
        all_arm_servos_stop()   # Stop arm servos
        cleanup_dc_motors_gpio()# Cleanup RPi.GPIO resources
        logger.info("Program terminated.")
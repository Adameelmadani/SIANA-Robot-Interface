import websocket
import json
import time
import logging
import RPi.GPIO as GPIO
from adafruit_servokit import ServoKit
# import sys # No longer needed if not using command-line args for mode

# Set up logging
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# WebSocket server URL
SERVER_URL = "ws://192.168.12.1:3000/robot" # Replace if different

# --- DC Motor (Base Locomotion) Configuration ---
PIN_RIGHT_MOTORS_LPWM = 20
PIN_RIGHT_MOTORS_RPWM = 21
PIN_LEFT_MOTORS_LPWM = 24
PIN_LEFT_MOTORS_RPWM = 23
DC_PWM_FREQUENCY = 8000
DEFAULT_DC_SPEED = 100

# --- Robotic Arm Servo (PCA9685 & ServoKit) Configuration ---
SERVO_ARM_CHANNELS = [0, 1, 2]
CALIBRATED_STOP_THROTTLES = {0: 0.0670, 1: 0.0670, 2: 0.0670}
SERVO_MOVEMENT_THROTTLE_VALUE = 0.3
SERVO_PCA_ADDRESS = 0x40
SERVO_PWM_FREQUENCY = 50

# --- Global PWM Objects (DC Motors) ---
pwm_right_lpwm, pwm_right_rpwm, pwm_left_lpwm, pwm_left_rpwm = None, None, None, None

# --- Global ServoKit Object (Arm Servos) ---
kit = None

# --- Setup Functions (setup_dc_motors_gpio, setup_arm_servos - keep as before) ---
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
        raise
    pwm_right_lpwm.start(0); pwm_right_rpwm.start(0); pwm_left_lpwm.start(0); pwm_left_rpwm.start(0)
    logger.info("DC Motor GPIO and RPi.GPIO PWM initialized.")

def setup_arm_servos():
    global kit
    logger.info("Setting up ServoKit for Arm Servos...")
    try:
        kit = ServoKit(channels=16, address=SERVO_PCA_ADDRESS, frequency=SERVO_PWM_FREQUENCY)
        logger.info(f"ServoKit initialized (PCA9685 on I2C addr 0x{SERVO_PCA_ADDRESS:02X}, Freq: {SERVO_PWM_FREQUENCY}Hz).")
        for motor_id in SERVO_ARM_CHANNELS:
            if motor_id in CALIBRATED_STOP_THROTTLES:
                stop_throttle = CALIBRATED_STOP_THROTTLES[motor_id]
                kit.continuous_servo[motor_id].throttle = stop_throttle
                logger.info(f"  Arm servo on channel {motor_id} initialized to stop throttle: {stop_throttle:.4f}")
            else:
                logger.warning(f"  No calibrated stop throttle for arm servo {motor_id}.")
    except ValueError as e:
        logger.error(f"Error initializing ServoKit (PCA9685): {e}.")
        kit = None
    except Exception as e:
        logger.error(f"Unexpected error initializing ServoKit: {e}")
        kit = None

# --- Control Functions (set_dc_motor_speed, all_dc_motors_stop, cleanup_dc_motors_gpio, ---
# --- control_servo_motor, all_arm_servos_stop, move_robot_base - keep as before) ---
def set_dc_motor_speed(pwm_pin_forward, pwm_pin_backward, direction, speed):
    if direction == 1: pwm_pin_forward.ChangeDutyCycle(speed); pwm_pin_backward.ChangeDutyCycle(0)
    elif direction == -1: pwm_pin_forward.ChangeDutyCycle(0); pwm_pin_backward.ChangeDutyCycle(speed)
    else: pwm_pin_forward.ChangeDutyCycle(0); pwm_pin_backward.ChangeDutyCycle(0)

def all_dc_motors_stop():
    logger.info("DC_MOTORS COMMAND: All motors stop")
    if all([pwm_right_rpwm, pwm_right_lpwm, pwm_left_rpwm, pwm_left_lpwm]):
        set_dc_motor_speed(pwm_right_rpwm, pwm_right_lpwm, 0, 0)
        set_dc_motor_speed(pwm_left_rpwm, pwm_left_lpwm, 0, 0)
    else: logger.warning("DC_MOTORS: RPi.GPIO PWM objects not initialized.")

def cleanup_dc_motors_gpio():
    logger.info("Stopping RPi.GPIO PWM and cleaning up GPIO for DC Motors.")
    if pwm_right_lpwm: pwm_right_lpwm.stop()
    if pwm_right_rpwm: pwm_right_rpwm.stop()
    if pwm_left_lpwm: pwm_left_lpwm.stop()
    if pwm_left_rpwm: pwm_left_rpwm.stop()
    GPIO.cleanup() # This cleans up ALL GPIO channels used by RPi.GPIO in this script
    logger.info("DC Motor GPIO cleanup complete.")

def control_servo_motor(motor_id, value_direction_str, is_active):
    global kit
    if kit is None: logger.error("ARM_SERVO CMD: ServoKit not initialized."); return
    if motor_id not in SERVO_ARM_CHANNELS: logger.warning(f"ARM_SERVO CMD: Invalid motor_id {motor_id}."); return
    stop_throttle = CALIBRATED_STOP_THROTTLES.get(motor_id, 0.0)
    target_throttle = stop_throttle
    if is_active:
        if value_direction_str == "right": target_throttle = SERVO_MOVEMENT_THROTTLE_VALUE
        elif value_direction_str == "left": target_throttle = -SERVO_MOVEMENT_THROTTLE_VALUE
        else: logger.warning(f"ARM_SERVO CMD: Invalid value_direction '{value_direction_str}'. Stopping motor {motor_id}.")
    verb = "RUN" if is_active and target_throttle != stop_throttle else "STOP"
    direction_text = ""
    if is_active and target_throttle != stop_throttle:
        direction_text = "RIGHT" if target_throttle > stop_throttle else "LEFT" if target_throttle < stop_throttle else " (at stop throttle)"

    logger.info(f"ARM_SERVO CMD: Motor {motor_id} {verb} {direction_text} (Throttle: {target_throttle:.4f})")
    try: kit.continuous_servo[motor_id].throttle = target_throttle
    except Exception as e: logger.error(f"ARM_SERVO CMD: Error for motor {motor_id}: {e}")

def all_arm_servos_stop():
    global kit
    if kit is not None:
        logger.info("ARM_SERVO COMMAND: Stopping all defined arm servos.")
        for motor_id in SERVO_ARM_CHANNELS:
            stop_throttle = CALIBRATED_STOP_THROTTLES.get(motor_id, 0.0)
            try: kit.continuous_servo[motor_id].throttle = stop_throttle
            except Exception as e: logger.error(f"  Error stopping arm servo {motor_id}: {e}")
    else: logger.info("ARM_SERVO COMMAND: ServoKit not initialized.")

def move_robot_base(direction, is_active, speed=DEFAULT_DC_SPEED):
    logger.info(f"DC_MOTORS CMD: Direction: {direction}, Active: {is_active}, Speed: {speed}")
    if not all([pwm_right_lpwm, pwm_right_rpwm, pwm_left_lpwm, pwm_left_rpwm]):
        logger.error("DC_MOTORS: RPi.GPIO PWM objects not initialized."); return
    if not is_active: all_dc_motors_stop(); return
    if direction == "forward": set_dc_motor_speed(pwm_right_rpwm, pwm_right_lpwm, 1, speed); set_dc_motor_speed(pwm_left_rpwm, pwm_left_lpwm, 1, speed)
    elif direction == "backward": set_dc_motor_speed(pwm_right_rpwm, pwm_right_lpwm, -1, speed); set_dc_motor_speed(pwm_left_rpwm, pwm_left_lpwm, -1, speed)
    elif direction == "right": set_dc_motor_speed(pwm_left_rpwm, pwm_left_lpwm, 1, speed); set_dc_motor_speed(pwm_right_rpwm, pwm_right_lpwm, -1, speed)
    elif direction == "left": set_dc_motor_speed(pwm_right_rpwm, pwm_right_lpwm, 1, speed); set_dc_motor_speed(pwm_left_rpwm, pwm_left_lpwm, -1, speed)
    elif direction == "stop": all_dc_motors_stop()
    else: logger.warning(f"DC_MOTORS: Unknown direction: {direction}."); all_dc_motors_stop()

def run_automatic_base_sequence():
    logger.info("AUTOMATIC MODE: Sequence started (this will block other WebSocket commands).")
    auto_speed = DEFAULT_DC_SPEED
    try:
        logger.info("AUTOMATIC MODE: Advancing for 6 seconds...")
        move_robot_base("forward", True, auto_speed); time.sleep(6)
        move_robot_base("forward", False, auto_speed); logger.info("AUTOMATIC MODE: Stopped after first advance.")
        logger.info("AUTOMATIC MODE: Pausing for 15 seconds..."); time.sleep(15)
        logger.info("AUTOMATIC MODE: Returning to start (moving backward for 12s)...")
        move_robot_base("backward", True, auto_speed); time.sleep(6)
        move_robot_base("backward", False, auto_speed); logger.info("AUTOMATIC MODE: Returned to start and stopped.")
    except KeyboardInterrupt: logger.info("AUTOMATIC MODE: Interrupted by user. Stopping motors."); all_dc_motors_stop(); raise
    except Exception as e: logger.error(f"AUTOMATIC MODE: Error during sequence: {e}"); all_dc_motors_stop()
    finally: logger.info("AUTOMATIC MODE: Sequence function finished or was interrupted.")

# --- WebSocket Event Handlers (Modified on_message) ---
def on_message(ws, message):
    try:
        data = json.loads(message)
        message_type = data.get('type', '').lower()
        logger.debug(f"Received message: {data}")

        if message_type == 'command': # Universal STOP command
            action = data.get('action', '').lower()
            if action == 'stop':
                logger.info("COMMAND RECEIVED: E-STOP - Stopping all systems.")
                all_dc_motors_stop()
                all_arm_servos_stop()
                # Note: If 'automatic' sequence is running, this stop command will only be processed
                # AFTER the automatic sequence completes, due to its blocking nature.
                return # Processed the stop command
            else:
                logger.warning(f"Received 'command' type with unknown action: '{action}'")

        elif message_type == 'control': # For DC motor base (locomotion)
            direction = data.get('direction', '')
            is_active = data.get('isActive', False)
            dc_speed_val = data.get('speed', DEFAULT_DC_SPEED)
            try:
                dc_speed = int(dc_speed_val)
                if not (0 <= dc_speed <= 100):
                    logger.warning(f"DC motor speed {dc_speed} (from {dc_speed_val}) out of range (0-100). Clamping.")
                    dc_speed = max(0, min(100, dc_speed))
            except (ValueError, TypeError):
                logger.warning(f"Invalid DC motor speed value '{dc_speed_val}'. Using default {DEFAULT_DC_SPEED}.")
                dc_speed = DEFAULT_DC_SPEED
            move_robot_base(direction, is_active, dc_speed)

        elif message_type == 'servo': # For arm servo control
            motor_id_val = data.get('motor_id')
            value_direction_str = data.get('value', '').lower() # "left" or "right"
            is_active_servo = data.get('is_active', False)
            motor_id = -1 # Default to invalid
            if isinstance(motor_id_val, int) and motor_id_val in SERVO_ARM_CHANNELS:
                motor_id = motor_id_val
            else:
                try:
                    motor_id_int = int(motor_id_val)
                    if motor_id_int in SERVO_ARM_CHANNELS:
                        motor_id = motor_id_int
                except (ValueError, TypeError): pass
            
            if motor_id == -1:
                logger.warning(f"ARM_SERVO CMD: Invalid or missing motor_id: '{motor_id_val}'. Expected one of {SERVO_ARM_CHANNELS}.")
                return
            
            if value_direction_str not in ["left", "right"]:
                logger.warning(f"ARM_SERVO CMD: Invalid value_direction '{value_direction_str}' for motor {motor_id}. Must be 'left' or 'right'.")
                if is_active_servo: # If it was an active command with bad direction, stop it.
                    control_servo_motor(motor_id, "", False) 
                return

            control_servo_motor(motor_id, value_direction_str, is_active_servo)
        
        elif message_type == 'automatic':
            logger.info("WebSocket command received to START automatic base sequence.")
            logger.warning(">>> Automatic sequence will BLOCK ALL OTHER WebSocket commands until finished. <<<")
            run_automatic_base_sequence() # Call the sequence directly (blocking)
            logger.info("Automatic base sequence completed. Resuming WebSocket listening.")
        
        else:
            logger.warning(f"Received unknown message type: '{message_type}'")

    except json.JSONDecodeError:
        logger.error(f"Error decoding JSON: {message}")
    except Exception as e:
        logger.error(f"Error processing message: {e} (Message: {message})")
        import traceback
        logger.error(traceback.format_exc())

# --- on_error, on_close, on_open, connect_websocket (keep as before) ---
def on_error(ws, error): logger.error(f"WebSocket error: {error}")
def on_close(ws, close_status_code, close_msg):
    logger.warning(f"WS closed. Code: {close_status_code}, Msg: {close_msg}. Reconnecting...")
    time.sleep(5); connect_websocket()
def on_open(ws):
    logger.info("Connection established to server")
    ws.send(json.dumps({"type": "identity", "device": "raspberry_pi"}))
def connect_websocket():
    logger.info(f"Connecting to {SERVER_URL}...")
    ws = websocket.WebSocketApp(SERVER_URL, on_open=on_open, on_message=on_message, on_error=on_error, on_close=on_close)
    ws.run_forever()

# --- Main Execution ---
if __name__ == "__main__":
    try:
        setup_dc_motors_gpio()
        setup_arm_servos()
        logger.info("Starting Raspberry Pi robot controller.")
        logger.info("Listening for WebSocket commands for DC base, servo arm, and 'automatic' sequence trigger.")
        connect_websocket()
    except KeyboardInterrupt:
        logger.info("Program interrupted by user (Ctrl+C).")
    except Exception as e:
        logger.error(f"An unexpected error occurred in main execution: {e}")
        import traceback; logger.error(traceback.format_exc())
    finally:
        logger.info("Initiating shutdown sequence...")
        all_dc_motors_stop()
        all_arm_servos_stop()
        cleanup_dc_motors_gpio()
        logger.info("Program terminated.")

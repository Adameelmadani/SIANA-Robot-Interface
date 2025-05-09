import websocket
import json
import time
import logging
import RPi.GPIO as GPIO
from adafruit_servokit import ServoKit
# import sys # No longer needed for command-line mode selection

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
SERVO_PCA_ADDRESS = 0x40
SERVO_PWM_FREQUENCY = 50 # Common for servos, ServoKit default is often 50Hz

# Continuous Rotation Servos for Arm (e.g., Base, Shoulder, Elbow - S4,S3,S2)
CONTINUOUS_SERVO_CHANNELS_ARM = [0, 1, 2] # Channels for continuous servos
CALIBRATED_STOP_THROTTLES = {
    0: 0.0670,
    1: 0.0670,
    2: 0.0670
}
SERVO_MOVEMENT_THROTTLE_VALUE = 0.3 # For continuous servos

# Positional Servo for Arm (e.g., Wrist - S1 on channel 3)
POSITIONAL_SERVO_CHANNEL_S1 = 3
POSITIONAL_SERVO_S1_INITIAL_ANGLE = 90.0
POSITIONAL_SERVO_S1_MIN_ANGLE = 0.0  # Min angle for clamping
POSITIONAL_SERVO_S1_MAX_ANGLE = 180.0 # Max angle for clamping (ServoKit default actuation_range)

# --- Global PWM Objects (DC Motors) ---
pwm_right_lpwm, pwm_right_rpwm, pwm_left_lpwm, pwm_left_rpwm = None, None, None, None

# --- Global ServoKit Object (Arm Servos) ---
kit = None

# --- Setup Functions ---
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

        # Initialize Continuous Rotation Servos
        for motor_id in CONTINUOUS_SERVO_CHANNELS_ARM:
            if motor_id in CALIBRATED_STOP_THROTTLES:
                stop_throttle = CALIBRATED_STOP_THROTTLES[motor_id]
                kit.continuous_servo[motor_id].throttle = stop_throttle
                logger.info(f"  Continuous servo on channel {motor_id} initialized to stop throttle: {stop_throttle:.4f}")
            else:
                logger.warning(f"  No calibrated stop throttle for continuous servo {motor_id}.")

        # Initialize Positional Servo (S1 - Wrist)
        try:
            # Clamp initial angle just in case
            angle_to_set = max(POSITIONAL_SERVO_S1_MIN_ANGLE, min(POSITIONAL_SERVO_S1_MAX_ANGLE, POSITIONAL_SERVO_S1_INITIAL_ANGLE))
            kit.servo[POSITIONAL_SERVO_CHANNEL_S1].angle = angle_to_set
            logger.info(f"  Positional servo on channel {POSITIONAL_SERVO_CHANNEL_S1} initialized to {angle_to_set:.1f}°.")
        except Exception as e:
            logger.error(f"  Error setting initial angle for positional servo {POSITIONAL_SERVO_CHANNEL_S1}: {e}")

    except ValueError as e:
        logger.error(f"Error initializing ServoKit (PCA9685): {e}.")
        kit = None
    except Exception as e:
        logger.error(f"Unexpected error initializing ServoKit: {e}")
        kit = None

# --- Control Functions ---
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
    GPIO.cleanup()
    logger.info("DC Motor GPIO cleanup complete.")

def control_continuous_servo(motor_id, value_direction_str, is_active): # Renamed for clarity
    global kit
    if kit is None: logger.error("ARM_SERVO CMD: ServoKit not initialized."); return
    if motor_id not in CONTINUOUS_SERVO_CHANNELS_ARM: # Check against continuous list
        logger.warning(f"ARM_SERVO CMD: Invalid continuous motor_id {motor_id}. Expected one of {CONTINUOUS_SERVO_CHANNELS_ARM}.")
        return
    
    stop_throttle = CALIBRATED_STOP_THROTTLES.get(motor_id)
    if stop_throttle is None:
        logger.error(f"ARM_SERVO CMD: No calibrated stop throttle for continuous motor_id {motor_id}. Using 0.0.")
        stop_throttle = 0.0
    
    target_throttle = stop_throttle
    action_description = "STOP"
    direction_log_text = f"(Throttle: {target_throttle:.4f})"

    if is_active:
        if value_direction_str == "right":
            target_throttle = SERVO_MOVEMENT_THROTTLE_VALUE
            action_description = "RUN RIGHT"
        elif value_direction_str == "left":
            target_throttle = -SERVO_MOVEMENT_THROTTLE_VALUE
            action_description = "RUN LEFT"
        else:
            logger.warning(f"ARM_SERVO CMD: Invalid value_direction '{value_direction_str}' for continuous motor {motor_id}. Stopping.")
            # target_throttle remains stop_throttle
        direction_log_text = f"(Throttle: {target_throttle:.4f})"
    
    logger.info(f"ARM_SERVO CMD (Continuous): Motor {motor_id} {action_description} {direction_log_text}")
    try:
        kit.continuous_servo[motor_id].throttle = target_throttle
    except Exception as e:
        logger.error(f"ARM_SERVO CMD: Error setting throttle for continuous motor {motor_id}: {e}")

def set_positional_servo_angle(channel, target_angle):
    global kit
    if kit is None: logger.error("ARM_SERVO CMD: ServoKit not initialized."); return
    
    try:
        # Clamp target angle to servo's limits (using defined constants)
        clamped_target_angle = max(POSITIONAL_SERVO_S1_MIN_ANGLE, min(POSITIONAL_SERVO_S1_MAX_ANGLE, float(target_angle)))

        if abs(clamped_target_angle - float(target_angle)) > 0.01: # Check if clamping occurred
            logger.warning(f"ARM_SERVO CMD (Positional): Target angle {target_angle}° for servo {channel} was clamped to {clamped_target_angle:.1f}°.")
        
        logger.info(f"ARM_SERVO CMD (Positional): Moving servo {channel} to {clamped_target_angle:.1f}°...")
        kit.servo[channel].angle = clamped_target_angle
    except ValueError:
        logger.error(f"ARM_SERVO CMD (Positional): Invalid angle format '{target_angle}' for servo {channel}.")
    except Exception as e:
        logger.error(f"ARM_SERVO CMD (Positional): Error setting angle for servo {channel}: {e}")


def all_arm_servos_stop(): # Now handles both types for "stop" or "relax"
    global kit
    if kit is not None:
        logger.info("ARM_SERVO COMMAND: Stopping/relaxing all defined arm servos.")
        # Stop continuous servos
        for motor_id in CONTINUOUS_SERVO_CHANNELS_ARM:
            stop_throttle = CALIBRATED_STOP_THROTTLES.get(motor_id, 0.0)
            try:
                kit.continuous_servo[motor_id].throttle = stop_throttle
                logger.debug(f"  Continuous servo {motor_id} throttle set to {stop_throttle:.4f}")
            except Exception as e:
                logger.error(f"  Error stopping continuous servo {motor_id}: {e}")
        
        # Relax positional servos
        try:
            if POSITIONAL_SERVO_CHANNEL_S1 is not None: # Check if it's defined
                 logger.debug(f"  Relaxing positional servo {POSITIONAL_SERVO_CHANNEL_S1} (angle=None).")
                 kit.servo[POSITIONAL_SERVO_CHANNEL_S1].angle = None
        except Exception as e:
            logger.error(f"  Error relaxing positional servo {POSITIONAL_SERVO_CHANNEL_S1}: {e}")
    else:
        logger.info("ARM_SERVO COMMAND: ServoKit not initialized.")

def move_robot_base(direction, is_active, speed=DEFAULT_DC_SPEED):
    # ... (This function remains unchanged from your last version) ...
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

        if message_type == 'command':
            action = data.get('action', '').lower()
            if action == 'stop':
                logger.info("COMMAND RECEIVED: E-STOP - Stopping all systems.")
                all_dc_motors_stop()
                all_arm_servos_stop()
                return
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

        elif message_type == 'servo': # For ALL arm servos (continuous or positional)
            motor_id_val = data.get('motor_id')
            motor_id = -1 # Default to invalid

            # Try to parse motor_id as integer
            try:
                motor_id = int(motor_id_val)
            except (ValueError, TypeError):
                logger.warning(f"ARM_SERVO CMD: motor_id '{motor_id_val}' is not a valid integer.")
                return # Invalid motor_id format

            # Check if it's the positional servo (S1 - Wrist)
            if motor_id == POSITIONAL_SERVO_CHANNEL_S1:
                angle_val = data.get('direction') # Using 'direction' field for angle as requested
                if angle_val is None:
                    logger.warning(f"ARM_SERVO CMD (Positional): 'direction' (angle) field missing for motor {motor_id}.")
                    return
                try:
                    target_angle = float(angle_val)
                    set_positional_servo_angle(motor_id, target_angle)
                except ValueError:
                    logger.warning(f"ARM_SERVO CMD (Positional): Invalid angle value '{angle_val}' for motor {motor_id}.")
            
            # Check if it's one of the continuous servos
            elif motor_id in CONTINUOUS_SERVO_CHANNELS_ARM:
                value_direction_str = data.get('value', '').lower() # "left" or "right"
                is_active_servo = data.get('is_active', False) # For continuous, is_active matters

                if value_direction_str not in ["left", "right"] and is_active_servo:
                    logger.warning(f"ARM_SERVO CMD (Continuous): Invalid value_direction '{value_direction_str}' for motor {motor_id} while active. Stopping servo.")
                    control_continuous_servo(motor_id, "", False) # Force stop
                    return
                control_continuous_servo(motor_id, value_direction_str, is_active_servo)
            
            else: # motor_id is not recognized for any arm servo
                logger.warning(f"ARM_SERVO CMD: motor_id {motor_id} not configured for arm control.")

        elif message_type == 'automatic':
            logger.info("WebSocket command received to START automatic base sequence.")
            logger.warning(">>> Automatic sequence will BLOCK ALL OTHER WebSocket commands until finished. <<<")
            run_automatic_base_sequence()
            logger.info("Automatic base sequence completed. Resuming WebSocket listening.")
        
        else:
            logger.warning(f"Received unknown message type: '{message_type}'")

    except json.JSONDecodeError:
        logger.error(f"Error decoding JSON: {message}")
    except Exception as e:
        logger.error(f"Error processing message: {e} (Message: {message})")
        import traceback
        logger.error(traceback.format_exc())

# --- on_error, on_close, on_open, connect_websocket (Keep as before) ---
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
        logger.info("Listening for WebSocket commands.")
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

import time
import board
import busio
from adafruit_pca9685 import PCA9685
from adafruit_motor import servo
import logging

# --- Basic Logging Setup ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- Configuration ---
PCA_I2C_ADDRESS = 0x40  # Default I2C address for PCA9685
SERVO_PWM_FREQUENCY = 50 # Hz, common for analog servos

# Servo to test (Channel 0)
SERVO_CHANNEL_TO_TEST = 0
SERVO_NAME = f"Servo_Channel_{SERVO_CHANNEL_TO_TEST}" # e.g. "MG995_Channel_0" if you know type

# Servo pulse width range (in microseconds) and actuation range (degrees)
MIN_PULSE_US = 500
MAX_PULSE_US = 2500
ACTUATION_RANGE_DEG = 180

# Movement parameters for the test
START_POSITION_DEG = 0.0     # Initial position for the servo
QUARTER_MOVEMENT_DEG = 45.0  # Move 45 degrees from the start position
END_POSITION_DEG = START_POSITION_DEG + QUARTER_MOVEMENT_DEG

# Parameters for slow movement
SLOW_MOVE_STEP_DEG = 1.0      # Move 1 degree at a time for slow movement
SLOW_MOVE_DELAY_S = 0.05   # Pause 50ms between steps (adjust for faster/slower)
                           # 0.02 = faster, 0.1 = very slow

# Ensure END_POSITION_DEG is within reasonable servo limits
if END_POSITION_DEG > ACTUATION_RANGE_DEG:
    END_POSITION_DEG = float(ACTUATION_RANGE_DEG)
    logger.warning(f"Calculated end position was > {ACTUATION_RANGE_DEG} deg. Limiting to {ACTUATION_RANGE_DEG} deg.")
if END_POSITION_DEG < 0:
    END_POSITION_DEG = 0.0
    logger.warning(f"Calculated end position was < 0 deg. Limiting to 0 deg.")


logger.info("--- PCA9685 Single Servo Slow Movement Test ---")
logger.warning("!! CRITICAL !! ENSURE WIRING (ESPECIALLY COMMON GROUND) AND SERVO POWER ARE CORRECT!")
logger.info(f"Servo on Channel {SERVO_CHANNEL_TO_TEST} will attempt to move slowly between {START_POSITION_DEG}° and {END_POSITION_DEG}°.\n")
logger.warning("Ensure your external servo power supply is adequate!\n")

pca = None
servo_motor = None
current_servo_angle = START_POSITION_DEG # Keep track of the servo's current commanded angle

def move_servo_slowly(s_obj, target_angle, current_angle, step_size=1.0, delay=0.05):
    """Moves a servo slowly from current_angle to target_angle."""
    logger.info(f"  Slowly moving '{SERVO_NAME}' from {current_angle:.1f}° to {target_angle:.1f}°...")
    
    # Ensure target is float for consistent comparison
    target_angle = float(target_angle)
    current_angle = float(current_angle)

    if abs(current_angle - target_angle) < step_size: # Already close or at target
        if s_obj.angle is None or abs(s_obj.angle - target_angle) > 0.5: # Check if servo angle is None or not at target
            s_obj.angle = target_angle
        logger.info(f"    Servo already at/near target or very small move to: {target_angle:.1f}°")
        return target_angle

    intermediate_angle = current_angle
    if target_angle > current_angle:
        # Move forward (increasing angle)
        while intermediate_angle < target_angle:
            intermediate_angle = min(intermediate_angle + step_size, target_angle)
            s_obj.angle = intermediate_angle
            # logger.debug(f"    Moved to {intermediate_angle:.1f}°") # Uncomment for detailed step logging
            time.sleep(delay)
    else: # target_angle < current_angle
        # Move backward (decreasing angle)
        while intermediate_angle > target_angle:
            intermediate_angle = max(intermediate_angle - step_size, target_angle)
            s_obj.angle = intermediate_angle
            # logger.debug(f"    Moved to {intermediate_angle:.1f}°") # Uncomment for detailed step logging
            time.sleep(delay)
    
    logger.info(f"    Servo '{SERVO_NAME}' reached {intermediate_angle:.1f}°.")
    return intermediate_angle


try:
    # Initialize I2C bus
    logger.info("Initializing I2C bus...")
    i2c = busio.I2C(board.SCL, board.SDA)
    logger.info("I2C bus initialized.")

    # Initialize PCA9685
    logger.info(f"Initializing PCA9685 at address 0x{PCA_I2C_ADDRESS:02X}...")
    pca = PCA9685(i2c, address=PCA_I2C_ADDRESS)
    logger.info("PCA9685 initialized.")

    # Set PWM frequency
    logger.info(f"Setting PCA9685 PWM frequency to {SERVO_PWM_FREQUENCY} Hz...")
    pca.frequency = SERVO_PWM_FREQUENCY
    logger.info(f"Actual PWM frequency set to: {pca.frequency:.2f} Hz.")

    # Create servo instance
    logger.info(f"Creating servo object '{SERVO_NAME}' on channel {SERVO_CHANNEL_TO_TEST}...")
    servo_motor = servo.Servo(pca.channels[SERVO_CHANNEL_TO_TEST],
                              min_pulse=MIN_PULSE_US,
                              max_pulse=MAX_PULSE_US,
                              actuation_range=ACTUATION_RANGE_DEG)
    logger.info("Servo object created.")

    logger.info(f"\nAllowing servo '{SERVO_NAME}' to initialize and move to start position ({START_POSITION_DEG}°)...")
    # Move to start position slowly or quickly? For init, quick might be fine. Let's use slow for consistency.
    current_servo_angle = move_servo_slowly(servo_motor, START_POSITION_DEG, 90, # Assume it might be at 90
                                            step_size=5.0, delay=SLOW_MOVE_DELAY_S) # Faster for initial positioning
    # servo_motor.angle = START_POSITION_DEG # Alternative: direct move
    # current_servo_angle = START_POSITION_DEG
    time.sleep(1.0) # Give servo time to move and settle

    logger.info(f"\nStarting repetitive slow movement for '{SERVO_NAME}' (Ctrl+C to stop)...")
    while True:
        # Move to quarter movement position
        current_servo_angle = move_servo_slowly(servo_motor, END_POSITION_DEG, current_servo_angle,
                                                step_size=SLOW_MOVE_STEP_DEG, delay=SLOW_MOVE_DELAY_S)
        time.sleep(0.5) # Pause at end position

        # Move back to start position
        current_servo_angle = move_servo_slowly(servo_motor, START_POSITION_DEG, current_servo_angle,
                                                step_size=SLOW_MOVE_STEP_DEG, delay=SLOW_MOVE_DELAY_S)
        time.sleep(0.5) # Pause at start position

except KeyboardInterrupt:
    logger.info("\nTest stopped by user.")
except ImportError as e:
    logger.error(f"\n--- LIBRARY ERROR ---") # Using logger.error for errors
    logger.error(f"A required library is not installed: {e}")
    logger.error("Please ensure 'adafruit-blinka', 'adafruit-circuitpython-pca9685', and 'adafruit-circuitpython-motor' are installed within your virtual environment.")
except (OSError, RuntimeError, ValueError) as e:
    logger.error(f"\n--- ERROR DETECTED ---")
    logger.error(f"An error occurred: {e}")
    logger.error("This could be due to various issues (wiring, power, I2C config, damaged hardware). Please review previous advice.")
except Exception as e:
    logger.error(f"\nAn unexpected error occurred: {e}")
finally:
    logger.info("\nInitiating shutdown sequence...")
    if servo_motor:
        neutral_angle = 90.0
        if not (0 <= neutral_angle <= ACTUATION_RANGE_DEG):
            neutral_angle = START_POSITION_DEG
        
        logger.info(f"Attempting to slowly move servo '{SERVO_NAME}' to neutral position ({neutral_angle}°)...")
        # Try to move slowly to neutral, assuming current_servo_angle is somewhat accurate
        try:
            move_servo_slowly(servo_motor, neutral_angle, current_servo_angle,
                              step_size=2.0, delay=0.02) # Relatively faster for shutdown
        except Exception as e_final_move:
            logger.warning(f"Could not perform final slow move for '{SERVO_NAME}': {e_final_move}. Setting angle directly.")
            try:
                servo_motor.angle = neutral_angle # Fallback to direct move
            except Exception as e_direct_move:
                logger.warning(f"Could not set final direct angle for '{SERVO_NAME}': {e_direct_move}")
        time.sleep(0.5)

        logger.info(f"Detaching servo '{SERVO_NAME}' (stopping PWM signal)...")
        try:
            servo_motor.angle = None
        except Exception as e_detach:
            logger.warning(f"Could not detach '{SERVO_NAME}' using angle=None: {e_detach}")
            if pca:
                logger.info(f"  Attempting direct duty_cycle=0 for channel {SERVO_CHANNEL_TO_TEST}")
                pca.channels[SERVO_CHANNEL_TO_TEST].duty_cycle = 0
    elif pca:
        logger.info(f"PCA9685 was initialized but servo object might not have been. Setting channel {SERVO_CHANNEL_TO_TEST} to 0 duty cycle.")
        pca.channels[SERVO_CHANNEL_TO_TEST].duty_cycle = 0
    else:
        logger.info("PCA9685 was not initialized. No channels to detach.")

    logger.info("Test script finished.")
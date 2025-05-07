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
SERVO_CHANNEL_TO_TEST = 0  # <<< MODIFIED TO TEST CHANNEL 0
SERVO_NAME = f"Servo_Channel_{SERVO_CHANNEL_TO_TEST}"

# Servo pulse width range (in microseconds) and actuation range (degrees)
MIN_PULSE_US = 500
MAX_PULSE_US = 2500
ACTUATION_RANGE_DEG = 180

# Movement parameters for the test
START_POSITION_DEG = 45.0     # Initial position for the servo (e.g., 45 degrees)
MOVEMENT_RANGE_DEG = 25.0   # Move 25 degrees from the start position
END_POSITION_DEG = START_POSITION_DEG + MOVEMENT_RANGE_DEG # Will be 45 + 25 = 70 degrees

# Parameters for slow movement
SLOW_MOVE_STEP_DEG = 1.0      # Move 1 degree at a time
SLOW_MOVE_DELAY_S = 0.1    # Pause 100ms between steps. Adjust if too fast/slow.
                           # (You had 10 in your paste, which is very slow; 0.1 is a moderate slow)

# Ensure END_POSITION_DEG is within reasonable servo limits
if END_POSITION_DEG > ACTUATION_RANGE_DEG:
    END_POSITION_DEG = float(ACTUATION_RANGE_DEG)
    logger.warning(f"Calculated end position was > {ACTUATION_RANGE_DEG} deg. Limiting to {ACTUATION_RANGE_DEG} deg.")
if END_POSITION_DEG < 0:
    END_POSITION_DEG = 0.0
    logger.warning(f"Calculated end position was < 0 deg. Limiting to 0 deg.")


logger.info(f"--- PCA9685 Single Servo (Channel {SERVO_CHANNEL_TO_TEST}) - 25 Degree Slow Movement Test ---") # Updated log
logger.warning("!! CRITICAL !! ENSURE WIRING (ESPECIALLY COMMON GROUND) AND SERVO POWER ARE CORRECT!")
logger.info(f"Servo on Channel {SERVO_CHANNEL_TO_TEST} will attempt to move slowly between {START_POSITION_DEG}° and {END_POSITION_DEG}° once.\n")
logger.warning("Ensure your external servo power supply is adequate!\n")

pca = None
servo_motor = None
current_servo_angle = 90.0 # An assumed initial state before script takes control

def move_servo_slowly(s_obj, target_angle, current_angle, step_size=1.0, delay=0.05):
    """Moves a servo slowly from current_angle to target_angle."""
    logger.info(f"  Slowly moving '{SERVO_NAME}' from {current_angle:.1f}° to {target_angle:.1f}°...")

    target_angle = float(target_angle)
    current_angle = float(current_angle)

    if abs(current_angle - target_angle) < step_size:
        if s_obj.angle is None or abs(s_obj.angle - target_angle) > 0.5 :
            s_obj.angle = target_angle
        logger.info(f"    Servo already at/near target or very small move to: {target_angle:.1f}°")
        return target_angle

    intermediate_angle = current_angle
    if target_angle > current_angle:
        while intermediate_angle < target_angle:
            intermediate_angle = min(intermediate_angle + step_size, target_angle)
            s_obj.angle = intermediate_angle
            time.sleep(delay)
    else: # target_angle < current_angle
        while intermediate_angle > target_angle:
            intermediate_angle = max(intermediate_angle - step_size, target_angle)
            s_obj.angle = intermediate_angle
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

    logger.info(f"\nInitializing servo '{SERVO_NAME}' to start position ({START_POSITION_DEG}°)...")
    current_servo_angle = move_servo_slowly(servo_motor, START_POSITION_DEG, current_servo_angle,
                                            step_size=5.0, delay=0.02) # Faster for initial positioning
    time.sleep(1.0)

    logger.info(f"\nPerforming one slow back-and-forth movement for '{SERVO_NAME}'...")

    # 1. Move to END_POSITION_DEG
    current_servo_angle = move_servo_slowly(servo_motor, END_POSITION_DEG, current_servo_angle,
                                            step_size=SLOW_MOVE_STEP_DEG, delay=SLOW_MOVE_DELAY_S)
    time.sleep(1.0) # Pause at end position

    # 2. Move back to START_POSITION_DEG
    current_servo_angle = move_servo_slowly(servo_motor, START_POSITION_DEG, current_servo_angle,
                                            step_size=SLOW_MOVE_STEP_DEG, delay=SLOW_MOVE_DELAY_S)
    time.sleep(1.0) # Pause at start position

    logger.info("Movement sequence complete.")


except KeyboardInterrupt:
    logger.info("\nTest stopped by user (Ctrl+C).")
except ImportError as e:
    logger.error(f"\n--- LIBRARY ERROR ---")
    logger.error(f"A required library is not installed: {e}")
    logger.error("Please ensure 'adafruit-blinka', 'adafruit-circuitpython-pca9685', and 'adafruit-circuitpython-motor' are installed.")
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
            neutral_angle = START_POSITION_DEG if START_POSITION_DEG is not None else ACTUATION_RANGE_DEG / 2.0

        logger.info(f"Attempting to slowly move servo '{SERVO_NAME}' to neutral position ({neutral_angle}°)...")
        try:
            move_servo_slowly(servo_motor, neutral_angle, current_servo_angle,
                              step_size=2.0, delay=0.02)
        except Exception as e_final_move:
            logger.warning(f"Could not perform final slow move for '{SERVO_NAME}': {e_final_move}. Setting angle directly.")
            try:
                servo_motor.angle = neutral_angle
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
        if 0 <= SERVO_CHANNEL_TO_TEST < 16:
             pca.channels[SERVO_CHANNEL_TO_TEST].duty_cycle = 0
    else:
        logger.info("PCA9685 was not initialized. No channels to detach.")

    logger.info("Test script finished.")
import time
import board # For I2C pin definitions (SDA, SCL)
import busio # For I2C communication
from adafruit_pca9685 import PCA9685
from adafruit_motor import servo
import logging

# --- Basic Logging Setup ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- Configuration ---
PCA_I2C_ADDRESS = 0x40  # Default I2C address for PCA9685
SERVO_PWM_FREQUENCY = 50 # Hz, common for analog servos

# Define servo channels and give them names for easier reference
SERVO_SETUP = {
    "MG995_Channel_0": {"channel": 0, "type": "MG995"},
    "MG995_Channel_1": {"channel": 1, "type": "MG995"},
    "MG995_Channel_2": {"channel": 2, "type": "MG995"},
    "SG90_Channel_3":  {"channel": 3, "type": "SG90"}
}

# Servo pulse width range (in microseconds) and actuation range (degrees)
# These are general values; individual servos might need slight tuning for precise 0-180.
# Both MG995 and SG90 generally work well with a 500-2500us range for 180 degrees.
MIN_PULSE_US = 500
MAX_PULSE_US = 2500
ACTUATION_RANGE_DEG = 180

# Movement parameters for the test
START_POSITION_DEG = 0     # Initial position for the servos
QUARTER_MOVEMENT_DEG = 45  # Move 45 degrees from the start position
END_POSITION_DEG = START_POSITION_DEG + QUARTER_MOVEMENT_DEG

# Ensure END_POSITION_DEG is within reasonable servo limits
if END_POSITION_DEG > ACTUATION_RANGE_DEG:
    END_POSITION_DEG = ACTUATION_RANGE_DEG
    logger.warning(f"Calculated end position was > {ACTUATION_RANGE_DEG} deg. Limiting to {ACTUATION_RANGE_DEG} deg.")
if END_POSITION_DEG < 0:
    END_POSITION_DEG = 0
    logger.warning(f"Calculated end position was < 0 deg. Limiting to 0 deg.")


logger.info("--- PCA9685 Multi-Servo Quarter Movement Test ---")
logger.warning("!! CRITICAL !! ENSURE WIRING (ESPECIALLY COMMON GROUND) AND SERVO POWER ARE CORRECT!")
logger.info(f"Servos on Channels {list(s_info['channel'] for s_info in SERVO_SETUP.values())} will attempt to move between {START_POSITION_DEG}° and {END_POSITION_DEG}°.\n")
logger.warning("Ensure your external servo power supply is ADEQUATE for all 4 servos!\n")

pca = None
servo_objects = {} # Dictionary to store servo objects, keyed by name from SERVO_SETUP

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

    # Create servo instances
    logger.info("Creating servo objects...")
    for name, s_info in SERVO_SETUP.items():
        channel = s_info["channel"]
        logger.info(f"  Creating servo '{name}' (type: {s_info['type']}) on channel {channel}...")
        servo_objects[name] = servo.Servo(pca.channels[channel],
                                          min_pulse=MIN_PULSE_US,
                                          max_pulse=MAX_PULSE_US,
                                          actuation_range=ACTUATION_RANGE_DEG)
    logger.info("All servo objects created.")

    logger.info("\nAllowing servos to initialize and move to start position...")
    for name, s_obj in servo_objects.items():
        logger.info(f"  Moving '{name}' to {START_POSITION_DEG}°")
        s_obj.angle = START_POSITION_DEG
    time.sleep(2.5) # Give servos time to move and settle, increased for multiple servos

    logger.info(f"\nStarting repetitive movement (Ctrl+C to stop)...")
    while True:
        # Move all servos to quarter movement position
        logger.info(f"  Moving all servos to {END_POSITION_DEG}°")
        for name, s_obj in servo_objects.items():
            s_obj.angle = END_POSITION_DEG
        time.sleep(2.0)  # Pause to observe, increased for multiple servos

        # Move all servos back to start position
        logger.info(f"  Moving all servos back to {START_POSITION_DEG}°")
        for name, s_obj in servo_objects.items():
            s_obj.angle = START_POSITION_DEG
        time.sleep(2.0)  # Pause to observe, increased for multiple servos

except KeyboardInterrupt:
    logger.info("\nTest stopped by user.")
except ImportError as e:
    logger.error(f"\n--- LIBRARY ERROR ---")
    logger.error(f"A required library is not installed: {e}")
    logger.error("Please ensure 'adafruit-blinka', 'adafruit-circuitpython-pca9685', and 'adafruit-circuitpython-motor' are installed within your virtual environment.")
except (OSError, RuntimeError, ValueError) as e:
    logger.error(f"\n--- ERROR DETECTED ---")
    logger.error(f"An error occurred: {e}")
    logger.error("This could be due to any of the following:")
    logger.error("  1. Incorrect I2C wiring (SDA, SCL, GND, VCC).")
    logger.error("  2. PCA9685 not powered correctly (check VCC for logic - 3.3V from Pi, and V+ for servos - external 5-6V).")
    logger.error("  3. I2C not enabled on Raspberry Pi (`sudo raspi-config`).")
    logger.error(f"  4. Incorrect I2C address for PCA9685 (default is 0x{PCA_I2C_ADDRESS:02X}). Use `sudo i2cdetect -y 1` to check.")
    logger.error("  5. Hardware damage to the Raspberry Pi or PCA9685 from any previous incident.")
    logger.error("  6. Servo(s) not properly connected or servo power (V+) not supplied/insufficient for all servos.")
    logger.error("     (An underpowered supply can cause the PCA9685 or Pi to reset/behave erratically).")
except Exception as e:
    logger.error(f"\nAn unexpected error occurred: {e}")
finally:
    logger.info("\nInitiating shutdown sequence...")
    if servo_objects: # If servo objects were created
        logger.info("Attempting to move servos to a neutral/safe position...")
        neutral_angle = 90 # A common neutral position
        if not (0 <= neutral_angle <= ACTUATION_RANGE_DEG): # If 90 is out of defined range, use start
            neutral_angle = START_POSITION_DEG

        for name, s_obj in servo_objects.items():
            try:
                logger.info(f"  Setting '{name}' to {neutral_angle}°")
                s_obj.angle = neutral_angle
            except Exception as e_final:
                logger.warning(f"    Could not set final angle for '{name}': {e_final}")
        time.sleep(1.0) # Allow time for servos to move

        logger.info("Detaching all servos (stopping PWM signals)...")
        for name, s_obj in servo_objects.items():
            try:
                s_obj.angle = None # Stops sending pulses for adafruit_motor.servo
            except Exception as e_final:
                 logger.warning(f"    Could not detach '{name}': {e_final}")
                 # Fallback if angle=None fails, try setting duty_cycle to 0 directly
                 if pca and hasattr(pca, 'channels'):
                    channel_num_to_detach = SERVO_SETUP[name]["channel"]
                    if channel_num_to_detach < 16: # Max channels on PCA9685
                        logger.info(f"      Attempting direct duty_cycle=0 for channel {channel_num_to_detach}")
                        pca.channels[channel_num_to_detach].duty_cycle = 0
    elif pca: # If only pca was initialized but no servo objects created (e.g. error during servo init)
        logger.warning("PCA9685 was initialized but servo objects might not have been. Setting all configured test channels to 0 duty cycle.")
        for s_info in SERVO_SETUP.values():
            channel_num_to_detach = s_info["channel"]
            if channel_num_to_detach < 16 : # Max channels on PCA9685
                 pca.channels[channel_num_to_detach].duty_cycle = 0
    else:
        logger.info("PCA9685 was not initialized. No channels to detach.")

    logger.info("Test script finished.")
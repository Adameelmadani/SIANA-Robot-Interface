# basic_servo_feel_test.py

import time
from adafruit_servokit import ServoKit

# --- Configuration ---
SERVO_CHANNEL = 0          # Which channel on the PCA9685 the servo is connected to (0-15)
BASE_ANGLE = 90.0          # The initial and return position for the servo (degrees)
DELAY_AFTER_MOVE = 0.5     # Seconds to pause after each servo movement to observe

# PCA9685 Settings
I2C_ADDRESS = 0x40         # Default PCA9685 I2C address
PWM_FREQUENCY = 50         # Standard PWM frequency for servos (Hz)

# --- Initialization ---
try:
    # Initialize ServoKit
    kit = ServoKit(channels=16, address=I2C_ADDRESS, frequency=PWM_FREQUENCY)
    print(f"PCA9685 initialized on channel {SERVO_CHANNEL} at address 0x{I2C_ADDRESS:X}, {PWM_FREQUENCY}Hz.")
except Exception as e:
    print(f"Error initializing PCA9685: {e}")
    print("Please ensure the PCA9685 is connected correctly, I2C is enabled, and the address is correct.")
    exit()

# Get the allowed angle range for the servo (usually 0-180 degrees by default in ServoKit)
try:
    MIN_ANGLE = 0.0
    MAX_ANGLE = float(kit.servo[SERVO_CHANNEL].actuation_range)
    print(f"Servo actuation range configured from {MIN_ANGLE:.1f} to {MAX_ANGLE:.1f} degrees.")
except Exception as e:
    print(f"Could not get actuation_range, defaulting to 0-180. Error: {e}")
    MIN_ANGLE = 0.0
    MAX_ANGLE = 180.0

# --- Main Program ---
if __name__ == "__main__":
    print(f"\nBasic Servo Feel Test - Channel {SERVO_CHANNEL}")
    print(f"Servo will start at {BASE_ANGLE:.1f} degrees.")
    print(f"Enter a positive or negative number of degrees for relative movement.")
    print(f"The servo will move by that amount, then return to {BASE_ANGLE:.1f} degrees.")
    print("Type 'q' or 'quit' to exit.")

    # Move servo to the base position initially
    try:
        # Clamp BASE_ANGLE just in case it's outside the servo's actual range
        clamped_base_angle = max(MIN_ANGLE, min(MAX_ANGLE, BASE_ANGLE))
        if abs(clamped_base_angle - BASE_ANGLE) > 0.01 :
            print(f"Note: Requested BASE_ANGLE {BASE_ANGLE:.1f} was clamped to {clamped_base_angle:.1f} to fit actuation range.")
        
        print(f"\nMoving servo to base position: {clamped_base_angle:.1f} degrees...")
        kit.servo[SERVO_CHANNEL].angle = clamped_base_angle
        time.sleep(1) # Give it time to reach the base position
        current_base_angle = clamped_base_angle # This is the actual base we are using
        print("Ready.")
    except Exception as e:
        print(f"Error moving servo to base position: {e}")
        exit()

    while True:
        try:
            command_input = input(f"\nEnter relative degrees from {current_base_angle:.1f}° (or 'q' to quit): ").strip().lower()

            if command_input in ['q', 'quit']:
                print("Exiting test.")
                break

            delta_degrees = float(command_input) # Try to convert input to a number

            # Calculate target angle
            target_angle = current_base_angle + delta_degrees

            # Clamp target angle to servo's limits
            clamped_target_angle = max(MIN_ANGLE, min(MAX_ANGLE, target_angle))

            if abs(clamped_target_angle - target_angle) > 0.01 : # Check if clamping occurred
                print(f"Note: Target {target_angle:.1f}° (from {current_base_angle:.1f}° + {delta_degrees:.1f}°) was clamped to {clamped_target_angle:.1f}°.")
            
            # Move to the target angle
            print(f"Moving to: {clamped_target_angle:.1f} degrees...")
            kit.servo[SERVO_CHANNEL].angle = clamped_target_angle
            time.sleep(DELAY_AFTER_MOVE) # Pause to observe

            # Return to the base angle
            print(f"Returning to base: {current_base_angle:.1f} degrees...")
            kit.servo[SERVO_CHANNEL].angle = current_base_angle
            time.sleep(DELAY_AFTER_MOVE) # Pause to observe

        except ValueError:
            print("Invalid input. Please enter a number (e.g., 30, -45) or 'q'.")
        except KeyboardInterrupt:
            print("\nExiting test due to user interrupt.")
            break
        except Exception as e:
            print(f"An error occurred: {e}")
            break # Exit on other errors

    # Optional: Relax the servo on exit
    try:
        print("Setting servo to None to relax it (if supported).")
        kit.servo[SERVO_CHANNEL].angle = None
    except Exception as e:
        print(f"Could not relax servo: {e}")

    print("Program finished.")
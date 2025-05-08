# interactive_continuous_servo_control.py

import time
from adafruit_servokit import ServoKit

# --- User Configuration ---
SERVO_CHANNEL = 0  # Channel your continuous servo is on

# !!! CRITICAL: Replace 0.0 with the throttle value that makes YOUR servo stop perfectly !!!
# You should have found this from the previous calibration steps.
# Examples: CALIBRATED_STOP_THROTTLE = 0.0
#           CALIBRATED_STOP_THROTTLE = -0.02
#           CALIBRATED_STOP_THROTTLE = 0.035
CALIBRATED_STOP_THROTTLE = 0.0670  # <<<<---- REPLACE THIS WITH YOUR SERVO'S VALUE

# --- PCA9685 Settings ---
I2C_ADDRESS = 0x40
PWM_FREQUENCY = 50

# --- Initialization ---
try:
    kit = ServoKit(channels=16, address=I2C_ADDRESS, frequency=PWM_FREQUENCY)
    print(f"PCA9685 initialized for continuous servo on channel {SERVO_CHANNEL}.")
    print(f"Using CALIBRATED_STOP_THROTTLE: {CALIBRATED_STOP_THROTTLE:.3f}")
    print("If the servo creeps when 'stopped', please update CALIBRATED_STOP_THROTTLE in the script.")
except Exception as e:
    print(f"Error initializing PCA9685: {e}")
    exit()

# --- Main Program ---
if __name__ == "__main__":
    current_throttle = CALIBRATED_STOP_THROTTLE
    is_spinning = False

    # Ensure servo is stopped initially
    try:
        print(f"\nSetting initial throttle to calibrated stop: {CALIBRATED_STOP_THROTTLE:.3f}")
        kit.continuous_servo[SERVO_CHANNEL].throttle = CALIBRATED_STOP_THROTTLE
    except Exception as e:
        print(f"Error setting initial throttle: {e}")
        exit()

    print("\nInteractive Continuous Servo Control")
    print("Commands:")
    print("  run <throttle>  : Start spinning. Throttle is a value from -1.0 (full reverse) to 1.0 (full forward).")
    print("                    Example: 'run 0.5' (half speed forward)")
    print("                             'run -0.7' (faster speed reverse)")
    print("  stop            : Stop the servo (applies calibrated stop throttle).")
    print("  status          : Show current throttle status.")
    print("  quit            : Stop the servo and exit.")

    while True:
        status_text = "Stopped"
        if is_spinning:
            if abs(current_throttle - CALIBRATED_STOP_THROTTLE) < 0.001: # effectively stopped
                 status_text = f"Stopped (at calibrated stop: {current_throttle:.3f})"
                 is_spinning = False # Correct state
            else:
                direction = "Forward" if current_throttle > CALIBRATED_STOP_THROTTLE else "Reverse"
                if current_throttle < CALIBRATED_STOP_THROTTLE: direction = "Reverse" # More precise for non-zero stop
                if abs(current_throttle - CALIBRATED_STOP_THROTTLE) < 0.01 : direction = "Barely Moving/Creeping (near stop)"
                
                status_text = f"Spinning ({direction} at throttle {current_throttle:.3f})"
        
        try:
            command_input = input(f"\n[{status_text}] Enter command: ").strip().lower()
            parts = command_input.split()
            command = parts[0] if parts else ""

            if command == "run":
                if len(parts) > 1:
                    try:
                        throttle_value = float(parts[1])
                        # Clamp throttle value
                        if throttle_value < -1.0: throttle_value = -1.0
                        if throttle_value > 1.0: throttle_value = 1.0
                        
                        current_throttle = throttle_value
                        kit.continuous_servo[SERVO_CHANNEL].throttle = current_throttle
                        is_spinning = abs(current_throttle - CALIBRATED_STOP_THROTTLE) > 0.001 # Considered spinning if not effectively at stop
                        print(f"Set servo to run at throttle: {current_throttle:.3f}")
                    except ValueError:
                        print("Invalid throttle value. Please enter a number between -1.0 and 1.0.")
                else:
                    print("Usage: run <throttle_value> (e.g., run 0.5 or run -0.3)")

            elif command == "stop":
                current_throttle = CALIBRATED_STOP_THROTTLE
                kit.continuous_servo[SERVO_CHANNEL].throttle = current_throttle
                is_spinning = False
                print(f"Servo stopped (throttle set to calibrated: {current_throttle:.3f}).")
                print("Remember: This stops rotation. It does not lock the servo's angle/position.")

            elif command == "status":
                # Status is already printed in the prompt, but this can be an explicit command
                print(f"Current commanded throttle: {current_throttle:.3f}. Servo state: {status_text}")

            elif command == "quit":
                print("Stopping servo and exiting...")
                kit.continuous_servo[SERVO_CHANNEL].throttle = CALIBRATED_STOP_THROTTLE
                time.sleep(0.1) # Give it a moment to process the stop command
                break
            
            elif not command: # Empty input
                pass

            else:
                print("Unknown command. Available commands: run <throttle>, stop, status, quit")

        except KeyboardInterrupt:
            print("\nUser interrupt. Stopping servo and exiting...")
            kit.continuous_servo[SERVO_CHANNEL].throttle = CALIBRATED_STOP_THROTTLE
            time.sleep(0.1)
            break
        except Exception as e:
            print(f"An unexpected error occurred: {e}")
            try: # Attempt to stop the servo in case of error
                kit.continuous_servo[SERVO_CHANNEL].throttle = CALIBRATED_STOP_THROTTLE
            except:
                pass
            break
            
    print("Program finished.")
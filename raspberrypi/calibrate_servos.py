# calibrate_continuous_servo_stop.py

import time
from adafruit_servokit import ServoKit

# --- User Configuration ---
SERVO_CHANNEL = 0  # Channel your continuous servo is on
INITIAL_THROTTLE = 0.0
INCREMENT_STEP_SMALL = 0.001  # For very fine adjustments
INCREMENT_STEP_MEDIUM = 0.005 # For slightly larger adjustments
INCREMENT_STEP_LARGE = 0.01   # For initial coarse adjustments

# --- PCA9685 Settings ---
I2C_ADDRESS = 0x40
PWM_FREQUENCY = 50

# --- Initialization ---
try:
    kit = ServoKit(channels=16, address=I2C_ADDRESS, frequency=PWM_FREQUENCY)
    print(f"PCA9685 initialized for continuous servo on channel {SERVO_CHANNEL}.")
except Exception as e:
    print(f"Error initializing PCA9685: {e}")
    exit()

# --- Main Program ---
if __name__ == "__main__":
    current_throttle = INITIAL_THROTTLE

    print("\n--- Continuous Servo Stop Throttle Calibration ---")
    print(f"Servo Channel: {SERVO_CHANNEL}")
    print("The goal is to find the throttle value that makes the servo perfectly still.")
    print("Commands:")
    print("  <number>        : Set throttle directly (e.g., 0.01, -0.005).")
    print(f"  +s / -s         : Increase/Decrease by SMALL step ({INCREMENT_STEP_SMALL}).")
    print(f"  +m / -m         : Increase/Decrease by MEDIUM step ({INCREMENT_STEP_MEDIUM}).")
    print(f"  +l / -l         : Increase/Decrease by LARGE step ({INCREMENT_STEP_LARGE}).")
    print("  z               : Reset throttle to 0.0.")
    print("  q / quit        : Exit and show the final calibrated throttle value.")
    print("----------------------------------------------------")

    try:
        print(f"\nSetting initial throttle to: {current_throttle:.4f}")
        kit.continuous_servo[SERVO_CHANNEL].throttle = current_throttle
    except Exception as e:
        print(f"Error setting initial throttle: {e}")
        exit()

    while True:
        try:
            # Apply the current throttle
            # Clamping to ensure it stays within reasonable bounds for calibration,
            # though for stop it should be very close to 0.
            # Let's allow a bit wider range initially in case 0.0 is far off.
            clamped_throttle = max(-0.2, min(0.2, current_throttle)) # Focus range for stop
            # For more general throttle testing, you might use -1.0 to 1.0
            # but for stop calibration, a smaller range is more practical for display.
            
            # Apply to servo
            kit.continuous_servo[SERVO_CHANNEL].throttle = clamped_throttle
            if abs(clamped_throttle - current_throttle)>0.0001: # If it was clamped due to the -0.2 to 0.2 limit
                print(f"(Note: Input {current_throttle:.4f} was focused to {clamped_throttle:.4f} for stop calibration range)")
                current_throttle = clamped_throttle


            command_input = input(f"Current throttle: {current_throttle:.4f} | Enter command: ").strip().lower()

            if command_input in ['q', 'quit']:
                print("\nCalibration finished.")
                print(f"The final throttle value (your CALIBRATED_STOP_THROTTLE) is: {current_throttle:.4f}")
                print("Make sure the servo is completely still at this value.")
                print("Use this value in your other scripts where CALIBRATED_STOP_THROTTLE is needed.")
                # Gently try to stop it one last time before exiting
                kit.continuous_servo[SERVO_CHANNEL].throttle = current_throttle 
                time.sleep(0.1)
                # Optionally truly stop PWM by setting throttle to None if supported by servo/library for detach
                # kit.continuous_servo[SERVO_CHANNEL].throttle = None 
                break
            
            elif command_input == 'z':
                current_throttle = 0.0
                print("Throttle reset to 0.0")
            elif command_input == '+s':
                current_throttle += INCREMENT_STEP_SMALL
            elif command_input == '-s':
                current_throttle -= INCREMENT_STEP_SMALL
            elif command_input == '+m':
                current_throttle += INCREMENT_STEP_MEDIUM
            elif command_input == '-m':
                current_throttle -= INCREMENT_STEP_MEDIUM
            elif command_input == '+l':
                current_throttle += INCREMENT_STEP_LARGE
            elif command_input == '-l':
                current_throttle -= INCREMENT_STEP_LARGE
            else:
                try:
                    # Try to parse as a direct float value
                    new_val = float(command_input)
                    current_throttle = new_val
                    print(f"Throttle set directly to: {current_throttle:.4f}")
                except ValueError:
                    print("Invalid command. Please use a number, +/-[s,m,l], 'z', or 'q'.")
            
            # Ensure throttle is not excessively large if set directly
            # For stop calibration, it should really be small, but let's not restrict too much here
            # current_throttle = max(-1.0, min(1.0, current_throttle))


        except KeyboardInterrupt:
            print("\nUser interrupt.")
            print(f"Exiting. Last throttle value was: {current_throttle:.4f}")
            kit.continuous_servo[SERVO_CHANNEL].throttle = current_throttle # Try to apply last value
            time.sleep(0.1)
            break
        except Exception as e:
            print(f"An error occurred: {e}")
            break
            
    print("Calibration script ended.")
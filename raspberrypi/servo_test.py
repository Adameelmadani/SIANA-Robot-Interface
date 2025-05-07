# Simple demo of of the PCA9685 PWM servo/LED controller library.
# This will move channel 0 from min to max position repeatedly.
# Added reset/stop functionality on exit.
# Author: Tony DiCola
# License: Public Domain
from __future__ import division
import time

# Import the PCA9685 module.
import Adafruit_PCA9685


# Uncomment to enable debug output.
#import logging
#logging.basicConfig(level=logging.DEBUG)

# Initialize pwm object to None first, so it exists for the finally block
pwm = None

try:
    # Initialise the PCA9685 using the default address (0x40) and bus 1.
    pwm = Adafruit_PCA9685.PCA9685(address=0x40, busnum=1)

    # Configure min and max servo pulse lengths
    servo_min = 150  # Min pulse length out of 4096
    servo_max = 600  # Max pulse length out of 4096

    # Helper function to make setting a servo pulse width simpler.
    # (This function is defined but not used in the main loop of this script)
    def set_servo_pulse(channel, pulse):
        pulse_length = 1000000    # 1,000,000 us per second
        pulse_length //= 60       # 60 Hz
        print('{0}us per period'.format(pulse_length))
        pulse_length //= 4096     # 12 bits of resolution
        print('{0}us per bit'.format(pulse_length))
        pulse *= 1000 # This line assumes 'pulse' is in milliseconds
        pulse //= pulse_length
        # Ensure pwm object is available before using it
        if pwm:
            pwm.set_pwm(channel, 0, pulse)

    # Set frequency to 60hz, good for servos.
    pwm.set_pwm_freq(60)

    print('Moving servo on channel 0, press Ctrl-C to quit...')
    while True:
        # Move servo on channel O between extremes.
        pwm.set_pwm(0, 0, servo_min)
        time.sleep(1)
        pwm.set_pwm(0, 0, servo_max)
        time.sleep(1)

except KeyboardInterrupt:
    print("\nExiting program (Ctrl+C pressed).")
except Exception as e:
    print(f"\nAn error occurred: {e}")
finally:
    if pwm:  # Check if pwm object was successfully initialized
        # This is the "reset" part: stop the PWM signal on channel 0
        print("Stopping PWM on channel 0 (resetting servo state).")
        # Setting all bits for a channel to off (0,0 is one way, some use 0,4096)
        # For servos, setting the pulse width to 0 effectively stops driving it.
        pwm.set_pwm(0, 0, 0) # Set channel 0, ON tick 0, OFF tick 0
    print("Program finished.")
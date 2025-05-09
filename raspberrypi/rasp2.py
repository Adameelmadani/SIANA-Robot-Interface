# This function replaces the previous run_automatic_base_sequence()
# Ensure all necessary global variables and helper functions like
# move_robot_base, all_dc_motors_stop, control_continuous_servo,
# DEFAULT_DC_SPEED, SERVO_MOVEMENT_THROTTLE_VALUE, CALIBRATED_STOP_THROTTLES
# are defined in your script.

def run_automatic_base_sequence():
    logger.info("AUTOMATIC MODE: Sequence started (this will block other WebSocket commands).")
    auto_speed_dc = DEFAULT_DC_SPEED  # Speed for DC base motors
    arm_servo_id_to_move = 0         # Servo ID 0 for the arm movement

    try:
        # --- Part 1: DC Base Movement ---
        logger.info("AUTOMATIC MODE: Base advancing for 6 seconds...")
        move_robot_base("forward", True, auto_speed_dc)
        time.sleep(6)
        move_robot_base("forward", False, auto_speed_dc) # Stop DC base
        logger.info("AUTOMATIC MODE: Base stopped after first advance.")

        # --- Part 2: Arm Servo Maneuver during Base Pause (approx 15s slot) ---
        logger.info(f"AUTOMATIC MODE: Starting arm servo {arm_servo_id_to_move} maneuver...")

        # 2a. Arm servo 0 moves "right" for 3 seconds
        logger.info(f"AUTOMATIC MODE: Arm servo {arm_servo_id_to_move} moving 'right' for 3 seconds...")
        control_continuous_servo(arm_servo_id_to_move, "right", True)
        time.sleep(3)
        control_continuous_servo(arm_servo_id_to_move, "right", False) # Stop arm servo 0
        logger.info(f"AUTOMATIC MODE: Arm servo {arm_servo_id_to_move} stopped after 'right' movement.")
        time.sleep(1)  # Brief 1-second pause for the arm/observation

        # 2b. Arm servo 0 moves "left" for 4 seconds
        logger.info(f"AUTOMATIC MODE: Arm servo {arm_servo_id_to_move} moving 'left' for 4 seconds...")
        control_continuous_servo(arm_servo_id_to_move, "left", True)
        time.sleep(4)
        control_continuous_servo(arm_servo_id_to_move, "left", False) # Stop arm servo 0
        logger.info(f"AUTOMATIC MODE: Arm servo {arm_servo_id_to_move} stopped after 'left' movement.")
        time.sleep(1)  # Brief 1-second pause for the arm/observation

        # 2c. Calculate and execute remaining pause time for this segment
        # Time spent in arm servo maneuvers and brief pauses: 3s (move) + 1s (pause) + 4s (move) + 1s (pause) = 9s
        # Original slot was intended to be ~15s for the base to be stopped.
        remaining_pause_duration = 15 - (3 + 1 + 4 + 1)
        if remaining_pause_duration > 0:
            logger.info(f"AUTOMATIC MODE: Pausing DC base for an additional {remaining_pause_duration} seconds...")
            time.sleep(remaining_pause_duration)
        logger.info("AUTOMATIC MODE: Arm servo maneuver and base pause segment finished.")

        # --- Part 3: DC Base Movement ---
        logger.info("AUTOMATIC MODE: Base advancing again for 6 seconds...")
        move_robot_base("forward", True, auto_speed_dc)
        time.sleep(6)
        move_robot_base("forward", False, auto_speed_dc) # Stop DC base
        logger.info("AUTOMATIC MODE: Base stopped after second advance.")

        # --- Part 4: DC Base Movement ---
        logger.info("AUTOMATIC MODE: Base returning to start (moving backward for 12s)...")
        move_robot_base("backward", True, auto_speed_dc)
        time.sleep(12)
        move_robot_base("backward", False, auto_speed_dc) # Stop DC base
        logger.info("AUTOMATIC MODE: Base returned to start and stopped.")

    except KeyboardInterrupt:
        logger.info("AUTOMATIC MODE: Interrupted by user during sequence. Stopping all motors/servos.")
        all_dc_motors_stop()
        # Ensure specific arm servo being moved is also stopped
        if 'kit' in globals() and kit is not None and arm_servo_id_to_move in CALIBRATED_STOP_THROTTLES:
            control_continuous_servo(arm_servo_id_to_move, "", False)
        raise # Re-raise to allow the main script's finally block to execute fully
    except Exception as e:
        logger.error(f"AUTOMATIC MODE: Error during sequence: {e}")
        all_dc_motors_stop()
        if 'kit' in globals() and kit is not None and arm_servo_id_to_move in CALIBRATED_STOP_THROTTLES:
            control_continuous_servo(arm_servo_id_to_move, "", False)
    finally:
        # Ensure the specific arm servo used in the sequence is explicitly stopped
        # in case the sequence ended mid-servo-maneuver due to an error other than KeyboardInterrupt
        if 'kit' in globals() and kit is not None and arm_servo_id_to_move in CALIBRATED_STOP_THROTTLES:
             if not isinstance(e, KeyboardInterrupt): # if not already handled by specific except
                logger.info(f"AUTOMATIC MODE: Ensuring arm servo {arm_servo_id_to_move} is stopped post-sequence.")
                control_continuous_servo(arm_servo_id_to_move, "", False)
        logger.info("AUTOMATIC MODE: Sequence function finished or was interrupted.")

document.addEventListener('DOMContentLoaded', () => {
    // Speed control
    const speedSlider = document.getElementById('speed-slider');
    const speedValue = document.getElementById('speed-value');
    const increaseBtn = document.getElementById('increase-speed');
    const decreaseBtn = document.getElementById('decrease-speed');

    // Update speed value
    function updateSpeedValue() {
        speedValue.textContent = speedSlider.value;
    }

    speedSlider.addEventListener('input', updateSpeedValue);

    increaseBtn.addEventListener('click', () => {
        const currentValue = parseInt(speedSlider.value);
        if (currentValue < 20) {
            speedSlider.value = currentValue + 1;
            updateSpeedValue();
            logOperation(`Changement vitesse`, `Vitesse augmentée à ${speedSlider.value}`);
        }
    });

    decreaseBtn.addEventListener('click', () => {
        const currentValue = parseInt(speedSlider.value);
        if (currentValue > 0) {
            speedSlider.value = currentValue - 1;
            updateSpeedValue();
            logOperation(`Changement vitesse`, `Vitesse réduite à ${speedSlider.value}`);
        }
    });

    // Robot control buttons
    const directionButtons = document.querySelectorAll('.direction-btn');
    
    directionButtons.forEach(button => {
        button.addEventListener('mousedown', () => {
            const direction = button.id;
            controlRobot(direction, true);
        });
        
        button.addEventListener('mouseup', () => {
            const direction = button.id;
            controlRobot(direction, false);
        });
        
        button.addEventListener('mouseleave', () => {
            const direction = button.id;
            controlRobot(direction, false);
        });
    });

    function controlRobot(direction, isActive) {
        if (isActive) {
            console.log(`Moving robot: ${direction}`);
            logOperation(`Mouvement`, `Direction: ${direction}`);
            
            // Here you would send commands to the robot
            // For example via WebSockets or a REST API
        }
    }

    // Robot start/stop
    const startBtn = document.getElementById('start-btn');
    const stopBtn = document.getElementById('stop-btn');
    
    startBtn.addEventListener('click', () => {
        console.log('Robot started');
        logOperation('Démarrage', 'Robot initialisé');
        
        // Simulate connection status
        document.getElementById('wifi-status').className = 'connected';
        document.getElementById('wifi-status').innerHTML = '<i class="fa-solid fa-wifi"></i> Connecté';
    });
    
    stopBtn.addEventListener('click', () => {
        console.log('Robot stopped');
        logOperation('Arrêt', 'Robot arrêté');
        
        // Simulate disconnection status
        document.getElementById('wifi-status').className = 'disconnected';
        document.getElementById('wifi-status').innerHTML = '<i class="fa-solid fa-wifi"></i> Déconnecté';
    });

    // Log operations to the history table
    function logOperation(event, details) {
        const now = new Date();
        const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
        
        const historyTable = document.getElementById('operations-history').getElementsByTagName('tbody')[0];
        const newRow = historyTable.insertRow(0);
        
        const cell1 = newRow.insertCell(0);
        const cell2 = newRow.insertCell(1);
        const cell3 = newRow.insertCell(2);
        
        cell1.textContent = time;
        cell2.textContent = event;
        cell3.textContent = details;
    }

    // Simulated monitoring functions
    function monitorBattery() {
        let batteryLevel = 75; // Starting level in percent
        
        setInterval(() => {
            batteryLevel -= Math.random() * 0.5;
            
            if (batteryLevel < 0) batteryLevel = 0;
            
            document.getElementById('battery-percentage').textContent = `${Math.round(batteryLevel)}%`;
            document.querySelector('.battery-level').style.width = `${batteryLevel}%`;
            
            // Change color based on level
            if (batteryLevel < 20) {
                document.querySelector('.battery-level').style.backgroundColor = 'var(--danger-color)';
                
                // Add a defect alert if battery is very low
                if (batteryLevel < 15 && document.querySelectorAll('.defect:contains("Batterie")').length === 0) {
                    addDefect('Batterie critique', 'critical');
                }
            } else if (batteryLevel < 40) {
                document.querySelector('.battery-level').style.backgroundColor = 'var(--warning-color)';
            }
        }, 10000); // Update every 10 seconds
    }

    function monitorDistance() {
        let distance = 142; // Starting distance in meters
        
        setInterval(() => {
            if (document.getElementById('wifi-status').className === 'connected') {
                distance += Math.random() * 0.2;
                document.getElementById('distance-value').textContent = `${Math.round(distance * 10) / 10} m`;
            }
        }, 1000); // Update every second
    }

    // Add a defect to the list
    function addDefect(message, level) {
        const defectsList = document.getElementById('defects-list');
        const defect = document.createElement('li');
        defect.className = `defect ${level}`;
        
        const icon = level === 'warning' ? 'fa-exclamation-triangle' : 'fa-times-circle';
        defect.innerHTML = `<i class="fa-solid ${icon}"></i> ${message}`;
        
        defectsList.prepend(defect);
        
        // Also log to operation history
        logOperation('Défaut', message);
    }

    // Random simulation of sensor values
    function simulateSensors() {
        // Luminosity simulation
        setInterval(() => {
            const luminosity = Math.floor(70 + Math.random() * 30);
            document.getElementById('luminosity-value').textContent = `${luminosity}%`;
            
            if (luminosity < 75) {
                addDefect('Luminosité faible', 'warning');
            }
        }, 15000); // Update every 15 seconds
    }

    // Ping simulation
    function simulatePing() {
        setInterval(() => {
            const connected = Math.random() > 0.1; // 10% chance of disconnection
            const wifiStatus = document.getElementById('wifi-status');
            
            if (connected) {
                wifiStatus.className = 'connected';
                wifiStatus.innerHTML = '<i class="fa-solid fa-wifi"></i> Connecté';
            } else {
                wifiStatus.className = 'disconnected';
                wifiStatus.innerHTML = '<i class="fa-solid fa-wifi"></i> Déconnecté';
                addDefect('Connexion Wi-Fi perdue', 'warning');
            }
        }, 20000); // Check every 20 seconds
    }

    // Start simulations
    monitorBattery();
    monitorDistance();
    simulateSensors();
    simulatePing();

    // For demonstration purposes, let's add some random defects occasionally
    setInterval(() => {
        if (Math.random() > 0.7) {
            const defects = [
                {message: 'Moteur gauche bloqué', level: 'critical'},
                {message: 'Capteur de proximité défaillant', level: 'warning'},
                {message: 'Distance limite dépassée', level: 'warning'},
                {message: 'Surchauffe détectée', level: 'critical'}
            ];
            
            const randomDefect = defects[Math.floor(Math.random() * defects.length)];
            addDefect(randomDefect.message, randomDefect.level);
        }
    }, 60000); // Check every minute
});
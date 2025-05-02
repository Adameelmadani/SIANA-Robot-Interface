document.addEventListener('DOMContentLoaded', () => {
    // WebSocket connection
    let socket = null;
    
    // Connect to server
    function connectWebSocket() {
        // Use the location of the current page to determine WebSocket URL
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/robot`;
        
        console.log(`Connecting to WebSocket at ${wsUrl}`);
        socket = new WebSocket(wsUrl);
        
        socket.onopen = () => {
            console.log('WebSocket connection established');
            document.getElementById('wifi-status').className = 'connected';
            document.getElementById('wifi-status').innerHTML = '<i class="fa-solid fa-wifi"></i> Connecté';
        };
        
        socket.onclose = () => {
            console.log('WebSocket connection closed');
            document.getElementById('wifi-status').className = 'disconnected';
            document.getElementById('wifi-status').innerHTML = '<i class="fa-solid fa-wifi"></i> Déconnecté';
            
            // Try to reconnect after a delay
            setTimeout(connectWebSocket, 5000);
        };
        
        socket.onerror = (error) => {
            console.error('WebSocket error:', error);
            addDefect('Erreur de connexion WebSocket', 'critical');
        };
        
        socket.onmessage = (event) => {
            console.log('Message from server:', event.data);
            // Handle incoming messages if needed
        };
    }
    
    // Connect on page load
    connectWebSocket();

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

    // Updated controlRobot function to use WebSockets
    function controlRobot(direction, isActive) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            console.log(`Sending robot command: ${direction} - ${isActive}`);
            
            const message = {
                type: 'control',
                direction: direction,
                isActive: isActive
            };
            
            socket.send(JSON.stringify(message));
            logOperation(`Mouvement`, `Direction: ${direction}`);
        } else {
            console.error('WebSocket is not connected');
            addDefect('Commande non envoyée: WebSocket déconnecté', 'critical');
        }
    }

    // Robot start/stop
    const startBtn = document.getElementById('start-btn');
    const stopBtn = document.getElementById('stop-btn');
    
    startBtn.addEventListener('click', () => {
        console.log('Robot started');
        logOperation('Démarrage', 'Robot initialisé');
        
        // Ensure WebSocket is connected
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            connectWebSocket();
        }
        
        // Send start command via WebSocket
        if (socket && socket.readyState === WebSocket.OPEN) {
            const message = {
                type: 'command',
                action: 'start'
            };
            socket.send(JSON.stringify(message));
        }
    });
    
    stopBtn.addEventListener('click', () => {
        console.log('Robot stopped');
        logOperation('Arrêt', 'Robot arrêté');
        
        // Send stop command via WebSocket
        if (socket && socket.readyState === WebSocket.OPEN) {
            const message = {
                type: 'command',
                action: 'stop'
            };
            socket.send(JSON.stringify(message));
        }
        
        // Disconnect WebSocket
        if (socket) {
            socket.close();
        }
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
                
                // Fix: :contains is jQuery selector, not native JavaScript
                // Check if we already have a battery-related defect
                const batteryDefects = Array.from(document.querySelectorAll('.defect')).some(
                    el => el.textContent.includes('Batterie')
                );
                
                if (batteryLevel < 15 && !batteryDefects) {
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

    // Instead of simulating ping, use real WebSocket connection status
    function monitorWebSocketConnection() {
        setInterval(() => {
            if (!socket || socket.readyState !== WebSocket.OPEN) {
                // WebSocket is not connected, try to reconnect
                if (!socket || socket.readyState === WebSocket.CLOSED) {
                    connectWebSocket();
                }
            }
        }, 10000); // Check every 10 seconds
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

    // Start simulations
    monitorBattery();
    monitorDistance();
    simulateSensors();
    monitorWebSocketConnection();

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

    // Image upload handling
    const uploadArea = document.getElementById('upload-area');
    const imageInput = document.getElementById('image-input');
    const processImageBtn = document.getElementById('process-image-btn');
    const imageUploadForm = document.getElementById('image-upload-form');
    const resultContainer = document.getElementById('result-container');
    const resultImage = document.getElementById('result-image');
    const newImageBtn = document.getElementById('new-image-btn');

    // Click on upload area to trigger file input
    uploadArea.addEventListener('click', () => {
        imageInput.click();
    });

    // Drag and drop functionality
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        // Fix: var() is a CSS function, not JavaScript
        uploadArea.style.borderColor = 'var(--primary-color)';
        uploadArea.style.backgroundColor = 'rgba(52, 152, 219, 0.3)';
    });

    uploadArea.addEventListener('dragleave', () => {
        // Fix: var() is a CSS function, not JavaScript
        uploadArea.style.borderColor = 'var(--secondary-color)';
        uploadArea.style.backgroundColor = 'rgba(52, 152, 219, 0.1)';
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = 'var(--secondary-color)';
        uploadArea.style.backgroundColor = 'rgba(52, 152, 219, 0.1)';
        
        if (e.dataTransfer.files.length) {
            imageInput.files = e.dataTransfer.files;
            handleFileSelect();
        }
    });

    // File selection handler
    imageInput.addEventListener('change', handleFileSelect);

    function handleFileSelect() {
        if (imageInput.files.length > 0) {
            const file = imageInput.files[0];
            
            // Check if the file is an image
            if (!file.type.match('image.*')) {
                alert('Veuillez sélectionner une image valide.');
                return;
            }
            
            // Preview the image in the upload area
            const reader = new FileReader();
            reader.onload = (e) => {
                uploadArea.innerHTML = `
                    <img src="${e.target.result}" style="max-width: 100%; max-height: 280px; object-fit: contain;">
                `;
            };
            reader.readAsDataURL(file);
            
            // Enable the process button
            processImageBtn.disabled = false;
        }
    }

    // Form submission handler
    imageUploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (!imageInput.files.length) return;
        
        const formData = new FormData();
        formData.append('image', imageInput.files[0]);
        
        // Show loading state
        processImageBtn.disabled = true;
        processImageBtn.textContent = 'Analyse en cours...';
        
        try {
            // Use the correct backend URL - modify this to match your Node.js backend location
            const backendUrl = 'http://localhost:3000';
            console.log('Sending request to:', `${backendUrl}/api/process-image`);
            
            // Create an AbortController for timeout functionality
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 seconds timeout
            
            // Add progress indicator
            let dots = '';
            let progressInterval = setInterval(() => {
                dots = dots.length < 3 ? dots + '.' : '';
                processImageBtn.textContent = `Analyse en cours${dots}`;
            }, 500);
            
            try {
                const response = await fetch(`${backendUrl}/api/process-image`, {
                    method: 'POST',
                    body: formData,
                    signal: controller.signal
                });
                
                // Clear the timeout since the request completed
                clearTimeout(timeoutId);
                clearInterval(progressInterval);
                
                console.log('Response status:', response.status);
                
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('Server response:', errorText);
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                
                // Safely parse JSON response
                let data;
                try {
                    data = await response.json();
                    console.log('Data received successfully');
                } catch (jsonError) {
                    console.error('JSON parsing error:', jsonError);
                    throw new Error('Failed to parse server response');
                }
                
                if (!data || !data.processedImage) {
                    console.error('Invalid data received:', data);
                    throw new Error('Invalid data received from server');
                }
                
                console.log('Displaying processed image');
                // Show the result
                resultImage.src = `data:image/jpeg;base64,${data.processedImage}`;
                imageUploadForm.style.display = 'none';
                resultContainer.style.display = 'block';
                
                // Log the operation
                logOperation('Analyse d\'image', 'Image traitée avec succès');
                
            } catch (fetchError) {
                clearInterval(progressInterval);
                if (fetchError.name === 'AbortError') {
                    console.error('Request timed out after 30 seconds');
                    throw new Error('Le traitement de l\'image a pris trop de temps (30 secondes). Veuillez réessayer.');
                }
                throw fetchError;
            }
            
        } catch (error) {
            console.error('Error processing image:', error);
            alert(`Erreur lors du traitement de l'image: ${error.message}`);
            
            // Log the error
            addDefect('Échec du traitement d\'image', 'critical');
        } finally {
            // Reset button state
            processImageBtn.disabled = false;
            processImageBtn.textContent = 'Analyser l\'image';
        }
    });

    // New image button handler
    newImageBtn.addEventListener('click', () => {
        // Reset the form
        imageUploadForm.reset();
        uploadArea.innerHTML = `
            <i class="fa-solid fa-cloud-arrow-up"></i>
            <p>Glissez une image ou cliquez pour choisir</p>
            <input type="file" id="image-input" accept="image/*" hidden>
        `;
        imageInput.value = '';
        processImageBtn.disabled = true;
        
        // Switch views
        resultContainer.style.display = 'none';
        imageUploadForm.style.display = 'block';
    });

    // Mode selection for detection
    const imageModeRadio = document.getElementById('image-mode');
    const realtimeModeRadio = document.getElementById('realtime-mode');
    const imageDetectionContainer = document.getElementById('image-detection-container');
    const realtimeDetectionContainer = document.getElementById('realtime-detection-container');

    imageModeRadio.addEventListener('change', function() {
        if (this.checked) {
            imageDetectionContainer.style.display = 'block';
            realtimeDetectionContainer.style.display = 'none';
        }
    });

    realtimeModeRadio.addEventListener('change', function() {
        if (this.checked) {
            imageDetectionContainer.style.display = 'none';
            realtimeDetectionContainer.style.display = 'block';
        }
    });
});
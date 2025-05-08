document.addEventListener('DOMContentLoaded', () => {
    // WebSocket connection
    let socket = null;
    
    // Connect to server
    function connectWebSocket() {
        // Use the location of the current page to determine WebSocket URL
        const wsUrl = `ws://192.168.12.1:3000/robot`;

        console.log(`Connecting to WebSocket at ${wsUrl}`);
        socket = new WebSocket(wsUrl);
        
        socket.onopen = () => {
            console.log('WebSocket connection established');
            document.getElementById('wifi-status').className = 'connected';
            document.getElementById('wifi-status').innerHTML = '<i class="fa-solid fa-wifi"></i> Connecté';
            
            // Request camera stream
            requestCameraStream();
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
            try {
                const message = JSON.parse(event.data);
                
                // Handle camera frame data
                if (message.type === 'camera_frame') {
                    updateCameraFrame(message.data);
                }
                
                // Handle stream status updates
                if (message.type === 'stream_status') {
                    updateStreamStatus(message.connected);
                }
                
                // Handle other messages as before
                console.log('Message from server:', message);
            } catch (e) {
                console.error('Error parsing message from server:', e);
            }
        };
    }
    
    // Request camera stream from server
    function requestCameraStream() {
        if (socket && socket.readyState === WebSocket.OPEN) {
            console.log('Requesting camera stream via WebSocket');
            socket.send(JSON.stringify({
                type: 'stream_request'
            }));
        }
    }
    
    // Update camera frame with received data
    function updateCameraFrame(base64Data) {
        const img = document.getElementById('camera-stream');
        if (img) {
            img.src = `data:image/jpeg;base64,${base64Data}`;
        }
    }
    
    // Update stream status in UI
    function updateStreamStatus(connected) {
        const cameraStream = document.getElementById('camera-stream');
        const streamStatus = document.getElementById('stream-status');
        
        if (streamStatus) {
            if (connected) {
                streamStatus.textContent = 'Flux vidéo actif';
                streamStatus.className = 'stream-status connected';
                cameraStream.style.opacity = '1';
            } else {
                streamStatus.textContent = 'Flux vidéo déconnecté';
                streamStatus.className = 'stream-status disconnected';
                cameraStream.style.opacity = '0.5';
            }
        }
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

    // Servo motor control buttons
    const servoButtons = document.querySelectorAll('.servo-btn');
    
    servoButtons.forEach(button => {
        button.addEventListener('mousedown', () => {
            const [servoPrefix, direction] = button.id.split('-');
            const motorId = parseInt(servoPrefix.replace('servo', ''));
            controlServo(motorId, direction, true);
        });
        
        button.addEventListener('mouseup', () => {
            const [servoPrefix, direction] = button.id.split('-');
            const motorId = parseInt(servoPrefix.replace('servo', ''));
            controlServo(motorId, direction, false);
        });
        
        button.addEventListener('mouseleave', () => {
            const [servoPrefix, direction] = button.id.split('-');
            const motorId = parseInt(servoPrefix.replace('servo', ''));
            controlServo(motorId, direction, false);
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
    
    // Function to control servo motors
    function controlServo(motorId, value, isActive) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            console.log(`Sending servo command: Motor ${motorId}, Direction: ${value}, Active: ${isActive}`);
            
            const message = {
                type: 'servo',
                motor_id: motorId,
                value: value,
                is_active: isActive
            };
            
            socket.send(JSON.stringify(message));
            logOperation(`Servo ${motorId}`, `Direction: ${value}`);
        } else {
            console.error('WebSocket is not connected');
            addDefect('Commande servo non envoyée: WebSocket déconnecté', 'critical');
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
            const backendUrl = 'http://192.168.12.1:3000';
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

    // Detection Canvas Setup
    const cameraStream = document.getElementById('camera-stream');
    const detectionOverlay = document.getElementById('detection-overlay');
    const toggleDetectionBtn = document.getElementById('toggle-detection');
    const createAnnotationBtn = document.getElementById('create-annotation');
    const manualAnnotationPanel = document.getElementById('manual-annotation-panel');
    const annotationForm = document.getElementById('annotation-form');
    const cancelAnnotationBtn = document.getElementById('cancel-annotation');
    
    // Context for drawing on canvas
    const ctx = detectionOverlay ? detectionOverlay.getContext('2d') : null;
    
    // Detection state
    let isDetectionActive = false;
    let isAnnotationMode = false;
    let currentAnnotation = null;
    let isDrawing = false;
    let startX, startY;
    
    // Update canvas dimensions to match the image
    function updateCanvasDimensions() {
        if (cameraStream && cameraStream.complete && detectionOverlay) {
            detectionOverlay.width = cameraStream.clientWidth;
            detectionOverlay.height = cameraStream.clientHeight;
        }
    }
    
    // When camera stream loads or window resizes, update dimensions
    if (cameraStream) {
        cameraStream.addEventListener('load', updateCanvasDimensions);
        window.addEventListener('resize', updateCanvasDimensions);
        
        // Ensure initial dimensions are set
        setTimeout(updateCanvasDimensions, 100);
    }

    // Toggle detection mode
    if (toggleDetectionBtn) {
        toggleDetectionBtn.addEventListener('click', () => {
            isDetectionActive = !isDetectionActive;
            
            if (isDetectionActive) {
                toggleDetectionBtn.innerHTML = '<i class="fa-solid fa-stop"></i> Désactiver la détection';
                toggleDetectionBtn.classList.remove('success');
                toggleDetectionBtn.classList.add('danger');
                startDetection();
                logOperation('Détection', 'Détection d\'objets activée');
            } else {
                toggleDetectionBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Activer la détection';
                toggleDetectionBtn.classList.remove('danger');
                toggleDetectionBtn.classList.add('success');
                stopDetection();
                logOperation('Détection', 'Détection d\'objets désactivée');
            }
        });
    }

    // Detection interval reference
    let detectionInterval = null;
    
    // Start detection
    function startDetection() {
        if (!ctx) return;

        // Clear any existing interval
        if (detectionInterval) {
            clearInterval(detectionInterval);
        }
        
        // Start the detection loop
        detectionInterval = setInterval(detectDefectsInCurrentFrame, 2000); // Every 2 seconds
        
        // Run detection immediately
        detectDefectsInCurrentFrame();
    }
    
    // Stop detection
    function stopDetection() {
        if (!ctx) return;

        if (detectionInterval) {
            clearInterval(detectionInterval);
            detectionInterval = null;
        }
        
        // Clear the canvas
        ctx.clearRect(0, 0, detectionOverlay.width, detectionOverlay.height);
    }
    
    // Process the current frame with the AI model
    function detectDefectsInCurrentFrame() {
        if (!cameraStream || !cameraStream.complete || cameraStream.naturalWidth === 0) {
            console.log('Camera stream not ready yet');
            return;
        }
        
        // Create a canvas to get the current frame
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = cameraStream.clientWidth;
        tempCanvas.height = cameraStream.clientHeight;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(cameraStream, 0, 0, tempCanvas.width, tempCanvas.height);
        
        // Get the data URL and remove the prefix
        const dataUrl = tempCanvas.toDataURL('image/jpeg', 0.8);
        const base64Data = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
        
        // Send to server for processing
        fetch('/api/detect-defects', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ image: base64Data })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`Detection failed with status ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                // Clear previous detections
                ctx.clearRect(0, 0, detectionOverlay.width, detectionOverlay.height);
                
                // Draw the bounding boxes
                drawDetections(data.detections);
                
                // Log if defects were found
                if (data.detections.length > 0) {
                    logOperation('Détection', `${data.detections.length} défaut(s) détecté(s)`);
                    
                    // Add defects to the defects panel
                    data.detections.forEach(detection => {
                        addDefect(`Défaut détecté: ${detection.defect_type} (${Math.round(detection.confidence * 100)}%)`, 
                                 detection.confidence > 0.7 ? 'critical' : 'warning');
                    });
                }
            } else {
                console.error('Detection error:', data.error);
            }
        })
        .catch(error => {
            console.error('Error detecting defects:', error);
            addDefect('Erreur de détection d\'objets', 'critical');
        });
    }
    
    // Draw detection boxes on the canvas
    function drawDetections(detections) {
        if (!ctx) return;
        
        detections.forEach(detection => {
            // Scale coordinates based on canvas dimensions vs original image
            const scaleX = detectionOverlay.width / cameraStream.naturalWidth;
            const scaleY = detectionOverlay.height / cameraStream.naturalHeight;
            
            const x1 = detection.x1 * scaleX;
            const y1 = detection.y1 * scaleY;
            const width = (detection.x2 - detection.x1) * scaleX;
            const height = (detection.y2 - detection.y1) * scaleY;
            
            // Draw rectangle
            ctx.strokeStyle = '#3498db';
            ctx.lineWidth = 2;
            ctx.strokeRect(x1, y1, width, height);
            
            // Draw semi-transparent fill
            ctx.fillStyle = 'rgba(52, 152, 219, 0.2)';
            ctx.fillRect(x1, y1, width, height);
            
            // Draw label
            ctx.fillStyle = '#3498db';
            ctx.fillRect(x1, y1 - 20, 100, 20);
            ctx.fillStyle = 'white';
            ctx.font = '12px Arial';
            ctx.fillText(`${detection.defect_type} ${Math.round(detection.confidence * 100)}%`, x1 + 5, y1 - 5);
        });
    }
    
    // Toggle manual annotation mode
    if (createAnnotationBtn) {
        createAnnotationBtn.addEventListener('click', () => {
            if (!isAnnotationMode) {
                startAnnotationMode();
            } else {
                stopAnnotationMode();
            }
        });
    }
    
    // Start annotation mode
    function startAnnotationMode() {
        if (!ctx) return;
        
        isAnnotationMode = true;
        createAnnotationBtn.innerHTML = '<i class="fa-solid fa-xmark"></i> Annuler l\'annotation';
        createAnnotationBtn.classList.add('danger');
        document.querySelector('.canvas-container').classList.add('annotation-mode');
        
        // Stop detection if it's running
        if (isDetectionActive) {
            toggleDetectionBtn.click();
        }
        
        // Clear canvas
        ctx.clearRect(0, 0, detectionOverlay.width, detectionOverlay.height);
        
        logOperation('Annotation', 'Mode annotation manuelle activé');
    }
    
    // Stop annotation mode
    function stopAnnotationMode() {
        if (!ctx) return;
        
        isAnnotationMode = false;
        createAnnotationBtn.innerHTML = '<i class="fa-solid fa-draw-polygon"></i> Annotation manuelle';
        createAnnotationBtn.classList.remove('danger');
        document.querySelector('.canvas-container').classList.remove('annotation-mode');
        manualAnnotationPanel.style.display = 'none';
        
        // Clear canvas
        ctx.clearRect(0, 0, detectionOverlay.width, detectionOverlay.height);
        
        // Reset current annotation
        currentAnnotation = null;
        
        logOperation('Annotation', 'Mode annotation manuelle désactivé');
    }
    
    // Handle mouse down event for drawing annotation
    if (detectionOverlay) {
        detectionOverlay.addEventListener('mousedown', (e) => {
            if (!isAnnotationMode) return;
            
            isDrawing = true;
            
            const rect = detectionOverlay.getBoundingClientRect();
            startX = e.clientX - rect.left;
            startY = e.clientY - rect.top;
            
            // Clear previous annotation
            ctx.clearRect(0, 0, detectionOverlay.width, detectionOverlay.height);
        });
        
        // Handle mouse move event for drawing annotation
        detectionOverlay.addEventListener('mousemove', (e) => {
            if (!isAnnotationMode || !isDrawing) return;
            
            const rect = detectionOverlay.getBoundingClientRect();
            const currentX = e.clientX - rect.left;
            const currentY = e.clientY - rect.top;
            
            // Clear previous drawing
            ctx.clearRect(0, 0, detectionOverlay.width, detectionOverlay.height);
            
            // Draw the rectangle
            const width = currentX - startX;
            const height = currentY - startY;
            
            ctx.strokeStyle = '#e74c3c';
            ctx.lineWidth = 2;
            ctx.strokeRect(startX, startY, width, height);
            
            // Draw semi-transparent fill
            ctx.fillStyle = 'rgba(231, 76, 60, 0.2)';
            ctx.fillRect(startX, startY, width, height);
        });
        
        // Handle mouse up event for drawing annotation
        detectionOverlay.addEventListener('mouseup', (e) => {
            if (!isAnnotationMode || !isDrawing) return;
            
            isDrawing = false;
            
            const rect = detectionOverlay.getBoundingClientRect();
            const endX = e.clientX - rect.left;
            const endY = e.clientY - rect.top;
            
            // Create the annotation object
            currentAnnotation = {
                x1: Math.min(startX, endX),
                y1: Math.min(startY, endY),
                x2: Math.max(startX, endX),
                y2: Math.max(startY, endY),
                width: Math.abs(endX - startX),
                height: Math.abs(endY - startY)
            };
            
            // Show the annotation form
            manualAnnotationPanel.style.display = 'block';
        });
    }
    
    // Cancel annotation button
    if (cancelAnnotationBtn) {
        cancelAnnotationBtn.addEventListener('click', () => {
            manualAnnotationPanel.style.display = 'none';
            ctx.clearRect(0, 0, detectionOverlay.width, detectionOverlay.height);
            currentAnnotation = null;
        });
    }
    
    // Handle annotation form submission
    if (annotationForm) {
        annotationForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            if (!currentAnnotation) {
                alert('Veuillez dessiner une zone sur l\'image d\'abord.');
                return;
            }
            
            // Get form data
            const defectType = document.getElementById('defect-type').value;
            const defectSeverity = document.getElementById('defect-severity').value;
            const defectNotes = document.getElementById('defect-notes').value;
            
            // Create a canvas to get the current frame
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = cameraStream.clientWidth;
            tempCanvas.height = cameraStream.clientHeight;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(cameraStream, 0, 0, tempCanvas.width, tempCanvas.height);
            
            // Get the data URL and remove the prefix
            const dataUrl = tempCanvas.toDataURL('image/jpeg', 0.8);
            const base64Data = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
            
            // Add more information to the annotation
            const completeAnnotation = {
                ...currentAnnotation,
                defect_type: defectType,
                severity: defectSeverity,
                notes: defectNotes,
                timestamp: new Date().toISOString(),
                created_by: "Operator" // Could be replaced with actual user info
            };
            
            // Send to server for processing
            fetch('/api/save-annotation', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    image: base64Data,
                    annotation: completeAnnotation 
                })
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Save failed with status ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (data.success) {
                    logOperation('Annotation', `Défaut "${defectType}" de sévérité "${defectSeverity}" enregistré`);
                    
                    // Also add to defects panel
                    const severityClass = defectSeverity === 'critical' || defectSeverity === 'high' ? 'critical' : 'warning';
                    addDefect(`Défaut annoté: ${defectType} (${defectSeverity})`, severityClass);
                    
                    // Reset form and hide panel
                    annotationForm.reset();
                    manualAnnotationPanel.style.display = 'none';
                    
                    // Clear canvas
                    ctx.clearRect(0, 0, detectionOverlay.width, detectionOverlay.height);
                    
                    // Reset current annotation
                    currentAnnotation = null;
                    
                    // Exit annotation mode
                    stopAnnotationMode();
                    
                    // Show success message
                    alert('Annotation enregistrée avec succès.');
                } else {
                    console.error('Save error:', data.error);
                    alert(`Erreur lors de l'enregistrement: ${data.error}`);
                }
            })
            .catch(error => {
                console.error('Error saving annotation:', error);
                alert(`Erreur lors de l'enregistrement: ${error.message}`);
                addDefect('Erreur d\'enregistrement d\'annotation', 'critical');
            });
        });
    }

    // When mode is set to realtime
    if (realtimeModeRadio) {
        realtimeModeRadio.addEventListener('change', function() {
            if (this.checked) {
                imageDetectionContainer.style.display = 'none';
                realtimeDetectionContainer.style.display = 'block';
                
                // Make sure canvas is properly sized
                setTimeout(updateCanvasDimensions, 100);
                
                // Stop detection if it was running (in case user switches between modes)
                if (isDetectionActive && toggleDetectionBtn) {
                    isDetectionActive = false;
                    toggleDetectionBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Activer la détection';
                    toggleDetectionBtn.classList.remove('danger');
                    toggleDetectionBtn.classList.add('success');
                    stopDetection();
                }
                
                // Exit annotation mode if active
                if (isAnnotationMode) {
                    stopAnnotationMode();
                }
            }
        });
    }

    // Clean up on page unload
    window.addEventListener('beforeunload', () => {
        if (detectionInterval) {
            clearInterval(detectionInterval);
        }
    });
});
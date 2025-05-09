document.addEventListener('DOMContentLoaded', () => {
    // WebSocket connection
    let socket = null;

    // Connect to server
    function connectWebSocket() {
        // Use the location of the current page to determine WebSocket URL
        const wsUrl = `ws://192.168.12.1:3000/robot`; // Assurez-vous que c'est la bonne IP/port

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
            updateStreamStatus(false); // Also update stream status on close

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

                if (message.type === 'camera_frame') {
                    updateCameraFrame(message.data);
                } else if (message.type === 'stream_status') {
                    updateStreamStatus(message.connected);
                } else if (message.type === 'detection_frame') {
                    updateDetectionFrame(message.data);
                } else if (message.type === 'detection_status') {
                    updateDetectionStatus(message.enabled, message.mode);
                } else if (message.type === 'automatic_status') {
                    const autonomousBtn = document.getElementById('autonomous-mode-btn');
                    if (autonomousBtn) {
                        if (message.enabled) {
                            autonomousBtn.classList.add('active');
                            autonomousBtn.innerHTML = '<i class="fa-solid fa-robot"></i> Mode Autonome (Activé)';
                        } else {
                            autonomousBtn.classList.remove('active');
                            autonomousBtn.innerHTML = '<i class="fa-solid fa-robot"></i> Mode Autonome';
                        }
                    }
                } else {
                    console.log('Message from server:', message);
                }
            } catch (e) {
                console.error('Error parsing message from server:', e);
            }
        };
    }

    function requestCameraStream() {
        if (socket && socket.readyState === WebSocket.OPEN) {
            console.log('Requesting camera stream via WebSocket');
            socket.send(JSON.stringify({ type: 'stream_request' }));
        }
    }

    function updateCameraFrame(base64Data) {
        const img = document.getElementById('camera-stream');
        if (img) {
            img.src = `data:image/jpeg;base64,${base64Data}`;
        }
    }

    function updateDetectionFrame(base64Data) {
        const img = document.getElementById('detection-result');
        const resultContainer = document.getElementById('detection-result-container');
        const loadingContainer = document.getElementById('detection-loading-container');
        const viewWrapper = document.getElementById('realtime-view-wrapper');

        if (img && resultContainer && loadingContainer && viewWrapper) {
            img.src = `data:image/jpeg;base64,${base64Data}`;
            resultContainer.style.display = 'flex';
            loadingContainer.style.display = 'none';
            viewWrapper.classList.add('split-view');
        }
    }

    function updateStreamStatus(connected) {
        const cameraStream = document.getElementById('camera-stream');
        const streamStatus = document.getElementById('stream-status');

        if (streamStatus && cameraStream) {
            if (connected) {
                streamStatus.textContent = 'Flux vidéo actif';
                streamStatus.className = 'stream-status connected';
                cameraStream.style.opacity = '1';
            } else {
                streamStatus.textContent = 'Flux vidéo déconnecté';
                streamStatus.className = 'stream-status disconnected';
                cameraStream.style.opacity = '0.5';
                const detectionStatusEl = document.getElementById('detection-status');
                if (detectionStatusEl) {
                    detectionStatusEl.textContent = 'Détection d\'objets inactive';
                    detectionStatusEl.className = 'detection-status inactive';
                }
                const detectionResultContainer = document.getElementById('detection-result-container');
                if (detectionResultContainer) detectionResultContainer.style.display = 'none';
                const viewWrapper = document.getElementById('realtime-view-wrapper');
                if (viewWrapper) viewWrapper.classList.remove('split-view');
            }
        }
    }

    function updateDetectionStatus(enabled, mode) {
        const status = document.getElementById('detection-status');
        const toggleBtn = document.getElementById('toggle-detection-btn');
        const loadingContainer = document.getElementById('detection-loading-container');
        const resultContainer = document.getElementById('detection-result-container');
        const viewWrapper = document.getElementById('realtime-view-wrapper');

        if (status) {
            status.textContent = enabled ? 'Détection d\'objets active' : 'Détection d\'objets inactive';
            status.className = enabled ? 'detection-status active' : 'detection-status inactive';
        }
        if (toggleBtn) {
            if (enabled) {
                toggleBtn.classList.add('active');
                toggleBtn.innerHTML = '<i class="fa-solid fa-video-slash"></i> Désactiver Détection';
            } else {
                toggleBtn.classList.remove('active');
                toggleBtn.innerHTML = '<i class="fa-solid fa-video"></i> Activer Détection';
                if (loadingContainer) loadingContainer.style.display = 'none';
                if (resultContainer) resultContainer.style.display = 'none';
                if (viewWrapper) viewWrapper.classList.remove('split-view');
            }
        }
    }

    connectWebSocket();

    const directionButtons = document.querySelectorAll('.direction-btn');
    directionButtons.forEach(button => {
        let pressTimer = null;
        const direction = button.id;

        const startAction = () => {
            controlRobot(direction, true);
            button.classList.add('active-direction');
        };
        const stopAction = () => {
            controlRobot(direction, false);
            button.classList.remove('active-direction');
        };

        button.addEventListener('mousedown', startAction);
        button.addEventListener('mouseup', stopAction);
        button.addEventListener('mouseleave', () => {
             if (button.classList.contains('active-direction')) stopAction();
        });
        button.addEventListener('touchstart', (e) => { e.preventDefault(); startAction(); }, { passive: false });
        button.addEventListener('touchend', (e) => { e.preventDefault(); stopAction(); });
    });

    const servoButtons = document.querySelectorAll('.servo-btn');
    servoButtons.forEach(button => {
        const [servoPrefix, direction] = button.id.split('-');
        const motorId = parseInt(servoPrefix.replace('servo', ''));

        const startAction = () => controlServo(motorId, direction, true);
        const stopAction = () => controlServo(motorId, direction, false);

        button.addEventListener('mousedown', startAction);
        button.addEventListener('mouseup', stopAction);
        // button.addEventListener('mouseleave', stopAction); // Décommentez si vous voulez arrêter en quittant le bouton
        button.addEventListener('touchstart', (e) => { e.preventDefault(); startAction(); }, { passive: false });
        button.addEventListener('touchend', (e) => { e.preventDefault(); stopAction(); });
    });

    const servo3Slider = document.getElementById('servo3-slider');
    const servo3ValueDisplay = document.getElementById('servo3-value');
    if (servo3Slider && servo3ValueDisplay) {
        servo3Slider.addEventListener('input', () => {
            const angle = servo3Slider.value;
            servo3ValueDisplay.textContent = `${angle}°`;
            controlServo(3, parseInt(angle), null); 
        });
    }

    function controlRobot(direction, isActive) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            const message = { type: 'control', direction: direction, isActive: isActive };
            socket.send(JSON.stringify(message));
            logOperation(`Mouvement ${direction}`, isActive ? 'Activé' : 'Stoppé');
        } else {
            addDefect('Commande Robot non envoyée', 'critical');
        }
    }

    function controlServo(motorId, value, isActive) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            let message;
            if (motorId === 3) {
                message = { type: 'servo', motor_id: motorId, direction: parseInt(value) };
                console.log(`Sending servo 3 command: Motor ${motorId}, Angle (direction): ${value}`);
                logOperation(`Servo ${motorId}`, `Position réglée à ${value}°`);
            } else {
                message = { type: 'servo', motor_id: motorId, value: value, is_active: isActive };
                console.log(`Sending servo ${motorId} command: Motor ${motorId}, Value: ${value}, Active: ${isActive}`);
                logOperation(`Servo ${motorId} (${value})`, isActive ? 'Activé' : 'Stoppé');
            }
            socket.send(JSON.stringify(message));
        } else {
            addDefect(`Commande Servo ${motorId} non envoyée`, 'critical');
        }
    }

    const autonomousModeBtn = document.getElementById('autonomous-mode-btn');
    if (autonomousModeBtn) {
        autonomousModeBtn.addEventListener('click', () => {
            const newActiveState = !autonomousModeBtn.classList.contains('active');
            if (socket && socket.readyState === WebSocket.OPEN) {
                const message = { type: 'automatic', enabled: newActiveState };
                socket.send(JSON.stringify(message));
                console.log(`Sending automatic mode command: ${JSON.stringify(message)}`);
                
                // Visually update button state immediately
                if (newActiveState) {
                    autonomousModeBtn.classList.add('active');
                    autonomousModeBtn.innerHTML = '<i class="fa-solid fa-robot"></i> Mode Autonome (Activé)';
                } else {
                    autonomousModeBtn.classList.remove('active');
                    autonomousModeBtn.innerHTML = '<i class="fa-solid fa-robot"></i> Mode Autonome';
                }
                logOperation('Mode Autonome', newActiveState ? 'Activé' : 'Désactivé');
            } else {
                addDefect('Commande Mode Autonome non envoyée', 'critical');
            }
        });
    }

    function logOperation(event, details) {
        const now = new Date();
        const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
        const historyTableBody = document.getElementById('operations-history')?.getElementsByTagName('tbody')[0];
        if (!historyTableBody) return;

        const newRow = historyTableBody.insertRow(0);
        newRow.insertCell(0).textContent = time;
        newRow.insertCell(1).textContent = event;
        newRow.insertCell(2).textContent = details;
        if (historyTableBody.rows.length > 50) {
            historyTableBody.deleteRow(historyTableBody.rows.length - 1);
        }
    }

    function addDefect(message, level) {
        const defectsList = document.getElementById('defects-list');
        if (!defectsList) return;

        if (Array.from(defectsList.querySelectorAll('li')).some(li => li.textContent.includes(message))) return;

        const defect = document.createElement('li');
        defect.className = `defect ${level}`;
        const iconClass = level === 'warning' ? 'fa-exclamation-triangle' : 'fa-times-circle';
        defect.innerHTML = `<i class="fa-solid ${iconClass}"></i> ${message}`;
        defectsList.prepend(defect);
        if (defectsList.children.length > 10) {
            defectsList.removeChild(defectsList.lastChild);
        }
        logOperation('Défaut', message);
    }

    function simulateSensors() {
        const luminosityValueEl = document.getElementById('luminosity-value');
        if (luminosityValueEl) {
            setInterval(() => {
                const luminosity = Math.floor(70 + Math.random() * 30);
                luminosityValueEl.textContent = `${luminosity}%`;
                if (luminosity < 30) addDefect('Luminosité très faible', 'warning');
            }, 15000);
        }
    }

    simulateSensors();
    // monitorWebSocketConnection(); // Reconnection is handled by socket.onclose

    setInterval(() => { // Random defects simulation
        if (Math.random() > 0.85) {
            const defects = [
                { message: 'Interférence signal Wi-Fi', level: 'warning' },
                { message: 'Moteur droit surchauffe', level: 'critical' },
                { message: 'Obstacle non identifié détecté', level: 'warning' }
            ];
            addDefect(defects[Math.floor(Math.random() * defects.length)].message, defects[Math.floor(Math.random() * defects.length)].level);
        }
    }, 45000);

    const uploadArea = document.getElementById('upload-area');
    const imageInput = document.getElementById('image-input');
    const processImageBtn = document.getElementById('process-image-btn');
    const imageUploadForm = document.getElementById('image-upload-form');
    const imageResultContainer = document.getElementById('image-result-container');
    const resultImage = document.getElementById('result-image');
    const newImageBtn = document.getElementById('new-image-btn');

    if (uploadArea && imageInput && processImageBtn && imageUploadForm && imageResultContainer && resultImage && newImageBtn) {
        uploadArea.addEventListener('click', () => imageInput.click());
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.style.borderColor = getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim();
            uploadArea.style.backgroundColor = 'rgba(44, 62, 80, 0.1)';
        });
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.style.borderColor = getComputedStyle(document.documentElement).getPropertyValue('--secondary-color').trim();
            uploadArea.style.backgroundColor = 'rgba(52, 152, 219, 0.05)';
        });
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.style.borderColor = getComputedStyle(document.documentElement).getPropertyValue('--secondary-color').trim();
            uploadArea.style.backgroundColor = 'rgba(52, 152, 219, 0.05)';
            if (e.dataTransfer.files.length) {
                imageInput.files = e.dataTransfer.files;
                handleFileSelect();
            }
        });
        imageInput.addEventListener('change', handleFileSelect);

        function handleFileSelect() {
            if (imageInput.files.length > 0) {
                const file = imageInput.files[0];
                if (!file.type.match('image.*')) { alert('Veuillez sélectionner une image valide.'); return; }
                const reader = new FileReader();
                reader.onload = (e) => {
                    uploadArea.innerHTML = `<img src="${e.target.result}" style="max-width: 100%; max-height: calc(100% - 20px); object-fit: contain;">`;
                };
                reader.readAsDataURL(file);
                processImageBtn.disabled = false;
            }
        }

        imageUploadForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!imageInput.files.length) return;
            const formData = new FormData();
            formData.append('image', imageInput.files[0]);
            processImageBtn.disabled = true;
            let dots = '';
            const progressInterval = setInterval(() => {
                dots = dots.length < 3 ? dots + '.' : '';
                processImageBtn.textContent = `Analyse en cours${dots}`;
            }, 500);
            try {
                const backendUrl = 'http://192.168.12.1:3000'; // Assurez-vous que l'URL est correcte
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 30000);
                const response = await fetch(`${backendUrl}/api/process-image`, { method: 'POST', body: formData, signal: controller.signal });
                clearTimeout(timeoutId);
                clearInterval(progressInterval);
                if (!response.ok) throw new Error(`Erreur serveur (${response.status}): ${await response.text()}`);
                const data = await response.json();
                if (!data || !data.processedImage) throw new Error('Réponse invalide du serveur');
                resultImage.src = `data:image/jpeg;base64,${data.processedImage}`;
                imageUploadForm.style.display = 'none';
                imageResultContainer.style.display = 'flex';
                logOperation('Analyse d\'image', 'Image traitée');
            } catch (error) {
                clearInterval(progressInterval);
                alert(`Erreur traitement: ${error.message}`);
                addDefect(`Échec analyse: ${error.name === 'AbortError' ? 'Timeout' : error.message.substring(0,30)}`, 'critical');
            } finally {
                processImageBtn.disabled = false;
                processImageBtn.textContent = 'Analyser l\'image';
            }
        });

        newImageBtn.addEventListener('click', () => {
            imageUploadForm.reset();
            uploadArea.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i><p>Glissez une image ou cliquez pour choisir</p>`;
            imageInput.value = '';
            processImageBtn.disabled = true;
            imageResultContainer.style.display = 'none';
            imageUploadForm.style.display = 'flex';
        });
    }

    const imageModeRadio = document.getElementById('image-mode');
    const realtimeModeRadio = document.getElementById('realtime-mode');
    const imageDetectionContainer = document.getElementById('image-detection-container');
    const realtimeDetectionContainer = document.getElementById('realtime-detection-container');
    const detectionLoadingContainer = document.getElementById('detection-loading-container');
    const detectionResultContainer = document.getElementById('detection-result-container');
    const realtimeViewWrapper = document.getElementById('realtime-view-wrapper');

    if (imageModeRadio && realtimeModeRadio && imageDetectionContainer && realtimeDetectionContainer && detectionLoadingContainer && detectionResultContainer && realtimeViewWrapper) {
        imageModeRadio.addEventListener('change', function () {
            if (this.checked) {
                imageDetectionContainer.style.display = 'flex';
                realtimeDetectionContainer.style.display = 'none';
                detectionLoadingContainer.style.display = 'none';
                detectionResultContainer.style.display = 'none';
                realtimeViewWrapper.classList.remove('split-view');
                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: 'detection_mode', enabled: false }));
                }
                const toggleBtn = document.getElementById('toggle-detection-btn');
                if (toggleBtn) {
                    toggleBtn.classList.remove('active');
                    toggleBtn.innerHTML = '<i class="fa-solid fa-video"></i> Activer Détection';
                }
                const detectionStatusEl = document.getElementById('detection-status');
                 if(detectionStatusEl) {
                    detectionStatusEl.textContent = 'Détection d\'objets inactive';
                    detectionStatusEl.className = 'detection-status inactive';
                 }
            }
        });

        realtimeModeRadio.addEventListener('change', function () {
            if (this.checked) {
                imageDetectionContainer.style.display = 'none';
                realtimeDetectionContainer.style.display = 'flex';
                detectionLoadingContainer.style.display = 'flex';
                detectionResultContainer.style.display = 'none';
                realtimeViewWrapper.classList.remove('split-view');
                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: 'stream_request' }));
                }
                logOperation('Mode Détection', 'Passage en temps réel (attente activation)');
            }
        });
    }

    const toggleDetectionBtn = document.getElementById('toggle-detection-btn');
    if (toggleDetectionBtn) {
        toggleDetectionBtn.addEventListener('click', function () {
            const enableDetection = !toggleDetectionBtn.classList.contains('active');
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'detection_mode', enabled: enableDetection }));
                updateDetectionStatus(enableDetection); // Met à jour le bouton et le statut
                if (enableDetection) {
                    if(detectionLoadingContainer) detectionLoadingContainer.style.display = 'flex';
                    if(detectionResultContainer) detectionResultContainer.style.display = 'none';
                    if(realtimeViewWrapper) realtimeViewWrapper.classList.remove('split-view');
                    logOperation('Détection Temps Réel', 'Activation demandée');
                } else {
                    logOperation('Détection Temps Réel', 'Désactivation demandée');
                }
            }
        });
    }

    window.addEventListener('beforeunload', () => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            // Optionnel: Envoyer un message pour indiquer la déconnexion du client
            // socket.send(JSON.stringify({ type: 'client_disconnect' }));
            socket.close();
        }
    });
});
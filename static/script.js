document.addEventListener('DOMContentLoaded', () => {
    // --- UI ELEMENTS ---
    const body = document.body;
    const appContainer = document.querySelector('.app-container');
    const leftSidebar = document.getElementById('leftSidebar');
    const rightSidebar = document.getElementById('rightSidebar');
    const mainChat = document.getElementById('mainChat');
    const recordButton = document.getElementById('recordButton');
    const newChatButton = document.getElementById('newChatButton');
    const validateButton = document.getElementById('validateButton');
    const initialValidateButton = document.getElementById('initialValidateButton');
    const sessionHistoryUl = document.getElementById('sessionHistory');
    const responseStatus = document.getElementById('response-status');
    const conversationDiv = document.getElementById('conversationDiv');
    const responseLoader = document.getElementById('response-loader');
    const clearKeysButton = document.getElementById('clearKeysButton');
    
    // Sidebar toggles
    const leftSidebarToggle = document.getElementById('leftSidebarToggle');
    const rightSidebarToggle = document.getElementById('rightSidebarToggle');
    const closeLSidebar = document.getElementById('closeLSidebar');
    const closeRSidebar = document.getElementById('closeRSidebar');

    // Key inputs for both initial setup and settings sidebar
    const keyInputs = {
        gemini: document.getElementById('geminiKey'),
        assembly: document.getElementById('assemblyKey'),
        murf: document.getElementById('murfKey'),
        tavily: document.getElementById('tavilyKey'),
        weather: document.getElementById('weatherKey')
    };

    const initialKeyInputs = {
        gemini: document.getElementById('initialGeminiKey'),
        assembly: document.getElementById('initialAssemblyKey'),
        murf: document.getElementById('initialMurfKey'),
        tavily: document.getElementById('initialTavilyKey'),
        weather: document.getElementById('initialWeatherKey')
    };

    const statusIcons = {
        gemini: document.getElementById('geminiStatus'),
        assembly: document.getElementById('assemblyStatus'),
        murf: document.getElementById('murfStatus'),
        tavily: document.getElementById('tavilyStatus'),
        weather: document.getElementById('weatherStatus')
    };

    const initialStatusIcons = {
        gemini: document.getElementById('initialGeminiStatus'),
        assembly: document.getElementById('initialAssemblyStatus'),
        murf: document.getElementById('initialMurfStatus'),
        tavily: document.getElementById('initialTavilyStatus'),
        weather: document.getElementById('initialWeatherStatus')
    };

    // --- STATE & AUDIO VARIABLES ---
    let socket;
    let isRecording = false;
    let sessionId;
    let apiKeys = {};
    let keysValidated = false;
    let isLeftSidebarOpen = false;
    let isRightSidebarOpen = false;
    let tempTranscriptSpan = null;
    let currentUserMessageDiv = null;

    // For recording - using faster ScriptProcessor approach
    let audioContext;
    let processor;
    let source;
    let stream;

    // For playback
    let playbackAudioContext;
    let audioQueue = [];
    let isPlaying = false;
    let currentAssistantMessageSpan = null;

    let passiveAudioContext;
    let passiveStream;
    let analyser;
    let passiveMonitoringId;
    const BARGE_IN_THRESHOLD = 80;

    const initialAudio = async () => {
        if(audioContext) return;
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 16000
            });
            console.log("AudioContext initialized successfully.");
        } catch (e) {
            console.error('Failed to initialize AudioContext:', e);
            updateUIState('error', 'Audio system failed to start.');
        }
    };
    
    // --- SIDEBAR MANAGEMENT ---
    const toggleLeftSidebar = () => {
        isLeftSidebarOpen = !isLeftSidebarOpen;
        leftSidebar.classList.toggle('open', isLeftSidebarOpen);
        leftSidebarToggle.classList.toggle('active', isLeftSidebarOpen);
        updateChatLayout();
    };

    const toggleRightSidebar = () => {
        isRightSidebarOpen = !isRightSidebarOpen;
        rightSidebar.classList.toggle('open', isRightSidebarOpen);
        rightSidebarToggle.classList.toggle('active', isRightSidebarOpen);
        updateChatLayout();
    };

    const closeLeftSidebar = () => {
        isLeftSidebarOpen = false;
        leftSidebar.classList.remove('open');
        leftSidebarToggle.classList.remove('active');
        updateChatLayout();
    };

    const closeRightSidebar = () => {
        isRightSidebarOpen = false;
        rightSidebar.classList.remove('open');
        rightSidebarToggle.classList.remove('active');
        updateChatLayout();
    };

    const updateChatLayout = () => {
        appContainer.classList.toggle('left-open', isLeftSidebarOpen);
        appContainer.classList.toggle('right-open', isRightSidebarOpen);
        appContainer.classList.toggle('both-open', isLeftSidebarOpen && isRightSidebarOpen);
    };

    // --- UI MANAGEMENT ---
    const initializeSession = async () => {
        await checkStoredKeys();
    };

    const switchToInitialView = () => {
        body.classList.add('initial-view');
        body.classList.remove('app-view');
    };

    const switchToAppView = async () => {
        const urlParams = new URLSearchParams(window.location.search);
        sessionId = urlParams.get('session_id');
        if (!sessionId) {
            sessionId = crypto.randomUUID();
            window.history.replaceState({}, '', `/?session_id=${sessionId}`);
        }
        
        body.classList.remove('initial-view');
        body.classList.add('app-view');
        
        await fetchAndDisplayHistory();
        unlockChat();
    };

    const checkStoredKeys = async () => {
        try {
            const response = await fetch('/config/keys');
            const storedKeys = await response.json();
            if (storedKeys && Object.keys(storedKeys).length > 0 && storedKeys.GEMINI_API_KEY) {
                // Populate both initial and settings forms
                Object.keys(keyInputs).forEach(key => {
                    const keyName = `${key.toUpperCase()}_API_KEY`;
                    if (keyInputs[key] && storedKeys[keyName]) {
                        keyInputs[key].value = storedKeys[keyName];
                    }
                    if (initialKeyInputs[key] && storedKeys[keyName]) {
                        initialKeyInputs[key].value = storedKeys[keyName];
                    }
                });
                await validateApiKeys();
            } else {
                switchToInitialView();
            }
        } catch (error) {
            console.error("Could not fetch stored keys:", error);
            switchToInitialView();
        }
    };

    const validateApiKeys = async (useInitialInputs = false) => {
        responseStatus.textContent = "Validating keys...";
        
        const inputsToUse = useInitialInputs ? initialKeyInputs : keyInputs;
        const iconsToUse = useInitialInputs ? initialStatusIcons : statusIcons;
        
        Object.values(iconsToUse).forEach(icon => icon.className = 'status-icon');
        
        const keysToValidate = {
            GEMINI_API_KEY: inputsToUse.gemini.value.trim(),
            ASSEMBLYAI_API_KEY: inputsToUse.assembly.value.trim(),
            MURF_API_KEY: inputsToUse.murf.value.trim(),
            TAVILY_API_KEY: inputsToUse.tavily.value.trim(),
            WEATHER_API_KEY: inputsToUse.weather.value.trim()
        };
        
        try {
            const response = await fetch('/config/keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(keysToValidate)
            });
            const results = await response.json();
            let allValid = true;
            
            for (const [key, status] of Object.entries(results)) {
                if (iconsToUse[key]) {
                    iconsToUse[key].classList.add(status);
                }
                if (status !== 'valid') allValid = false;
            }
            
            if (allValid) {
                apiKeys = keysToValidate;
                keysValidated = true;
                
                // Sync values between forms
                if (useInitialInputs) {
                    Object.keys(keyInputs).forEach(key => {
                        if (keyInputs[key] && inputsToUse[key]) {
                            keyInputs[key].value = inputsToUse[key].value;
                        }
                    });
                } else {
                    Object.keys(initialKeyInputs).forEach(key => {
                        if (initialKeyInputs[key] && inputsToUse[key]) {
                            initialKeyInputs[key].value = inputsToUse[key].value;
                        }
                    });
                }
                
                if (body.classList.contains('initial-view')) {
                    switchToAppView();
                } else {
                    unlockChat();
                    closeRightSidebar();
                }
                connectWebSocket();
            } else {
                responseStatus.textContent = "Some API keys are invalid. Please check them.";
            }
        } catch (error) {
            responseStatus.textContent = "Failed to validate keys. Check server.";
        }
    };

    const unlockChat = async () => {
        await initialAudio();
        recordButton.disabled = false;
        responseStatus.textContent = "All set! Click the button to speak.";
    };

    const fetchAndDisplayHistory = async () => {
        try {
            const response = await fetch('/history/sessions');
            const sessions = await response.json();
            sessionHistoryUl.innerHTML = '';
            sessions.forEach(session => {
                const li = document.createElement('li');
                const a = document.createElement('a');
                a.href = `/?session_id=${session.id}`;
                a.textContent = session.title || `Session ${session.id.substring(0, 8)}...`;
                a.addEventListener('click', (e) => {
                    e.preventDefault();
                    window.location.href = a.href;
                    closeLeftSidebar();
                });
                li.appendChild(a);
                sessionHistoryUl.appendChild(li);
            });
            sessionHistoryUl.scrollTop = sessionHistoryUl.scrollHeight;
        } catch (error) {
            console.error("Failed to fetch session history:", error);
        }
    };

    const updateUIState = (state, message = '') => {
        recordButton.disabled = state === 'thinking';
        responseLoader.style.display = state === 'thinking' ? 'block' : 'none';

        if (state === 'recording') {
            recordButton.classList.add('recording');
            recordButton.innerHTML = '<i class="fas fa-stop"></i>';
            responseStatus.textContent = 'Listening...';
        } else {
            recordButton.classList.remove('recording');
            recordButton.innerHTML = '<i class="fas fa-microphone"></i>';
        }

        if (message) {
            responseStatus.textContent = message;
        } else if (state === 'ready') {
            responseStatus.textContent = 'Click the button to speak.';
        } else if (state === 'playing') {
            responseStatus.textContent = 'Playing response...';
        }
    };

    const displayMessage = (role, text) => {
        if (!text) return;
        
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', role === 'user' ? 'user-message' : 'assistant-message');
        
        const strong = document.createElement('strong');
        strong.textContent = role === 'user' ? 'You: ' : 'Assistant: ';
        
        const span = document.createElement('span');
        span.textContent = text;
        
        messageElement.appendChild(strong);
        messageElement.appendChild(span);
        conversationDiv.appendChild(messageElement);
        
        conversationDiv.scrollTop = conversationDiv.scrollHeight;
    };

    // --- REAL-TIME RECORDING ---
    const startRecording = async () => {
        if (isPlaying) {
            console.log("audio playback for new recording.");
            // Immediately close the audio context to stop sound
            if (playbackAudioContext) {
                playbackAudioContext.close();
            }

            audioQueue = []; // Clear any pending audio chunks
            isPlaying = false;
                // Reset the playback state
            if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: 'interrupt' }));
            }
        }
        try {
            currentUserMessageDiv = null;
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            isRecording = true;
            updateUIState('recording');

            audioContext = new AudioContext({ sampleRate: 16000 });
            source = audioContext.createMediaStreamSource(stream);
            processor = audioContext.createScriptProcessor(4096, 1, 1);

            source.connect(processor);
            processor.connect(audioContext.destination);

            processor.onaudioprocess = (event) => {
                if (!socket || socket.readyState !== WebSocket.OPEN) return;
                const inputData = event.inputBuffer.getChannelData(0);
                const pcm16 = floatTo16BitPCM(inputData);
                socket.send(pcm16); 
            };

        } catch (error) {
            console.error("Microphone access error:", error);
            updateUIState('error', 'Microphone access denied.');
        }
    };

    const stopRecording = () => {
        isRecording = false;

        if (processor) processor.disconnect();
        if (source) source.disconnect();
        if (stream) stream.getTracks().forEach(track => track.stop());
        if (audioContext) audioContext.close();
        updateUIState('ready');
    };

    function floatTo16BitPCM(float32Array) {
        const buffer = new ArrayBuffer(float32Array.length * 2);
        const view = new DataView(buffer);
        for (let i = 0; i < float32Array.length; i++) {
            let s = Math.max(-1, Math.min(1, float32Array[i]));
            view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
        return buffer;
    }

    // --- SESSION & WEBSOCKET ---
    const connectWebSocket = () => {
        if (!keysValidated || (socket && socket.readyState === WebSocket.OPEN)) return;
        const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const wsUrl = `${wsProtocol}://${window.location.host}/ws`;
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            console.log("WebSocket connected.");
            socket.send(JSON.stringify({ session_id: sessionId , api_keys: apiKeys }));
            updateUIState('ready');
        };

        socket.onmessage = (event) => {
            const result = JSON.parse(event.data);

            switch (result.type) {
                case 'history':
                    console.log("Received existing chat history.");
                    conversationDiv.innerHTML = '';
                    result.data.forEach(message => {
                        const role = message.role;
                        const text = message.parts[0];
                        displayMessage(role, text);
                    });
                    currentAssistantMessageSpan = null;
                    currentUserMessageDiv = null;
                    tempTranscriptSpan = null;
                    break;

                case 'transcript':
                    // Handle interim and final transcripts in-place
                    if (!result.is_final) {
                        // Show interim transcript - update in place
                        if (!tempTranscriptSpan) {
                            currentUserMessageDiv = document.createElement('div');
                            currentUserMessageDiv.classList.add('message', 'user-message');
                            const strong = document.createElement('strong');
                            strong.textContent = 'You: ';
                            tempTranscriptSpan = document.createElement('span');
                            tempTranscriptSpan.style.opacity = '0.7';
                            tempTranscriptSpan.style.fontStyle = 'italic';
                            currentUserMessageDiv.appendChild(strong);
                            currentUserMessageDiv.appendChild(tempTranscriptSpan);
                            conversationDiv.appendChild(currentUserMessageDiv);
                        }
                        tempTranscriptSpan.textContent = result.transcript;
                        conversationDiv.scrollTop = conversationDiv.scrollHeight;
                    } else {
                        // Final transcript - finalize and trigger LLM immediately
                        if (tempTranscriptSpan) {
                            tempTranscriptSpan.style.opacity = '1';
                            tempTranscriptSpan.style.fontStyle = 'normal';
                            tempTranscriptSpan = null;
                            currentUserMessageDiv = null;
                        } else {
                            displayMessage('user', result.transcript);
                        }
                        stopRecording();
                        updateUIState('thinking');
                    }
                    break;

                case 'llm_response':
                    // Stream LLM response instantly
                    if (!currentAssistantMessageSpan) {
                        const messageElement = document.createElement('div');
                        messageElement.classList.add('message', 'assistant-message');
                        const strong = document.createElement('strong');
                        strong.textContent = 'Assistant: ';
                        currentAssistantMessageSpan = document.createElement('span');
                        messageElement.appendChild(strong);
                        messageElement.appendChild(currentAssistantMessageSpan);
                        conversationDiv.appendChild(messageElement);
                    }
                    currentAssistantMessageSpan.textContent += result.chunk;
                    conversationDiv.scrollTop = conversationDiv.scrollHeight;
                    break;

                case 'audio':
                    const audioChunk = base64ToArrayBuffer(result.audio_chunk);
                    audioQueue.push(audioChunk);
                    break;

                case 'llm_response_end':
                    currentAssistantMessageSpan = null;
                    updateUIState('ready');
                    if (audioQueue.length > 0) {
                        processAndPlayAudioQueue();
                    }
                    break;
            }
        };

        socket.onclose = () => {
            updateUIState('error', 'Connection lost. Reconnecting...');
            setTimeout(initializeSession, 3000);
        };
    };
    
    // --- AUDIO PLAYBOOK - Simplified ---
    async function processAndPlayAudioQueue() {
        if (isPlaying || audioQueue.length === 0) return;
        
        isPlaying = true;
        updateUIState('playing');

        const fullAudioBuffer = concatBuffers(audioQueue);
        const wavBuffer = createWavFile(fullAudioBuffer);
        audioQueue = [];

        if (!playbackAudioContext || playbackAudioContext.state === 'closed') {
            playbackAudioContext = new AudioContext({ sampleRate: 44100 });
        }

        try {
            const audioBuffer = await playbackAudioContext.decodeAudioData(wavBuffer);
            const sourceNode = playbackAudioContext.createBufferSource();
            sourceNode.buffer = audioBuffer;
            sourceNode.connect(playbackAudioContext.destination);
            
            sourceNode.onended = () => {
                isPlaying = false;
                stopPassiveListening();
                updateUIState('ready');
            };
            
            sourceNode.start();
            await startPassiveListening();
            
        } catch (error) {
            console.error("Error decoding audio data:", error);
            isPlaying = false;
            updateUIState('ready');
        }
    }

    async function startPassiveListening() {
        try {
            passiveStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            passiveAudioContext = new AudioContext();
            passiveSource = passiveAudioContext.createMediaStreamSource(passiveStream);
            analyser = passiveAudioContext.createAnalyser();
            analyser.fftSize = 256;
            passiveSource.connect(analyser);
            monitorMicVolume();
        } catch (error) {
            console.error("Passive microphone access error:", error);
        }
    }

    function stopPassiveListening() {
        if (passiveMonitoringId) cancelAnimationFrame(passiveMonitoringId);
        if (passiveStream) passiveStream.getTracks().forEach(track => track.stop());
        if (passiveAudioContext && passiveAudioContext.state !== 'closed') {
        passiveAudioContext.close();
        }
        passiveMonitoringId = null;
    }

    function monitorMicVolume() {
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const checkVolume = () => {
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i];
            }
            let averageVolume = sum / bufferLength;

            if (averageVolume > BARGE_IN_THRESHOLD) {
                console.log("Barge-in detected! User is speaking.");
                stopPassiveListening();

                if (isPlaying) {
                    if (playbackAudioContext) playbackAudioContext.close();
                    audioQueue = [];
                    isPlaying = false;
                    if (socket && socket.readyState === WebSocket.OPEN) {
                        socket.send(JSON.stringify({ type: 'interrupt' }));
                    }
                }
                startRecording();
                return;
            }
            passiveMonitoringId = requestAnimationFrame(checkVolume);
        };
        passiveMonitoringId = requestAnimationFrame(checkVolume);
    }

    // --- HELPER FUNCTIONS ---
    function base64ToArrayBuffer(base64) {
        const binaryString = window.atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }

    function concatBuffers(buffers) {
        let totalLength = 0;
        for (const buffer of buffers) {
            totalLength += buffer.byteLength;
        }

        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const buffer of buffers) {
            result.set(new Uint8Array(buffer), offset);
            offset += buffer.byteLength;
        }
        return result.buffer;
    }

    function createWavFile(audioDataBuffer) {
        const sampleRate = 44100;
        const numChannels = 1;
        const bitsPerSample = 16;
        const dataSize = audioDataBuffer.byteLength;
        const blockAlign = (numChannels * bitsPerSample) / 8;
        const byteRate = sampleRate * blockAlign;
        const buffer = new ArrayBuffer(44 + dataSize);
        const view = new DataView(buffer);

        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);
        writeString(view, 36, 'data');
        view.setUint32(40, dataSize, true);
        new Uint8Array(buffer, 44).set(new Uint8Array(audioDataBuffer));

        return buffer;
    }

    function writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }

    // --- EVENT LISTENERS ---
    recordButton.addEventListener('click', () => {
        isRecording ? stopRecording() : startRecording();
    });

    validateButton.addEventListener('click', () => validateApiKeys(false));
    initialValidateButton.addEventListener('click', () => validateApiKeys(true));

    newChatButton.addEventListener('click', () => {
        window.location.href = window.location.pathname;
    });

    // Sidebar toggles
    leftSidebarToggle.addEventListener('click', toggleLeftSidebar);
    rightSidebarToggle.addEventListener('click', toggleRightSidebar);
    closeLSidebar.addEventListener('click', closeLeftSidebar);
    closeRSidebar.addEventListener('click', closeRightSidebar);

    // Close sidebars when clicking outside
    document.addEventListener('click', (e) => {
        if (isLeftSidebarOpen && !leftSidebar.contains(e.target) && !leftSidebarToggle.contains(e.target)) {
            closeLeftSidebar();
        }
        if (isRightSidebarOpen && !rightSidebar.contains(e.target) && !rightSidebarToggle.contains(e.target)) {
            closeRightSidebar();
        }
    });

    clearKeysButton.addEventListener('click', async () => {
        Object.values(keyInputs).forEach(input => input.value = '');
        Object.values(initialKeyInputs).forEach(input => input.value = '');
        Object.values(statusIcons).forEach(icon => icon.className = 'status-icon');
        Object.values(initialStatusIcons).forEach(icon => icon.className = 'status-icon');
        try {
            await fetch('/config/clear_keys', { method: 'POST' });
            console.log('API keys cleared successfully on server');
            window.location.reload();
        } catch (error) {
            console.error('Error clearing API keys:', error);
        }
    });

    // Password toggle functionality for both forms
    document.querySelectorAll('.password-toggle').forEach(button => {
        button.addEventListener('click', () => {
            const targetInput = document.getElementById(button.dataset.target);
            const icon = button.querySelector('i');
            if (targetInput.type === 'password') {
                targetInput.type = 'text';
                icon.classList.replace('fa-eye', 'fa-eye-slash');
            } else {
                targetInput.type = 'password';
                icon.classList.replace('fa-eye-slash', 'fa-eye');
            }
        });
    });

    // Clear button functionality for both forms
    document.querySelectorAll('.clear-btn').forEach(button => {
        button.addEventListener('click', () => {
            const targetInputId = button.dataset.target;
            const targetInput = document.getElementById(targetInputId);
            if (targetInput) {
                targetInput.value = '';
                const statusId = targetInputId.replace('Key', 'Status');
                const statusIcon = document.getElementById(statusId);
                if (statusIcon) {
                    statusIcon.className = 'status-icon';
                }
            }
        });
    });

    // Initialize the session
    initializeSession();
});
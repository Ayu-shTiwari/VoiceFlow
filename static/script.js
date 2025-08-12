document.addEventListener('DOMContentLoaded', () => {
    
    // --- SECTION 1: TEXT-TO-SPEECH ---
    const ttsForm = document.getElementById('tts-form');
    const textInput = document.getElementById('text-input');
    const generateButton = document.getElementById('generate-button');
    const ttsLoader = document.getElementById('loader');
    const audioPlayer = document.getElementById('audio-player');
    const canvas = document.getElementById('visualizer-canvas');
    const canvasCtx = canvas.getContext('2d');

    let audioContext;
    let analyser;

    function setupAudioContext(audioElement) {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        const source = audioContext.createMediaElementSource(audioElement);
        analyser = audioContext.createAnalyser();
        source.connect(analyser);
        analyser.connect(audioContext.destination);
    }

    function draw() {
        if (!analyser) return;
        requestAnimationFrame(draw);
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);
        canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
        const barWidth = (canvas.width / bufferLength) * 2.5;
        let barHeight;
        let x = 0;
        for (let i = 0; i < bufferLength; i++) {
            barHeight = dataArray[i];
            const gradient = canvasCtx.createLinearGradient(0, canvas.height, 0, canvas.height - barHeight);
            gradient.addColorStop(0, '#7267d8');
            gradient.addColorStop(1, '#a067d8');
            canvasCtx.fillStyle = gradient;
            canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
            x += barWidth + 1;
        }
    }

    audioPlayer.style.display = 'none';
    ttsLoader.style.display = 'none';
    canvas.style.display = 'none';

    ttsForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const text = textInput.value.trim();
        if (!text) return;
        generateButton.disabled = true;
        ttsLoader.style.display = 'flex';
        try {
            const response = await fetch('/tts/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text }),
            });
            if (!response.ok) throw new Error((await response.json()).detail);
            const data = await response.json();
            audioPlayer.src = data.audioFile;
            audioPlayer.crossOrigin = "anonymous";
            audioPlayer.style.display = 'block';
            canvas.style.display = 'block';
            setupAudioContext(audioPlayer);
            draw();
            audioPlayer.play();
        } catch (error) {
            alert(error.message);
        } finally {
            generateButton.disabled = false;
            ttsLoader.style.display = 'none';
        }
    });

    // --- SECTION 2: AI VOICE CHAT LOGIC ---
    const startButton = document.getElementById('start-recording-button');
    const stopButton = document.getElementById('stop-recording-button');
    const resetButton = document.getElementById('reset-button');
    const responseAudioPlayer = document.getElementById('response-audio-player');
    const responseLoader = document.getElementById('response-loader');
    const responseStatus = document.getElementById('response-status');
    const conversationDiv = document.getElementById('conversationDiv');
    // Note: The TTS Form elements are separate and their logic is not included here
    // to focus on the main voice chat functionality.

    // --- 2. STATE VARIABLES ---
    let mediaRecorder;
    let audioChunks = [];
    let sessionId = null;

    // --- 3. CORE FUNCTIONS ---

    /**
     * Updates all UI elements based on the application's current state.
     * This centralizes UI logic and prevents bugs.
     * @param {string} state - The current state (e.g., 'initial', 'recording', 'thinking', 'playing', 'error').
     * @param {string} [message] - An optional message to display.
     */
    const updateUIState = (state, message = '') => {
        startButton.disabled = !['initial', 'ready', 'error'].includes(state);
        stopButton.disabled = state !== 'recording';
        responseLoader.style.display = state === 'thinking' ? 'flex' : 'none';

        switch (state) {
            case 'initial':
                responseStatus.textContent = message || "Initializing...";
                break;
            case 'ready':
                responseStatus.textContent = message || 'Ready. Click to speak.';
                break;
            case 'recording':
                responseStatus.textContent = 'Recording...';
                break;
            case 'thinking':
                responseStatus.textContent = 'Thinking...';
                break;
            case 'playing':
                responseStatus.textContent = 'Playing response...';
                break;
            case 'error':
                responseStatus.textContent = `Error: ${message}`;
                break;
        }
    };
    
    /**
     * Displays a message in the conversation log.
     */
    const displayMessage = (role, text) => {
        if (!text) return; // Don't display empty or null messages
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', `${role}-message`);
        messageElement.innerHTML = `<strong>${role === 'user' ? 'You' : 'Assistant'}:</strong> <span>${text}</span>`;
        conversationDiv.appendChild(messageElement);
        conversationDiv.scrollTop = conversationDiv.scrollHeight; // Auto-scroll
    };

    /**
     * Handles the logic after recording stops: sends audio to the server and processes the response.
     */
    const handleRecordingStop = async () => {
        const recordedAudioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        if (recordedAudioBlob.size === 0) {
            updateUIState('ready', 'Nothing recorded. Please try again.');
            return;
        }

        updateUIState('thinking');
        const formData = new FormData();
        formData.append('audio_file', recordedAudioBlob, 'recording.webm');

        try {
            const response = await fetch(`/agent/chat/${sessionId}`, { method: 'POST', body: formData });
            const result = await response.json();

            // Check the 'error' flag from our server's structured response
            if (result.error) {
            // Display the fallback text sent from the server
            displayMessage('assistant', result.responseText);
            responseAudioPlayer.src = result.fallbackAudioUrl;
            
            } else {
                displayMessage('user', result.transcribedText);
                displayMessage('assistant', result.responseText);
                responseAudioPlayer.src = result.audioUrl;
            }
            
            if (responseAudioPlayer.src) {
                responseAudioPlayer.style.display = 'block';
                responseAudioPlayer.play();
            } else {
                // Handle cases where no audio is returned (e.g., "I didn't hear anything")
                updateUIState('ready');
            }

        } catch (error) {
            // This catches fatal network errors or if the response isn't valid JSON
            console.error("Fatal Error:", error);
            updateUIState('error', 'A connection error occurred.');
        }
    };

    /**
     * Initializes the session on page load.
     */
    const initializeSession = async () => {
        updateUIState('initial');
        const urlParams = new URLSearchParams(window.location.search);
        sessionId = urlParams.get('session_id');

        if (sessionId) {
            // Resuming an existing session
            console.log("Resuming session:", sessionId);
            try {
                const response = await fetch(`/agent/history/${sessionId}`);
                if (!response.ok) throw new Error("Could not fetch history.");
                const history = await response.json();
                conversationDiv.innerHTML = '';
                history.forEach(msg => displayMessage(msg.role, msg.content));
                updateUIState('ready', 'Resumed session. Click to speak.');
            } catch (error) {
                console.error("History loading error:", error);
                updateUIState('error', 'Could not load session history.');
            }
        } else {
            // Starting a new session
            sessionId = crypto.randomUUID();
            const newUrl = `${window.location.pathname}?session_id=${sessionId}`;
            window.history.pushState({ path: newUrl }, '', newUrl);
            console.log("Started new session:", sessionId);
            updateUIState('ready', 'New session started. Click to speak.');
        }
    };

    // --- 4. EVENT LISTENERS ---

    startButton.addEventListener('click', async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioChunks = [];
            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.ondataavailable = (event) => audioChunks.push(event.data);
            mediaRecorder.onstop = handleRecordingStop;
            
            mediaRecorder.start();
            updateUIState('recording');
        } catch (error) {
            console.error("Microphone access error:", error);
            alert("Could not access microphone. Please grant permission in your browser settings.");
            updateUIState('error', 'Microphone access denied.');
        }
    });

    stopButton.addEventListener('click', () => {
        if (mediaRecorder?.state === "recording") {
            mediaRecorder.stop();
        }
    });

    resetButton.addEventListener('click', () => {
        // Start a completely new session by navigating to the base URL
        window.location.href = window.location.pathname;
    });

    responseAudioPlayer.addEventListener('play', () => updateUIState('playing'));
    responseAudioPlayer.addEventListener('ended', () => updateUIState('ready'));
    responseAudioPlayer.addEventListener('pause', () => updateUIState('ready'));

    // --- 5. INITIALIZE THE APPLICATION ---
    initializeSession();

    // --- (Your separate TTS Form logic can remain here if needed) ---
});
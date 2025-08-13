document.addEventListener('DOMContentLoaded', () => {
                                    // --- SECTION : AI VOICE CHAT LOGIC ---

    // --- 1. UI ELEMENTS ---
    const recordButton = document.getElementById('recordButton');
    const resetButton = document.getElementById('newChatButton');
    const responseAudioPlayer = document.getElementById('response-audio-player');
    const responseLoader = document.getElementById('response-loader');
    const responseStatus = document.getElementById('response-status');
    const conversationDiv = document.getElementById('conversationDiv');

    // --- 2. STATE VARIABLES ---
    let mediaRecorder;
    let audioChunks = [];
    let sessionId = null;
    let isRecording = false;

    // --- 3. CORE FUNCTIONS ---

    /**
     * Updates all UI elements based on the application's current state.
     * This centralizes UI logic and prevents bugs.
     * @param {string} state - The current state (e.g., 'initial', 'recording', 'thinking', 'playing', 'error').
     * @param {string} [message] - An optional message to display.
     */
    const updateUIState = (state, message = '') => {
        recordButton.disabled = state === 'thinking' || state === 'playing';
        responseLoader.style.display = state === 'thinking' ? 'block' : 'none';

        if(state === 'recording') {
            recordButton.classList.add('recording');
            recordButton.innerHTML = '<i class="fas fa-stop"></i>';
        } else {
            recordButton.classList.remove('recording');
            recordButton.innerHTML = '<i class="fas fa-microphone"></i>';
        }

        if (message) {
            responseStatus.textContent = message;
        } else {
            if (state === 'ready') responseStatus.textContent = 'Click the button to speak.';
            if (state === 'playing') responseStatus.textContent = 'Playing response...';
        }
    };
    
    /**
     * Displays a message in the conversation log.
     */
    const displayMessage = (role, text) => {
        if (!text) return; // Don't display empty or null messages
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', `${role}-message`);
        const strong = document.createElement('strong');
        strong.textContent = role === 'user' ? 'You: ' : 'Assistant: ';
        const span = document.createElement('span');
        span.textContent = text;
        messageElement.appendChild(strong);
        messageElement.appendChild(span);
        conversationDiv.appendChild(messageElement);
        conversationDiv.scrollTop = conversationDiv.scrollHeight;// Auto-scroll
    };

    /**
     * Handles the logic after recording stops: sends audio to the server and processes the response.
     */
    const handleRecordingStop = async () => {
        const recordedAudioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        if (recordedAudioBlob.size === 0) {
            isRecording = false;
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
            if(result.fallbackAudioUrl) responseAudioPlayer.src = result.fallbackAudioUrl;
            
            } else {
                displayMessage('user', result.transcribedText);
                displayMessage('assistant', result.responseText);
                if(result.audioUrl) responseAudioPlayer.src = result.audioUrl;
            }
            
            if (responseAudioPlayer.src) {
                responseAudioPlayer.play();
            } else {
                // Handle cases where no audio is returned
                updateUIState('ready');
            }

        } catch (error) {
            // This catches fatal network errors or if the response isn't valid JSON
            console.error("Fatal Error:", error);
            updateUIState('error', 'A connection error occurred.');
        }
    };
    /**
     * Starts the recording process.
     */
    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            isRecording = true;
            audioChunks = [];
            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.ondataavailable = (event) => audioChunks.push(event.data);
            mediaRecorder.onstop = handleRecordingStop;
            mediaRecorder.start();
            updateUIState('recording', 'Listening...');
        } catch (error) {
            console.error("Microphone access error:", error);
            alert("Could not access microphone. Please grant permission.");
            updateUIState('error', 'Microphone access denied.');
        }
    };
    const stopRecording = () => {
        if (mediaRecorder?.state === "recording") {
            mediaRecorder.stop();
            isRecording = false;
        }
    }
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

    recordButton.addEventListener('click', () => {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
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
});
document.addEventListener('DOMContentLoaded', () => {
    // --- UI ELEMENTS ---
    const recordButton = document.getElementById('recordButton');
    const newChatButton = document.getElementById('newChatButton');
    const responseStatus = document.getElementById('response-status');
    const conversationDiv = document.getElementById('conversationDiv');
    const responseLoader = document.getElementById('response-loader');

    // --- STATE & AUDIO VARIABLES ---
    let socket;
    let sessionId = null;
    let isRecording = false;

    // For recording
    let audioContext;
    let processor;
    let source;
    let stream;

    // For playback
    let playbackAudioContext;
    let audioQueue = [];
    let isPlaying = false;
    let lastUserMessageDiv = null;

    // --- UI MANAGEMENT ---
    const updateUIState = (state, message = '') => {
        recordButton.disabled = state === 'thinking' || state === 'playing';
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
        if (role === 'user') {
            if (!lastUserMessageDiv) {
                lastUserMessageDiv = document.createElement('div');
                lastUserMessageDiv.classList.add('message', 'user-message');
                const strong = document.createElement('strong');
                strong.textContent = 'You: ';
                const span = document.createElement('span');
                lastUserMessageDiv.appendChild(strong);
                lastUserMessageDiv.appendChild(span);
                conversationDiv.appendChild(lastUserMessageDiv);
            }
            lastUserMessageDiv.querySelector('span').textContent = text;
        } else {
            // For assistant, create a new message div each time
            lastUserMessageDiv = null; // Finalize user message
            const messageElement = document.createElement('div');
            messageElement.classList.add('message', 'assistant-message');
            const strong = document.createElement('strong');
            strong.textContent = 'Assistant: ';
            const span = document.createElement('span');
            span.textContent = text; // For now, we display the full text at once
            messageElement.appendChild(strong);
            messageElement.appendChild(span);
            conversationDiv.appendChild(messageElement);
        }
        conversationDiv.scrollTop = conversationDiv.scrollHeight;
    };

    // --- REAL-TIME RECORDING ---
    const startRecording = async () => {
        try {
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
                socket.send(pcm16); // Send raw audio chunks
            };
        } catch (error) {
            console.error("Microphone access error:", error);
            updateUIState('error', 'Microphone access denied.');
        }
    };

    const stopRecording = () => {
        isRecording = false;
        updateUIState('ready');

        if (processor) processor.disconnect();
        if (source) source.disconnect();
        if (stream) stream.getTracks().forEach(track => track.stop());
        if (audioContext) audioContext.close();

        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ "text": "END" }));
        }
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
    const initializeSession = () => {
        const urlParams = new URLSearchParams(window.location.search);
        sessionId = urlParams.get('session_id');
        if (!sessionId) {
            sessionId = crypto.randomUUID();
            const newUrl = `${window.location.pathname}?session_id=${sessionId}`;
            window.history.pushState({ path: newUrl }, '', newUrl);
        }
        connectWebSocket();
    };

    const connectWebSocket = () => {
        const wsUrl = `ws://${window.location.host}/ws`;
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            console.log("WebSocket connected.");
            socket.send(JSON.stringify({ session_id: sessionId }));
            updateUIState('ready');
        };

        socket.onmessage = (event) => {
            const result = JSON.parse(event.data);

            if (result.type === 'transcript') {
                displayMessage('user', result.transcript);
                if (result.is_final) {
                    updateUIState('thinking');
                }
            } else if (result.type === 'assistant') {
                // Display the single final assistant response
                const full = result.full_response;
                displayMessage('assistant', full);
            } else if (result.type === 'llm_response') {
                // This message type is no longer used; ignore if received
            } else if (result.type === 'audio') {
                const audioChunk = base64ToArrayBuffer(result.audio_chunk);
                audioQueue.push(audioChunk);
                if (!isPlaying) {
                    playAudioQueue();
                }
            } else if (result.type === 'pipeline_end') {
                // When the full response is done, update UI and ensure final text is shown
                if (result.full_response) {
                    displayMessage('assistant', result.full_response);
                }
                updateUIState('ready');
            }
        };

        socket.onclose = () => {
            updateUIState('error', 'Connection lost. Reconnecting...');
            setTimeout(initializeSession, 3000);
        };
    };

    // --- AUDIO PLAYBACK ---
    async function playAudioQueue() {
        if (audioQueue.length === 0) {
            isPlaying = false;
            // Check if the AI is done speaking
            if(responseLoader.style.display === 'none') {
                 updateUIState('ready');
            }
            return;
        }
        isPlaying = true;
        updateUIState('playing');

        if (!playbackAudioContext || playbackAudioContext.state === 'closed') {
            playbackAudioContext = new AudioContext({ sampleRate: 44100 });
        }

        const audioData = audioQueue.shift();
        const audioBuffer = await playbackAudioContext.decodeAudioData(audioData);
        const sourceNode = playbackAudioContext.createBufferSource();
        sourceNode.buffer = audioBuffer;
        sourceNode.connect(playbackAudioContext.destination);
        sourceNode.onended = playAudioQueue;
        sourceNode.start();
    }

    function base64ToArrayBuffer(base64) {
        const binaryString = window.atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }

    // --- EVENT LISTENERS ---
    recordButton.addEventListener('click', () => {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    });

    newChatButton.addEventListener('click', () => {
        window.location.href = window.location.pathname;
    });

    initializeSession();
});
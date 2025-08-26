document.addEventListener('DOMContentLoaded', () => {
    // --- UI ELEMENTS ---
    const recordButton = document.getElementById('recordButton');
    const newChatButton = document.getElementById('newChatButton');
    const responseStatus = document.getElementById('response-status');
    const conversationDiv = document.getElementById('conversationDiv');
    const responseLoader = document.getElementById('response-loader');

    // --- STATE & AUDIO VARIABLES ---
    let socket;
    let isRecording = false;

    // For recording
    let audioContext;
    let processor;
    let source;
    let stream;

    // For playback
    let playbackAudioContext;
    let audioQueue = []; // This will now store raw ArrayBuffer chunks
    let isPlaying = false;
    let lastUserMessageDiv = null;
    let currentAssistantMessageSpan = null; 
    let tempTranscriptSpan = null;

    let passiveAudioContext;
    let passiveStream;
    let analyser;
    let passiveMonitoringId;
    const BARGE_IN_THRESHOLD = 20;

    // --- UI MANAGEMENT ---
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
        
        // Create a new container for each message
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', role === 'user' ? 'user-message' : 'assistant-message');
        
        // Create the 'You:' or 'Assistant:' label
        const strong = document.createElement('strong');
        strong.textContent = role === 'user' ? 'You: ' : 'Assistant: ';
        
        // Create the span for the actual text content
        const span = document.createElement('span');
        span.textContent = text;
        
        // Assemble and append the message to the conversation
        messageElement.appendChild(strong);
        messageElement.appendChild(span);
        conversationDiv.appendChild(messageElement);
        
        // Auto-scroll to the bottom
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
            lastUserMessageDiv = null;
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

    // --- SESSION & WEBSOCKET ---
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

            if (result.type === 'history') {
                console.log("Received existing chat history.");
                conversationDiv.innerHTML = ''; // Clear any existing messages
                result.data.forEach(message => {
                    // The history format is { role: 'user'/'assistant', parts: ['text'] }
                    const role = message.role;
                    const text = message.parts[0];
                    displayMessage(role, text);
                });
                lastUserMessageDiv = null; // Reset for new messages
                currentAssistantMessageSpan = null;
            }

            if (result.type === 'transcript') {
                if (result.is_final) {
                    if (tempTranscriptSpan) {
                    tempTranscriptSpan.remove();
                    tempTranscriptSpan = null;
                    }
                    displayMessage('user', result.transcript);
                    updateUIState('thinking');
                }
                
            } else if (result.type === 'llm_response') {
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
            } else if (result.type === 'audio') {
                // MODIFIED: Silently collect audio chunks
                console.log("Audio chunk received and queued.");
                const audioChunk = base64ToArrayBuffer(result.audio_chunk);
                audioQueue.push(audioChunk);
            } else if (result.type === 'llm_response_end') {
                // MODIFIED: This is now the trigger to start playback
                currentAssistantMessageSpan = null;
                if (audioQueue.length > 0) {
                    processAndPlayAudioQueue();
                }
            }
        };

        socket.onclose = () => {
            updateUIState('error', 'Connection lost. Reconnecting...');
            setTimeout(initializeSession, 3000);
        };
    };
    
    // --- HELPER FUNCTIONS for AUDIO PROCESSING ---
    // --- AUDIO PLAYBACK (NEW LOGIC) ---
    async function processAndPlayAudioQueue() {
        if (isPlaying || audioQueue.length === 0) return;
        
        isPlaying = true;
        updateUIState('playing');

        // Step 1: Concatenate all audio buffers in the queue
        const fullAudioBuffer = concatBuffers(audioQueue);
        // Step 2: Create a valid WAV header for the concatenated data
        const wavBuffer = createWavFile(fullAudioBuffer);
        // Step 3: Clear the queue for the next response
        audioQueue = [];

        if (!playbackAudioContext || playbackAudioContext.state === 'closed') {
            playbackAudioContext = new AudioContext({ sampleRate: 44100 });
        }

        try {
            // Step 4: Decode the complete WAV file data
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
            console.error("Error decoding concatenated audio data:", error);
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
        if (passiveAudioContext) passiveAudioContext.close();
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

                // Stop passive monitoring
                stopPassiveListening();

                // --- 🔥 INTERRUPT CURRENT PLAYBACK ---
                if (isPlaying) {
                    if (playbackAudioContext) {
                        playbackAudioContext.close();
                    }
                    audioQueue = [];
                    isPlaying = false;

                    if (socket && socket.readyState === WebSocket.OPEN) {
                        socket.send(JSON.stringify({ type: 'interrupt' }));
                    }
                }

                // --- 🔥 START RECORDING IMMEDIATELY ---
                startRecording();

                return; // stop monitoring
            }

            passiveMonitoringId = requestAnimationFrame(checkVolume);
        };

        passiveMonitoringId = requestAnimationFrame(checkVolume);
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

        // RIFF header
        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeString(view, 8, 'WAVE');
        // fmt sub-chunk
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); // PCM format
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);
        // data sub-chunk
        writeString(view, 36, 'data');
        view.setUint32(40, dataSize, true);
        // Write the actual audio data
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
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    });

    newChatButton.addEventListener('click', () => {
        window.location.href = window.location.pathname; // Reload without session_id
    });

    initializeSession();
});         
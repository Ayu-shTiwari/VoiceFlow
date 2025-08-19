document.addEventListener('DOMContentLoaded', () => {
    // --- UI ELEMENTS ---
    const startRecordButton = document.getElementById('startRecord');
    const stopRecordButton = document.getElementById('stopRecord');
    const conversationDiv = document.getElementById('conversation');

    // --- STATE VARIABLES for Web Audio API ---
    let socket;
    let audioContext;
    let processor;
    let source;
    let stream;
    let lastUserMessageDiv = null; // To update the partial transcript in place

    // --- CORE FUNCTIONS ---

    /**
     * Converts a Float32Array of audio data to a 16-bit PCM ArrayBuffer.
     * This is the format required by the AssemblyAI streaming API.
     * @param {Float32Array} float32Array - The raw audio data from the microphone.
     * @returns {ArrayBuffer} The audio data in 16-bit PCM format.
     */
    function floatTo16BitPCM(float32Array) {
        const buffer = new ArrayBuffer(float32Array.length * 2);
        const view = new DataView(buffer);
        let offset = 0;
        for (let i = 0; i < float32Array.length; i++, offset += 2) {
            let s = Math.max(-1, Math.min(1, float32Array[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
        return buffer;
    }

    /**
     * Starts the recording process using the Web Audio API.
     */
    async function startRecording() {
        try {
            // 1. Get user's microphone stream
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // 2. Create and configure the AudioContext and ScriptProcessorNode
            audioContext = new AudioContext({ sampleRate: 16000 }); // Must be 16kHz
            source = audioContext.createMediaStreamSource(stream);
            processor = audioContext.createScriptProcessor(4096, 1, 1); // Buffer size, input channels, output channels

            // 3. Connect the audio nodes
            source.connect(processor);
            processor.connect(audioContext.destination);

            // 4. Set up the audio processing event handler
            processor.onaudioprocess = (event) => {
                if (!socket || socket.readyState !== WebSocket.OPEN) return;
                
                // Get the raw audio data (Float32)
                const inputData = event.inputBuffer.getChannelData(0);
                
                // Convert it to 16-bit PCM
                const pcm16 = floatTo16BitPCM(inputData);
                
                // Send the raw PCM data over the WebSocket
                socket.send(pcm16);
            };

            // Update UI
            startRecordButton.disabled = true;
            stopRecordButton.disabled = false;
            lastUserMessageDiv = null;

        } catch (err) {
            console.error("Microphone access denied:", err);
            alert("Microphone access denied. Please check your settings.");
        }
    }

    /**
     * Stops the recording and cleans up all Web Audio API resources.
     */
    function stopRecording() {
        if (processor) {
            processor.disconnect();
            processor.onaudioprocess = null;
        }
        if (source) source.disconnect();
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
        if (audioContext) audioContext.close();

        // Close the WebSocket connection
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.close();
        }

        // Update UI
        startRecordButton.disabled = false;
        stopRecordButton.disabled = true;
    }

    /**
     * Establishes the WebSocket connection and sets up its event handlers.
     */
    function connectWebSocket() {
        socket = new WebSocket('ws://127.0.0.1:8000/ws');

        socket.onopen = () => {
            console.log("WebSocket connection established. Ready to record.");
            startRecordButton.disabled = false;
        };

        socket.onclose = () => {
            console.log("WebSocket connection closed.");
            stopRecording(); // Ensure everything is cleaned up if the server closes the connection
        };

        socket.onerror = (error) => {
            console.error("WebSocket Error: ", error);
            alert("There was an error with the WebSocket connection.");
        };

        socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'transcript') {
                updateTranscript(data.transcript, data.is_final);
            }
        };
    }

    /**
     * Updates the conversation UI with partial or final transcripts.
     * @param {string} text - The transcribed text.
     * @param {boolean} isFinal - True if the transcript is final.
     */
    function updateTranscript(text, isFinal) {
        if (!lastUserMessageDiv || isFinal) {
            lastUserMessageDiv = document.createElement('div');
            lastUserMessageDiv.classList.add('message', 'user-message');
            const strong = document.createElement('strong');
            strong.textContent = 'You: ';
            const span = document.createElement('span');
            span.textContent = text;
            lastUserMessageDiv.appendChild(strong);
            lastUserMessageDiv.appendChild(span);
            conversationDiv.appendChild(lastUserMessageDiv);
        } else {
            lastUserMessageDiv.querySelector('span').textContent = text;
        }

        if (isFinal) {
            lastUserMessageDiv.classList.add('final');
            lastUserMessageDiv = null;
        }
        conversationDiv.scrollTop = conversationDiv.scrollHeight;
    }

    // --- EVENT LISTENERS ---
    startRecordButton.addEventListener('click', startRecording);
    stopRecordButton.addEventListener('click', stopRecording);

    // --- INITIALIZATION ---
    connectWebSocket();
});

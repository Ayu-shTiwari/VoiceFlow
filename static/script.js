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
    const transcriptDisplay = document.getElementById('transcript-display');
    const llmResponseContainer = document.getElementById('llm-response-container');

    let mediaRecorder;
    let audioChunks = [];
    let stream;

    function resetUI() {
        if (mediaRecorder && mediaRecorder.state === "recording") {
            mediaRecorder.stop();
        }
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
        }
        responseAudioPlayer.pause();
        responseAudioPlayer.src = '';

        startButton.disabled = false;
        stopButton.disabled = true;
        resetButton.disabled = false;
        startButton.classList.remove('recording');
        responseAudioPlayer.style.display = 'none';
        responseLoader.style.display = 'none';
        responseStatus.textContent = '';
        transcriptDisplay.textContent = '';
        llmResponseContainer.textContent = '';
        audioChunks = [];
    }
    
    resetUI();

    startButton.addEventListener('click', async () => {
        // Only reset the visual state, don't stop an active stream here.
        resetUI();
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            startButton.disabled = true;
            stopButton.disabled = false;
            resetButton.disabled = false; // Keep reset enabled
            startButton.classList.add('recording');
            audioChunks = [];
            
            mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
            
            mediaRecorder.addEventListener('dataavailable', event => {
                if (event.data.size > 0) audioChunks.push(event.data);
            });

            mediaRecorder.onstop = async () => {
                const recordedAudioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                
                if (stream) {
                    stream.getTracks().forEach(track => track.stop());
                    stream = null;
                }
                
                startButton.disabled = false;
                stopButton.disabled = true;
                startButton.classList.remove('recording');

                if (recordedAudioBlob.size === 0) {
                    resetUI();
                    return;
                }

                const formData = new FormData();
                formData.append('audio_file', recordedAudioBlob, 'recording.webm');
                
                responseStatus.textContent = "Thinking...";
                responseLoader.style.display = 'flex';

                
                try {
                    const response = await fetch('/llm/query', {
                        method: 'POST',
                        body: formData,
                    });
                    if (!response.ok) throw new Error((await response.json()).detail);
                    
                    const result = await response.json();
                    
                    transcriptDisplay.textContent = `You said: "${result.transcribedText}"`;
                    llmResponseContainer.textContent = result.responseText;
                    responseAudioPlayer.src = result.audioUrl;
                    responseAudioPlayer.crossOrigin = "anonymous";
                    responseAudioPlayer.style.display = 'block';
                    responseAudioPlayer.play();
                    responseStatus.textContent = "Response generated!";
                    
                } catch (error) {
                    responseStatus.textContent = `Error: ${error.message}`;
                } finally {
                    responseLoader.style.display = 'none';
                    startButton.disabled = false;
                    resetButton.disabled = false;
                }
            };

            mediaRecorder.start(250);

        } catch (error) {
            alert("Could not access microphone.");
            resetUI();
        }
    });

    stopButton.addEventListener('click', () => {
        if (mediaRecorder && mediaRecorder.state === "recording") {
            mediaRecorder.stop();
        }
    });

    resetButton.addEventListener('click', resetUI);
    });


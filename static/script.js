document.addEventListener('DOMContentLoaded', () => {
    
    // --- SECTION 1: TEXT-TO-SPEECH (No changes here) ---
    const ttsForm = document.getElementById('tts-form');
    const textInput = document.getElementById('text-input');
    const generateButton = document.getElementById('generate-button');
    const loader = document.getElementById('loader');
    const audioPlayer = document.getElementById('audio-player');
    const canvas = document.getElementById('visualizer-canvas');
    const canvasCtx = canvas.getContext('2d');

    let audioContext;
    let analyser;
    let source;

    function setupAudioContext() {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            source = audioContext.createMediaElementSource(audioPlayer);
            source.connect(analyser);
            analyser.connect(audioContext.destination);
        }
    }

    function draw() {
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
    loader.style.display = 'none';
    canvas.style.display = 'none';

    ttsForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const text = textInput.value.trim();
        if (!text) {
            alert('Please enter some text.');
            return;
        }
        generateButton.disabled = true;
        audioPlayer.style.display = 'none';
        canvas.style.display = 'none';
        loader.style.display = 'flex';
        try {
            const response = await fetch('/tts/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text }),
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'An unknown error occurred.');
            }
            const data = await response.json();
            const audioUrl = data.audioUrl;
            audioPlayer.src = audioUrl;
            audioPlayer.crossOrigin = "anonymous";
            audioPlayer.style.display = 'block';
            canvas.style.display = 'block';
            setupAudioContext();
            draw();
            audioPlayer.play();
        } catch (error) {
            console.error('Error:', error);
            alert(`Error: ${error.message}`);
        } finally {
            generateButton.disabled = false;
            loader.style.display = 'none';
        }
    });

    // --- SECTION 2: FINAL ECHO BOT LOGIC ---
    const startButton = document.getElementById('start-recording-button');
    const stopButton = document.getElementById('stop-recording-button');
    const echoAudioPlayer = document.getElementById('echo-audio-player');

    // FIXED: Get references to the upload elements
    const uploadSection = document.querySelector('.upload-section');
    const uploadButton = document.getElementById('upload-button');
    const uploadStatus = document.getElementById('upload-status');

    let mediaRecorder;
    let audioChunks = [];
    let stream; 
    let recordedAudioBlob;

    echoAudioPlayer.style.display = 'none';
    stopButton.disabled = true;
    uploadSection.style.display = 'none'; // Hide upload section initially


    startButton.addEventListener('click', async() => {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            startButton.disabled = true;
            stopButton.disabled = false;
            startButton.classList.add('recording');
            echoAudioPlayer.style.display = 'none';
            uploadSection.style.display = 'none'; // Show upload section when recording starts
            audioChunks = []; // Clear previous recording chunks

            const options = { mimeType: 'audio/webm;codecs=opus' };
            mediaRecorder = new MediaRecorder(stream, options);

            mediaRecorder.addEventListener('dataavailable', event => {
                if (event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            });

            mediaRecorder.start();
        } catch (error) {
            console.error("Error accessing microphone:", error);
            alert("Could not access microphone. Please ensure you have given permission.");
        }
    });

    stopButton.addEventListener('click', () => {
        if (mediaRecorder && mediaRecorder.state === "recording") {
            // Create a promise that resolves when the 'stop' event fires
            const stopped = new Promise((resolve, reject) => {
                mediaRecorder.onstop = resolve;
                mediaRecorder.onerror = event => reject(event.name);
            });

            // This function will run after the recorder has fully stopped
            const handleStop = () => {
                recordedAudioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const audioUrl = URL.createObjectURL(recordedAudioBlob);

                echoAudioPlayer.src = audioUrl;
                echoAudioPlayer.style.display = 'block';
                uploadSection.style.display = 'block'; // Show upload section after recording stops
                uploadStatus.textContent = ''; // Clear previous upload status

                startButton.disabled = false;
                stopButton.disabled = true;
                startButton.classList.remove('recording');
            };

            // Wait for the 'stopped' promise to resolve, then handle it
            stopped.then(handleStop);
            
            // Stop the recorder and the microphone stream
            mediaRecorder.stop();
            stream.getTracks().forEach(track => track.stop());
        }
    });

    // --- SECTION 3: UPLOAD BUTTON LOGIC  ---
    uploadButton.addEventListener('click', async () => {
        if (!recordedAudioBlob) {
            alert('Please record audio before uploading.');
            return;
        }
        // create form data object to send the audio file
        const formData = new FormData();   
        formData.append('audio_file', recordedAudioBlob, 'recording.webm');
        uploadStatus.textContent = 'Uploading...';
        uploadButton.disabled = true;
        try {
            const response = await fetch('/upload-audio/',{
                method: 'POST',
                body: formData, // send the form data
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'upload failed.');
            }

            const result = await response.json();
            console.log('Upload successful:', result);
            uploadStatus.textContent = 'Upload successful!';
            alert('Upload successful!');
        } catch (error) {
            console.error('Upload error:', error);
            uploadStatus.textContent = `Upload failed: ${error.message}`;

        } finally {
            uploadButton.disabled = false;
        }
    });
});
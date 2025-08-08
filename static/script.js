document.addEventListener('DOMContentLoaded', () => {
    
    // --- SECTION 1: TEXT-TO-SPEECH ---
    const ttsForm = document.getElementById('tts-form');
    const textInput = document.getElementById('text-input');
    const generateButton = document.getElementById('generate-button');
    const loader = document.getElementById('loader');
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
        loader.style.display = 'flex';
        try {
            const response = await fetch('/tts/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text }),
            });
            if (!response.ok) throw new Error((await response.json()).detail);
            const data = await response.json();
            audioPlayer.src = data.audioUrl;
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
            loader.style.display = 'none';
        }
    });

    // --- SECTION 2: ECHO BOT LOGIC ---
    const startButton = document.getElementById('start-recording-button');
    const stopButton = document.getElementById('stop-recording-button');
    const echoAudioPlayer = document.getElementById('echo-audio-player');
    const echoSection = document.querySelector('.echo-section') || document.querySelector('.echo-audio-section');
    const echoButton = document.getElementById('echo-button');
    const echoStatus = document.getElementById('echo-status');
    const resetButton = document.getElementById('reset-button');

    let mediaRecorder;
    let audioChunks = [];
    let stream; 
    let recordedAudioBlob;

    echoAudioPlayer.style.display = 'none';
    stopButton.disabled = true;
    if(echoSection) echoSection.style.display = 'none';

    startButton.addEventListener('click', async () => {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            startButton.disabled = true;
            stopButton.disabled = false;
            startButton.classList.add('recording');
            if(echoSection) echoSection.style.display = 'none';
            echoAudioPlayer.style.display = 'none';
            audioChunks = [];
            
            mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
            
            mediaRecorder.addEventListener('dataavailable', event => {
                if (event.data.size > 0) audioChunks.push(event.data);
            });

            mediaRecorder.onstop = () => {
                recordedAudioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                if(echoSection) echoSection.style.display = 'block';
                if(echoStatus) echoStatus.textContent = 'Recording ready. Click "Echo Voice".';
                
                startButton.disabled = false;
                stopButton.disabled = true;
                startButton.classList.remove('recording');
                stream.getTracks().forEach(track => track.stop());
            };

            // --- FIXED: Start recording with a timeslice ---
            // This forces the 'dataavailable' event to fire every 250ms,
            // ensuring we capture audio chunks reliably.
            mediaRecorder.start(250);

        } catch (error) {
            alert("Could not access microphone. Please ensure you have given permission in your browser settings.");
        }
    });

    stopButton.addEventListener('click', () => {
        if (mediaRecorder && mediaRecorder.state === "recording") {
            mediaRecorder.stop();
        }
    });

    resetButton.addEventListener('click', () => {
        // Stop recording if it's in progress
        if (mediaRecorder && mediaRecorder.state === "recording") {
            mediaRecorder.stop();
        }
        // Hide the echo section and player
        if(echoSection) echoSection.style.display = 'none';
        echoAudioPlayer.style.display = 'none';
        echoAudioPlayer.src = ''; // Clear the audio source
        
        // Reset button states
        startButton.disabled = false;
        stopButton.disabled = true;
        startButton.classList.remove('recording');
        
        // Clear data
        recordedAudioBlob = null;
        audioChunks = [];
    });

    echoButton.addEventListener('click', async () => {
        if (!recordedAudioBlob || recordedAudioBlob.size === 0) {
            alert("No recording available or recording is empty.");
            return;
        }
        const formData = new FormData();
        formData.append('audio_file', recordedAudioBlob, 'recording.webm');
        
        if(echoStatus) echoStatus.textContent = "Echoing... please wait.";
        echoButton.disabled = true;

        try {
            const response = await fetch('/tts/echo', {
                method: 'POST',
                body: formData,
            });
            if (!response.ok) throw new Error((await response.json()).detail);
            
            const result = await response.json();
            echoAudioPlayer.src = result.audioUrl;
            echoAudioPlayer.crossOrigin = "anonymous";
            echoAudioPlayer.style.display = 'block';
            echoAudioPlayer.play();
            
            if(echoStatus) echoStatus.textContent = "Echo successful!";
            setTimeout(() => { if(echoStatus) echoStatus.textContent = ''; }, 4000);

        } catch (error) {
            console.error("Echo error:", error);
            if(echoStatus) echoStatus.textContent = `Error: ${error.message}`;
        } finally {
            echoButton.disabled = false;
        }
    });
});

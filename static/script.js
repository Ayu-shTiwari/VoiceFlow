document.addEventListener('DOMContentLoaded', () => {
    // --- Get all our HTML elements ---
    const ttsForm = document.getElementById('tts-form');
    const textInput = document.getElementById('text-input');
    const generateButton = document.getElementById('generate-button');
    const loader = document.getElementById('loader');
    const audioPlayer = document.getElementById('audio-player');
    const canvas = document.getElementById('visualizer-canvas');
    const canvasCtx = canvas.getContext('2d'); // The "pen" we'll use to draw

    // --- Web Audio API Setup ---
    // This setup is done only once
    let audioContext;
    let analyser;
    let source;

    // This function connects the audio player to the analyser
    function setupAudioContext() {
        // Create a new audio context if it doesn't exist
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            
            // Create a source node from our <audio> element
            source = audioContext.createMediaElementSource(audioPlayer);
            
            // Connect the audio flow: source -> analyser -> speakers
            source.connect(analyser);
            analyser.connect(audioContext.destination);
        }
    }

    // --- The Drawing Loop ---
    function draw() {
        // Schedule the next frame of the animation
        requestAnimationFrame(draw);

        // Get the audio frequency data
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);

        // Clear the canvas for the new frame
        canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

        const barWidth = (canvas.width / bufferLength) * 2.5;
        let barHeight;
        let x = 0;

        // Loop through the data and draw a bar for each frequency
        for (let i = 0; i < bufferLength; i++) {
            barHeight = dataArray[i];

            // Create a color gradient for the bars
            const gradient = canvasCtx.createLinearGradient(0, canvas.height, 0, canvas.height - barHeight);
            gradient.addColorStop(0, '#7267d8'); // Start color (bottom)
            gradient.addColorStop(1, '#a067d8'); // End color (top)
            canvasCtx.fillStyle = gradient;
            
            // Draw the bar on the canvas
            canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

            x += barWidth + 1; // Move to the next bar's position
        }
    }

    // --- Hide elements on page load ---
    audioPlayer.style.display = 'none';
    loader.style.display = 'none';
    canvas.style.display = 'none';

    // --- Form Submission Logic ---
    ttsForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const text = textInput.value.trim();
        if (!text) {
            alert('Please enter some text.');
            return;
        }

        // --- Start Loading State ---
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

            // --- Success State ---
            audioPlayer.src = audioUrl;
            
            // Set Cross-Origin attribute to allow audio analysis
            audioPlayer.crossOrigin = "anonymous";
            
            audioPlayer.style.display = 'block';
            canvas.style.display = 'block'; // Show the canvas

            // Setup the audio context and start the visualizer
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
});

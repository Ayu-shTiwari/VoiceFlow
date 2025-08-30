// This class runs in a separate thread and handles audio processing.
class RecorderProcessor extends AudioWorkletProcessor {
  
  // Buffer settings
  constructor() {
    super();
    this.bufferSize = 2048; // Collects around 128ms of audio at 16kHz
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  // Converts Float32Array to 16-bit PCM ArrayBuffer
  floatTo16BitPCM(input) {
    const buffer = new ArrayBuffer(input.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return buffer;
  }

  // The main processing function, called whenever new audio data is available.
  process(inputs, outputs, parameters) {
    const inputChannel = inputs[0][0];

    if (!inputChannel) {
      return true;
    }
    
    // Copy the new data into our buffer.
    const remainingSpace = this.bufferSize - this.bufferIndex;
    if (inputChannel.length > remainingSpace) {
      this.buffer.set(inputChannel.subarray(0, remainingSpace), this.bufferIndex);
      this.bufferIndex += remainingSpace;
    } else {
      this.buffer.set(inputChannel, this.bufferIndex);
      this.bufferIndex += inputChannel.length;
    }

    // If the buffer is full, send the data and reset.
    if (this.bufferIndex >= this.bufferSize) {
      const pcmData = this.floatTo16BitPCM(this.buffer);
      this.port.postMessage(pcmData);
      
      // Reset the buffer
      this.bufferIndex = 0;
    }

    return true;
  }
}

registerProcessor('recorder-processor', RecorderProcessor);
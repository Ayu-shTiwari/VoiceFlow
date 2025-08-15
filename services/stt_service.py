import os
import assemblyai as aai

ASSEMBLYAI_API_KEY = os.getenv("ASSEMBLYAI_API_KEY")
if not ASSEMBLYAI_API_KEY:
    raise RuntimeError("ASSEMBLYAI_API_KEY not found in .env file.")
aai.settings.api_key = ASSEMBLYAI_API_KEY

def transcribe_audio(audio_data: bytes) -> str:
        """
        Transcribes the given audio data using the AssemblyAI API.

        Args:
        audio_data: The raw bytes of the audio file.

        Returns:
            The transcribed text as a string.

        Raises:
            Exception: If the transcription fails or no speech is detected.
        """
        transcriber = aai.Transcriber()
        transcript = transcriber.transcribe(audio_data)
        
        if transcript.status == aai.TranscriptStatus.error:
            raise Exception(f"AssemblyAi transcription failed: {transcript.error}")
        
        transcribed_text = transcript.text
        if not transcribed_text:
            raise Exception("No speech was detected in the audio.")
        
        return transcribed_text
    
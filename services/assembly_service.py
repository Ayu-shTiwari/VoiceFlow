# assembly_service.py

import asyncio
import assemblyai as aai
from assemblyai.streaming.v3 import StreamingClient, StreamingClientOptions, StreamingEvents, StreamingParameters, TurnEvent, StreamingError
import logging
import os

logger = logging.getLogger(__name__)

class AssemblyAIService:
    """Handles real-time transcription using AssemblyAI."""
    # MODIFIED: The service now takes a single, unified callback.
    def __init__(self, on_turn_callback):
        self.api_key = os.getenv("ASSEMBLYAI_API_KEY")
        if not self.api_key:
            raise ValueError("ASSEMBLYAI_API_KEY environment variable not set.")
        aai.settings.api_key = self.api_key
        
        self.on_turn_callback = on_turn_callback
        self.client = None

    # MODIFIED: This method now simply forwards the event data to the callback.
    def _on_turn(self, client: StreamingClient, event: TurnEvent):
        """Callback for when a transcript segment is received."""
        transcript = event.transcript
        is_final = event.end_of_turn
        
        # Let the main app handle the logic by passing the event data.
        self.on_turn_callback(transcript, is_final)

    def _on_error(self, client: StreamingClient, error: StreamingError):
        """Callback for any streaming errors."""
        logger.error(f"AssemblyAI streaming error: {error}")

    async def connect(self):
        """Connects to the AssemblyAI streaming service."""
        self.client = StreamingClient(StreamingClientOptions(api_key=self.api_key))
        self.client.on(StreamingEvents.Turn, self._on_turn)
        self.client.on(StreamingEvents.Error, self._on_error)
        
        await asyncio.to_thread(
            self.client.connect,
            StreamingParameters(
                sample_rate=16000,
                format_turns=True,
                end_of_turn_silence_ms=800
            )
        )

    async def stream_audio(self, audio_bytes: bytes):
        """Streams audio bytes to AssemblyAI."""
        if self.client:
            await asyncio.to_thread(self.client.stream, audio_bytes)

    async def disconnect(self):
        """Disconnects from the AssemblyAI service."""
        if self.client:
            await asyncio.to_thread(self.client.disconnect)
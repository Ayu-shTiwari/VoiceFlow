# murf_service.py

import asyncio
import websockets
import json
import logging
import os
from datetime import datetime

logger = logging.getLogger(__name__)

class MurfWebSocketService:
    """Handles the connection and TTS streaming with Murf AI."""
    def __init__(self, api_key: str, voice_id: str = "en-US-ken"):
        self.api_key = api_key
        self.voice_id = voice_id
        self.ws_url = "wss://api.murf.ai/v1/speech/stream-input"
        self.websocket = None
        self.is_connected = False
        self.static_context_id = f"voice_agent_context_{datetime.now().strftime('%Y%m%d%H%M%S')}"
        self._recv_lock = asyncio.Lock()

    async def connect(self):
        """Establishes the WebSocket connection to Murf."""
        if self.is_connected:
            return
        try:
            connection_url = f"{self.ws_url}?api-key={self.api_key}&sample_rate=44100&channel_type=MONO&format=WAV"
            self.websocket = await websockets.connect(connection_url)
            self.is_connected = True
            logger.info("✅ Connected to Murf WebSocket")
            await self._send_voice_config()
        except Exception as e:
            logger.error(f"Failed to connect to Murf WebSocket: {e}")
            self.is_connected = False
            raise

    async def _send_voice_config(self):
        """Sends the initial voice and context configuration."""
        try:
            voice_config_msg = {
                "voice_config": {"voiceId": self.voice_id, "pitch": -30},
                "context_id": self.static_context_id
            }
            await self.websocket.send(json.dumps(voice_config_msg))
            async with self._recv_lock:
                await asyncio.wait_for(self.websocket.recv(), timeout=3.0)
        except asyncio.TimeoutError:
            logger.warning("Timeout waiting for Murf voice config acknowledgment.")
        except Exception as e:
            logger.error(f"Failed to send Murf voice config: {e}")

    async def disconnect(self):
        """Closes the WebSocket connection."""
        if self.websocket and self.is_connected:
            await self.websocket.close()
            self.is_connected = False
            logger.info("Disconnected from Murf WebSocket")

    async def clear_context(self):
        """Sends a message to Murf to stop any ongoing TTS generation."""
        if not self.is_connected:
            return
        try:
            clear_msg = {"context_id": self.static_context_id, "clear": True}
            await self.websocket.send(json.dumps(clear_msg))
            logger.info("Sent clear context request to Murf.")
        except Exception as e:
            logger.error(f"Error sending clear_context to Murf: {e}")

    async def stream_text_to_audio(self, text_stream):
        """Sends all text chunks first, then listens for the audio response."""
        if not self.is_connected:
            raise ConnectionError("Murf WebSocket is not connected.")

        logger.info("Starting to send LLM chunks to Murf...")
        async for chunk in text_stream:
            if chunk:
                text_msg = {"context_id": self.static_context_id, "text": chunk, "end": False}
                await self.websocket.send(json.dumps(text_msg))
        
        # Step 2: Send the final message to signal the end of the text.
        await self.websocket.send(json.dumps({"context_id": self.static_context_id, "text": "", "end": True}))
        logger.info("Finished sending LLM chunks. Now listening for audio...")

        # Step 3: Now that all text is sent, listen for the complete audio stream.
        # The 'yield from' will pass through all chunks from the listener.
        async for audio_chunk in self._listen_for_audio():
            yield audio_chunk

    async def _listen_for_audio(self):
        """Listens for incoming audio data from Murf."""
        chunk_counter=0
        while True:
            try:
                async with self._recv_lock:
                    response = await asyncio.wait_for(self.websocket.recv(), timeout=10.0)
                data = json.loads(response)
                if "audio" in data:
                    chunk_counter+=1
                    logger.info(f"🎵 Murf audio chunk {chunk_counter} received (final: {data.get('final', False)})")
                    yield {"type": "audio_chunk", "audio_base64": data["audio"], "is_final": data.get("final", False)}
                    if data.get("final"):
                        logger.info(f"🎵 Murf final audio chunk received. Ending stream ...")
                        break
            except asyncio.TimeoutError:
                logger.info(f"🎵 Murf audio chunk receiving timeout. Ending stream ...")
                logger.warning("Timeout waiting for Murf response.")
                break
            except websockets.exceptions.ConnectionClosed:
                break
            except Exception as e:
                logger.error(f"Error receiving from Murf: {e}")
                break
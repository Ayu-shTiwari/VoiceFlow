# THIS IS A TEST FILE FOR CHECKING MURF STREAMING RESPONSE SETUP USING STATIC MESSAGE

import asyncio
import websockets
import json
import base64
from typing import AsyncGenerator
import logging
from datetime import datetime
import os
from dotenv import load_dotenv
load_dotenv()
logger = logging.getLogger(__name__)

class MurfWebSocketService:
    """Murf WebSocket TTS service for streaming text-to-speech"""

    def __init__(self, api_key: str, voice_id: str = "en-US-amara"):
        self.api_key = api_key
        self.voice_id = voice_id
        self.ws_url = "wss://api.murf.ai/v1/speech/stream-input"
        self.websocket = None
        self.is_connected = False
        self.static_context_id = "voice_agent_context_static"
        self._recv_lock = asyncio.Lock()
        self._connecting = False

    async def connect(self):
        """Establish WebSocket connection to Murf"""
        if self._connecting or self.is_connected:
            logger.info("A connection is already established or in progress.")
            return

        self._connecting = True
        try:
            connection_url = f"{self.ws_url}?api-key={self.api_key}&sample_rate=44100&channel_type=MONO&format=WAV"
            self.websocket = await websockets.connect(connection_url)
            self.is_connected = True
            logger.info("✅ Connected to Murf WebSocket")

            await self.clear_context()
            await self._send_voice_config()

        except Exception as e:
            logger.error(f"Failed to connect to Murf WebSocket: {str(e)}")
            self.is_connected = False
            raise
        finally:
            self._connecting = False

    async def _send_voice_config(self):
        """Send voice configuration to Murf WebSocket"""
        try:
            voice_config_msg = {
                "voice_config": {
                    "voiceId": self.voice_id,
                    "style": "Conversational",
                    "rate": 0,
                    "pitch": 0,
                    "variation": 1
                },
                "context_id": self.static_context_id
            }
            logger.info(f"Sending voice config: {voice_config_msg}")
            await self.websocket.send(json.dumps(voice_config_msg))

            async with self._recv_lock:
                try:
                    response = await asyncio.wait_for(self.websocket.recv(), timeout=5.0)
                    logger.info(f"Voice config response: {json.loads(response)}")
                except asyncio.TimeoutError:
                    logger.warning("Timeout waiting for voice config acknowledgment.")

        except Exception as e:
            logger.error(f"Failed to send voice config: {str(e)}")
            raise

    async def disconnect(self):
        """Close WebSocket connection"""
        try:
            if self.websocket and self.is_connected:
                await self.websocket.close()
                self.is_connected = False
                logger.info("Disconnected from Murf WebSocket")
        except Exception as e:
            logger.error(f"Error disconnecting from Murf WebSocket: {str(e)}")

    async def stream_text_to_audio(self, text_stream: AsyncGenerator[str, None]) -> AsyncGenerator[dict, None]:
        """Collect a text stream, send it completely, then yield audio chunks."""
        if not self.is_connected:
            raise Exception("WebSocket not connected. Call connect() first.")

        try:
            # Accumulate the full text from the async generator for best quality
            accumulated_text = "".join([chunk async for chunk in text_stream])
            
            if not accumulated_text.strip():
                logger.warning("No text to stream. Aborting.")
                return

            logger.info(f"Collected complete text (length: {len(accumulated_text)}). Sending to Murf.")
            
            text_msg = {
                "context_id": self.static_context_id,
                "text": accumulated_text,
                "end": True
            }
            
            await self.websocket.send(json.dumps(text_msg))
            
            # Listen for the returning audio stream
            async for audio_response in self._listen_for_audio():
                yield audio_response
                if audio_response.get("type") == "audio_chunk" and audio_response.get("is_final"):
                    break
        except Exception as e:
            logger.error(f"Error in stream_text_to_audio: {str(e)}")
            raise

    async def _listen_for_audio(self) -> AsyncGenerator[dict, None]:
        """Listen for audio responses from Murf WebSocket"""
        while True:
            try:
                async with self._recv_lock:
                    response = await asyncio.wait_for(self.websocket.recv(), timeout=30.0)
                
                data = json.loads(response)
                
                if "audio" in data:
                    yield {
                        "type": "audio_chunk",
                        "audio_base64": data["audio"],
                        "is_final": data.get("final", False)
                    }
                    if data.get("final"):
                        logger.info("Received final audio chunk.")
                        break
                else:
                    logger.info(f"Received non-audio response: {data}")

            except asyncio.TimeoutError:
                logger.warning("Timeout waiting for Murf response.")
                break
            except websockets.exceptions.ConnectionClosed:
                logger.info("Murf WebSocket connection closed.")
                break
            except Exception as e:
                logger.error(f"Error receiving from Murf WebSocket: {str(e)}")
                break

    async def clear_context(self):
        """Clear the current context on the server."""
        if not self.websocket or not self.is_connected:
            return
        try:
            clear_msg = {"context_id": self.static_context_id, "clear": True}
            logger.info("Clearing Murf context.")
            await self.websocket.send(json.dumps(clear_msg))
            
            async with self._recv_lock:
                try:
                    response = await asyncio.wait_for(self.websocket.recv(), timeout=3.0)
                    logger.info(f"Context clear response: {json.loads(response)}")
                except asyncio.TimeoutError:
                    logger.warning("Timeout waiting for context clear acknowledgment.")
        except Exception as e:
            logger.error(f"Error clearing context: {str(e)}")
            
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

# The static sentence we want to convert to speech
TEST_SENTENCE = "Hello, this is a test of the Murf text-to-speech streaming service. This implementation ensures high-quality audio by sending the complete text at once."

async def text_chunk_generator(text: str) -> AsyncGenerator[str, None]:
    """An async generator that yields words from a sentence to simulate a text stream."""
    words = text.split()
    logging.info(f"Starting to provide {len(words)} words to the service...")
    for word in words:
        yield word + " "
        await asyncio.sleep(0.05) # Simulate a fast stream
    logging.info("Finished providing all text chunks.")


async def main():
    """Main function to connect, stream text, receive audio, and save it."""
    api_key = os.getenv("MURF_API_KEY")
    if not api_key:
        logging.error("MURF_API_KEY environment variable not set. Please set it before running.")
        return

    murf_service = MurfWebSocketService(api_key=api_key)
    all_audio_data = []

    try:
        await murf_service.connect()
        text_stream = text_chunk_generator(TEST_SENTENCE)

        chunk_count = 0
        async for response in murf_service.stream_text_to_audio(text_stream):
            if response.get("type") == "audio_chunk":
                chunk_count += 1
                audio_bytes = base64.b64decode(response["audio_base64"])
                all_audio_data.append(audio_bytes)
                logging.info(f"Received and decoded audio chunk #{chunk_count} ({len(audio_bytes)} bytes)")
    
    except Exception as e:
        logging.error(f"An error occurred during the streaming test: {e}")

    finally:
        await murf_service.disconnect()

    if all_audio_data:
        output_filename = "murf_streaming_output.wav"
        full_audio = b"".join(all_audio_data)
        
        with open(output_filename, "wb") as audio_file:
            audio_file.write(full_audio)
        
        logging.info(f"✅ Successfully saved complete audio ({len(full_audio)} bytes) to {output_filename}")
    else:
        logging.warning("No audio data was received to save.")


if __name__ == "__main__":
    asyncio.run(main())            
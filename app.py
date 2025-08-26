# app.py
import os
import logging
import base64
from datetime import datetime
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
import asyncio

# Import the refactored services
from services.murf_service import MurfWebSocketService
from services.streaming_llm import LLMService
from services.assembly_service import AssemblyAIService

# --- Setup ---
load_dotenv()
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# --- FastAPI Routes ---
@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

# --- WebSocket Endpoint ---
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("🎤 Client connected via WebSocket")
    
    loop = asyncio.get_running_loop()
    llm_task = None

    # --- Service Initialization ---
    murf_service = MurfWebSocketService()
    llm_service = LLMService()

    def send_websocket_message(message_type, **kwargs):
        if websocket.client_state.name == 'CONNECTED':
            asyncio.run_coroutine_threadsafe(websocket.send_json({"type": message_type, **kwargs}), loop)

    async def llm_and_murf_pipeline(transcript: str):
        nonlocal llm_task
        try:
            llm_stream = llm_service.get_response_stream(transcript)
            
            async def tts_chunk_generator():
                async for chunk_data in llm_stream:
                    send_websocket_message("llm_response", chunk=chunk_data["ui_chunk"])
                    yield chunk_data["tts_chunk"]
            
            audio_generator = murf_service.stream_text_to_audio(tts_chunk_generator())
            
            all_audio_data = []
            audio_chunk_count = 0
            async for response in audio_generator:
                if response.get("type") == "audio_chunk":
                    audio_chunk_count += 1
                    send_websocket_message("audio", audio_chunk=response["audio_base64"])
                    all_audio_data.append(base64.b64decode(response["audio_base64"]))
            
            logger.info(f"Received a total of {audio_chunk_count} audio chunks from Murf.")
            if all_audio_data:
                output_dir = os.path.join("media", "murf_responses")
                os.makedirs(output_dir, exist_ok=True)
                output_filename = f"llm_response_{datetime.now().strftime('%Y%m%d_%H%M%S')}.wav"
                output_path = os.path.join(output_dir, output_filename)
                with open(output_path, "wb") as audio_file:
                    audio_file.write(b"".join(all_audio_data))
                logger.info(f"✅ Successfully saved Murf audio to {output_path}")

            send_websocket_message("llm_response_end")

        except Exception as e:
            logger.error(f"Error in LLM/Murf pipeline: {e}")
        finally:
            # Reset the lock to allow the next turn
            llm_task = None

   
    def handle_assemblyai_turn(transcript: str, is_final: bool):
        nonlocal llm_task
        if not transcript:
            return

        send_websocket_message("transcript", transcript=transcript, is_final=is_final)
        
        # CRITICAL FIX: Check the lock *before* scheduling the async task.
        # This prevents the race condition.
        if is_final and not llm_task:
            llm_task = asyncio.run_coroutine_threadsafe(
                llm_and_murf_pipeline(transcript), loop
            )

    # Pass the new handler function to the service
    assembly_service = AssemblyAIService(on_turn_callback=handle_assemblyai_turn)

    try:
        await asyncio.gather(
            assembly_service.connect(),
            murf_service.connect()
        )
        
        while True:
            data = await websocket.receive()
            if data.get("type") == "interrupt":
                logger.info("Received interrupt signal from client.")
                if llm_task and not llm_task.done():
                    llm_task.cancel() # Cancel the server-side pipeline
                await murf_service.clear_context() # Tell Murf to stop TTS
                continue
            if "bytes" in data:
                await assembly_service.stream_audio(data["bytes"])

    except WebSocketDisconnect:
        logger.info("Client disconnected")
    finally:
        # Graceful cleanup
        if llm_task and not llm_task.done():
            llm_task.cancel()
        await asyncio.gather(
            assembly_service.disconnect(),
            murf_service.disconnect()
        )
        logger.info("Cleanup complete.")
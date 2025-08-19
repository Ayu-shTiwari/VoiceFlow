import os
import logging
from fastapi import FastAPI,Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
import assemblyai as aai
from assemblyai.streaming.v3 import (
    StreamingClient,
    StreamingClientOptions,
    StreamingEvents,
    StreamingParameters,
    BeginEvent,
    TurnEvent,
    TerminationEvent,
    StreamingError,
)
import asyncio

load_dotenv()
ASSEMBLYAI_API_KEY = os.getenv("ASSEMBLYAI_API_KEY")
if not ASSEMBLYAI_API_KEY:
    raise RuntimeError("ASSEMBLYAI_API_KEY not found in .env file.")
aai.settings.api_key = ASSEMBLYAI_API_KEY

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

# FastAPI setup
app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    """Serves the main HTML page."""
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse("static/favicon.ico")

# --- AssemblyAI Transcriber ---

def on_begin(client: StreamingClient, event: BeginEvent):
    logging.info(f"AssemblyAI Session started: {event.id}")

def on_turn(client: StreamingClient, event: TurnEvent):
    # Print live transcription text
    logging.info(f"Transcript: {event.transcript} (End of turn: {event.end_of_turn})")

def on_terminated(client: StreamingClient, event: TerminationEvent):
    logging.info(f"Session terminated after {event.audio_duration_seconds} seconds")

def on_error(client: StreamingClient, error: StreamingError):
    logging.error(f"AssemblyAI streaming error: {error}")

# --- WebSocket Endpoint ---

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logging.info("🎤 Client connected via WebSocket")
    
    file_path = "recorded_audio.webm"
    if os.path.exists(file_path):
        os.remove(file_path)
    logging.info(f"WebSocket connected. Writing audio to {file_path}")
    client = StreamingClient(
        StreamingClientOptions(
            api_key=aai.settings.api_key,
            api_host="streaming.assemblyai.com"
        )
    )
    client.on(StreamingEvents.Begin, on_begin)
    client.on(StreamingEvents.Turn, on_turn)
    client.on(StreamingEvents.Termination, on_terminated)
    client.on(StreamingEvents.Error, on_error)
    
    client.connect(
        StreamingParameters(
            sample_rate=16000, 
            format_turns=True,
        )
    )
    try:
        while True:
            data = await websocket.receive()
            if "bytes" in data:
                # Data is already PCM16, send directly to AssemblyAI in a thread.
                await asyncio.to_thread(client.stream, data["bytes"])
            elif "text" in data and data["text"] == "END":
                msg = data["text"]
                logging.info(f"Text msg from received: {msg}")
                await asyncio.to_thread(client.disconnect)
                break
    except WebSocketDisconnect:
        logging.info(f"Client disconnected")
    finally:
        # Make sure the streaming client is closed
        await asyncio.to_thread(client.disconnect)


import os
import logging
from urllib import response
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
import google.generativeai as genai
import asyncio


load_dotenv()
ASSEMBLYAI_API_KEY = os.getenv("ASSEMBLYAI_API_KEY")
if not ASSEMBLYAI_API_KEY:
    raise RuntimeError("ASSEMBLYAI_API_KEY not found in .env file.")
aai.settings.api_key = ASSEMBLYAI_API_KEY


GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY not found in .env file.")
genai.configure(api_key=GEMINI_API_KEY)

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

# --- WebSocket Endpoint ---

                        # ---- LLM logic ---
async def llm_response(text: str):
    logging.info(f"LLM Simulation received text: '{text}")
    response = f"You said '{text}. That's interesting! I am now streaming a response back to you chunk by chunk."
    chunks = response.split()
    for chunk  in chunks:
        yield chunk + ""
        await asyncio.sleep(0.1)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logging.info("🎤 Client connected via WebSocket")
    
    # Get the current event loop to schedule tasks from another thread
    loop = asyncio.get_running_loop()
    llm_response_task = False
    # --- asynchronous function to handle llm streaming
    async def handle_llm_streaming(transcript: str):
        nonlocal llm_response_task
        logging.info(f"--- Starting LLM streaming")
        try:
            model = genai.GenerativeModel(
            'gemini-1.5-flash-latest',
            system_instruction="You are a helpful voice assistant. Keep your responses concise and conversational."
            )
            response_stream = await model.generate_content_async(transcript, stream=True)
            response = ""
             
            async for chunk in response_stream:
                if hasattr(chunk, 'text') and chunk.text:
                    text = chunk.text
                    response += text
                    print(text, end = "", flush=True)
                    await websocket.send_json({
                        "type": "llm_response",
                        "chunk": text
                    })
            print("\n")
            await websocket.send_json({
                "type": "llm_response_end"
            })
            logging.info(f"--- LLM Stream Complete. Full Response: '{response.strip()}' ---")
        except Exception as e:
            logging.error(f"Error during LLM streaming: {e}")
        finally: 
            llm_response_task = False
        
    # Define synchronous callbacks, not async ones
    def on_begin(client: StreamingClient, event: BeginEvent):
        logging.info(f"AssemblyAI Session started: {event.id}")

    def on_turn(client: StreamingClient, event: TurnEvent):
        nonlocal llm_response_task
        transcript = event.transcript
        is_final = event.end_of_turn
        logging.info(f"Transcript: {transcript} (End of turn: {is_final})")
        
        if transcript:
            # Create a coroutine to send the JSON data
            asyncio.run_coroutine_threadsafe(
                websocket.send_json({
                    "type": "transcript",
                    "transcript": transcript,
                    "is_final": is_final
                }), loop
            )
            if is_final and not llm_response_task:
                llm_response_task = True
            # Schedule the coroutine on the main event loop from the current thread
                asyncio.run_coroutine_threadsafe(handle_llm_streaming(transcript), loop)

    def on_terminated(client: StreamingClient, event: TerminationEvent):
        logging.info(f"Session terminated after {event.audio_duration_seconds} seconds")

    def on_error(client: StreamingClient, error: StreamingError):
        logging.error(f"AssemblyAI streaming error: {error}")

    # Initialize the AssemblyAI streaming client
    client = StreamingClient(
        StreamingClientOptions(api_key=aai.settings.api_key)
    )
    
    # Register the synchronous event handlers
    client.on(StreamingEvents.Begin, on_begin)
    client.on(StreamingEvents.Turn, on_turn)
    client.on(StreamingEvents.Termination, on_terminated)
    client.on(StreamingEvents.Error, on_error)
    
    # Connect to the streaming service in a separate thread
    await asyncio.to_thread(
        client.connect,
        StreamingParameters(
            sample_rate=16000, 
            format_turns=True,
            end_of_turn_silence_ms=1200,
        )
    )
    
    try:
        # Main loop to receive audio data from the client
        while True:
            data = await websocket.receive()
            if "bytes" in data:
                # Stream audio bytes to AssemblyAI in a separate thread
                await asyncio.to_thread(client.stream, data["bytes"])
            elif "text" in data and data["text"] == "END":
                logging.info("END message received. Closing connection.")
                await asyncio.to_thread(client.disconnect)
                break
    except WebSocketDisconnect:
        logging.info("Client disconnected")
    finally:
        # Ensure the client is disconnected on exit
        await asyncio.to_thread(client.disconnect)
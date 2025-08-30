# app.py
import os
import json
import logging
import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
import asyncio

# Import the refactored services
from services.murf_service import MurfWebSocketService
from services.streaming_llm import LLMService
from services.assembly_service import AssemblyAIService
from services.config_service import load_keys_from_file, save_keys_to_file, validate_keys
from schemas.chat_schemas import ApiKeys

# --- Setup ---
load_dotenv()
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

HISTORY_FILE = "chat_history.json"
KEYS_FILE = "api_keys.json"
chat_histories = {}
history_lock = asyncio.Lock()

def load_history():
    """Safely loads chat history from the JSON file."""
    global chat_histories
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, "r") as f:
                if os.path.getsize(HISTORY_FILE) > 0:
                    chat_histories = json.load(f)
                    logger.info("✅ Chat history loaded successfully.")
                else:
                    chat_histories = {}
        except (json.JSONDecodeError, IOError) as e:
            logger.error(f"❌ Error loading history file: {e}. Starting fresh.")
            chat_histories = {}
    else:
        logger.warning("⚠️ No history file found. Starting fresh.")
        chat_histories = {}
        
async def save_history():
    """Saves the in-memory chat history to the JSON file."""
    async with history_lock:
        with open(HISTORY_FILE, "w") as f:
            json.dump(chat_histories, f, indent=4)
    logger.info("Session history saved.")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manages startup and shutdown events."""
    logger.info("Server is starting up...")
    load_history()
    yield
    logger.info("Server is shutting down. Saving history...")
    await save_history()
    with open(KEYS_FILE, "w") as f: json.dump({}, f)
    chat_histories.clear()
    logger.info("Final history save complete.")
    
# --- FastAPI Routes ---

app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/config/keys", response_class=JSONResponse)
async def get_saved_keys():
    return load_keys_from_file()
    
@app.post("/config/keys", response_class=JSONResponse)
async def save_and_validate_keys(keys: ApiKeys):
    key_dict = keys.dict()
    save_keys_to_file(key_dict)
    validation = await validate_keys(key_dict)
    return validation
    
@app.post("/config/clear_keys", response_class=JSONResponse)
async def clear_saved_keys():
    try:
        with open(KEYS_FILE,"w") as f:
            json.dumps({},f) 
        logger.info("API keys file has been cleared by user request.")
        return {"status": "success", "message": "API keys cleared."}  
    except Exception as e:
        logger.error(f"Failed to clear Api Keys file: {e}")
        return {"status": "error", "message": "Could not clear API keys."}

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse("static/favicon.ico")

@app.get("/history/sessions", response_class=JSONResponse)
async def get_session_history():
    sessions = []
    # Get the latest chat histories from file
    current_chat_histories = {}
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, "r") as f:
                if os.path.getsize(HISTORY_FILE) > 0:
                    current_chat_histories = json.load(f)
        except (json.JSONDecodeError, IOError):
            current_chat_histories = {}
    
    # Create sessions list from chat histories
    for session_id, history in current_chat_histories.items():
        if history and len(history) > 0:
            # Find the first user message to use as title
            first_user_message = ""
            for message in history:
                if message.get("role") == "user" and message.get("parts"):
                    first_user_message = message["parts"][0]
                    break
            
            if first_user_message:
                # Create a short title from the first user message
                title = first_user_message[:35] + "..." if len(first_user_message) > 35 else first_user_message
                sessions.append({"id": session_id, "title": title})
    
    # Sort by session_id (most recent first)
    sessions.sort(key=lambda x: x["id"], reverse=True)
    
    # Return last 20 sessions
    return sessions

# --- WebSocket Endpoint ---
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    
    logger.info("🎤 Client connected via WebSocket")
    session_id = None
    history = []
    
    try:
        initial_data = await asyncio.wait_for(websocket.receive_text(), timeout=10)
        payload = json.loads(initial_data)
        session_id = payload.get("session_id")
        api_keys = payload.get("api_keys")
        
        if not all((session_id, api_keys)):
            await websocket.close(code=1008, reason="Session ID or Api keys not provided.")
            return
        
        logger.info(f"Client connected with session_id: {session_id}")
        # Use setdefault to get or create the session history
        if session_id in chat_histories:
                history = chat_histories[session_id]
                logger.info(f"Loaded existing session with {len(history)} messages")
        else:
                history = []
                logger.info(f"Created new session: {session_id}")
            
            # Always update chat_histories with current session reference
        chat_histories[session_id] = history
            
            # Send existing history to client if available
        if history and len(history) > 0:
            await websocket.send_json({"type": "history", "data": history})
            logger.info(f"Sent {len(history)} messages to client for session {session_id}")

    except (asyncio.TimeoutError, json.JSONDecodeError, KeyError):
        await websocket.close(code=1008, reason="Invalid initialization")
        return
    
    loop = asyncio.get_running_loop()
    llm_task = None

    # --- Service Initialization ---
    murf_service = MurfWebSocketService(api_key=api_keys.get("MURF_API_KEY"))
    llm_service = LLMService(api_key=api_keys.get("GEMINI_API_KEY"))

    def send_websocket_message(message_type, **kwargs):
        if websocket.client_state.name == 'CONNECTED':
            asyncio.run_coroutine_threadsafe(websocket.send_json({"type": message_type, **kwargs}), loop)

    async def llm_and_murf_pipeline(transcript: str):
        nonlocal llm_task, history
        llm_response = ""
        try:
            llm_stream = llm_service.get_response_stream(history, transcript)
            history.append({"role": "user", "parts": [transcript]})
            async def tts_chunk_generator():
                nonlocal llm_response
                async for chunk_data in llm_stream:
                    llm_response += chunk_data["ui_chunk"]
                    send_websocket_message("llm_response", chunk=chunk_data["ui_chunk"])
                    yield chunk_data["tts_chunk"]
            
            audio_generator = murf_service.stream_text_to_audio(tts_chunk_generator())
            
            audio_chunk_count = 0
            async for response in audio_generator:
                if response.get("type") == "audio_chunk":
                    audio_chunk_count += 1
                    send_websocket_message("audio", audio_chunk=response["audio_base64"])
                
            logger.info(f"Received a total of {audio_chunk_count} audio chunks from Murf.")
            send_websocket_message("llm_response_end")

            if llm_response:
                history.append({"role": "assistant", "parts": [llm_response]})
                # *** SAVE HISTORY AFTER THE TURN IS COMPLETE ***
                await save_history()
                
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
        
        if is_final and not llm_task:
            llm_task = asyncio.run_coroutine_threadsafe(
                llm_and_murf_pipeline(transcript), loop
            )

    # Pass the new handler function to the service
    assembly_service = AssemblyAIService(api_key=api_keys.get("ASSEMBLYAI_API_KEY"), on_turn_callback=handle_assemblyai_turn)

    try:
        await asyncio.gather(
            assembly_service.connect(),
            murf_service.connect()
        )
        
        while True:
            data = await websocket.receive()
            if "text" in data:
                message = json.loads(data["text"])
                if message.get("type") == "interrupt":
                    logger.info("Received interrupt signal from client.")
                    if llm_task and not llm_task.done():
                        llm_task.cancel()
                    await murf_service.clear_context()
            
            # Case 2: The message is a binary audio message
            elif "bytes" in data:
                # This is where the audio gets sent to AssemblyAI
                await assembly_service.stream_audio(data["bytes"])

    except WebSocketDisconnect:
        logger.info(f"Client with session_id: {session_id} disconnected")
    finally:
        # Graceful cleanup
        if llm_task and not llm_task.done():
            llm_task.cancel()
        await asyncio.gather(
            assembly_service.disconnect(),
            murf_service.disconnect()
        )
        logger.info(f"Cleanup complete for session_id: {session_id}")
        

if __name__ == "__main__":
    # The port will be set by Render, default to 8000 for local testing
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)        
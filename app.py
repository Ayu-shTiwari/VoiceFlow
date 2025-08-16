import os
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Union

from fastapi import FastAPI, Request, File, UploadFile
from fastapi import WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
import asyncio

load_dotenv()

# --- service Imports ---
from schemas.chat_schemas import ChatResponse, ErrorResponse
from services import stt_service, llm_service, tts_service

# --- 2. INITIAL SETUP & CONFIGURATION ---

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# History and Fallback File Paths
HISTORY_FILE = "chat_history.json"
FALLBACK_AUDIO_PATH = Path("static/fallback_audio.mp3")
FALLBACK_ERROR_TEXT = "I'm having a little trouble connecting right now. Please try again in a moment."

chat_histories = {}
history_lock = asyncio.Lock()

# --- 3. HELPER FUNCTIONS (for history management) ---

def load_history():
    """Safely loads chat history from the JSON file."""
    global chat_histories
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, "r") as f:
                if os.path.getsize(HISTORY_FILE) > 0:
                    chat_histories = json.load(f)
                    logging.info("✅ Chat history loaded successfully.")
                else:
                    logging.warning("⚠️ History file is empty. Starting fresh.")
                    chat_histories = {}
        except (json.JSONDecodeError, IOError) as e:
            logging.error(f"❌ Error loading history file: {e}. Starting fresh.")
            chat_histories = {}
    else:
        logging.warning("⚠️ No history file found. Starting fresh.")
        chat_histories = {}

async def save_history():
    """Saves the in-memory chat history to the JSON file."""
    async with history_lock:
        with open(HISTORY_FILE, "w") as f:
            json.dump(chat_histories, f, indent=4)
        

# --- 4. FASTAPI LIFESPAN MANAGER ---

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manages startup and shutdown events."""
    logging.info("Server is starting up...")
    if not FALLBACK_AUDIO_PATH.exists():
        logging.info("Generating fallback audio...")
        try:
            audio_url = tts_service.generate_audio(FALLBACK_ERROR_TEXT)
            import requests
            audio_response = requests.get(audio_url)
            audio_response.raise_for_status()
            with open(FALLBACK_AUDIO_PATH, "wb") as f:
                f.write(audio_response.content)
            logging.info("Fallback audio generated successfully.")
        except Exception as e:
            logging.critical(f"Could not generate fallback audio: {e}")
      
    load_history()
    yield
    logging.info("Server is shutting down. Saving history...")
    save_history()

# --- 5. FASTAPI APP INITIALIZATION ---

app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# --- 6. API ENDPOINTS ---

@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    """Serves the main HTML page."""
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse("static/favicon.ico")

@app.get("/agent/history/{session_id}")
async def get_history(session_id: str):
    """Retrieves the chat history for a given session ID."""
    return chat_histories.get(session_id, [])

@app.post("/agent/chat/{session_id}", response_model=Union[ChatResponse, ErrorResponse])
async def agent_chat(session_id: str, audio_file: UploadFile = File(...)):
    """Handles a full conversational turn with robust error handling."""
    try:
        audio_data = await audio_file.read()

        # --- Step 1: Call STT Service with specific error handling ---
        try:
            user_text = stt_service.transcribe_audio(audio_data)
            if not user_text:
                 return ChatResponse(responseText="I didn't hear anything.", transcribedText="", error=False)
        except Exception as e:
            logging.error(f"STT Service Error: {e}")
            raise Exception("The speech-to-text service is unavailable.") from e

        # --- Step 2: Call LLM Service with specific error handling ---
        try:
            session_history = chat_histories.get(session_id, [])
            llm_text = llm_service.get_llm_response(user_text, session_history)
        except Exception as e:
            logging.error(f"LLM Service Error: {e}")
            raise Exception("The AI model is currently unavailable.") from e

        # --- Step 3: Call TTS Service with specific error handling ---
        try:
            audio_url = tts_service.generate_audio(llm_text)
        except Exception as e:
            logging.error(f"TTS Service Error: {e}")
            raise Exception("The text-to-speech service is unavailable.") from e

        # --- Step 4: Update and Save History ---
        session_history.append({"role": "user", "content": user_text})
        session_history.append({"role": "assistant", "content": llm_text})
        chat_histories[session_id] = session_history
        await save_history()

        # --- Step 5: Return Success Response ---
        return ChatResponse(
            audioUrl=audio_url,
            transcribedText=user_text,
            responseText=llm_text
        )

    except Exception as e:
        # This is now the final catch-all for our specific, raised exceptions
        logging.error(f"An internal server error: {e}")
        return ErrorResponse(
            fallbackAudioUrl=str(FALLBACK_AUDIO_PATH),
            errorMessage=str(e),
            responseText=FALLBACK_ERROR_TEXT
        )
       
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    Handles the WebSocket connection.
    It accepts a connection and then enters a loop to listen for messages.
    Any message it receives, it simply "echoes" back to the client.
    """
    await websocket.accept()
    logging.info("websocket connection established.")
    try:
        while True:
            data= await websocket.receive_text()
            logging.info(f"Recieved message via websocket: {data}")
            
            response = f"server echoes: {data}"
            await websocket.send_text(response)
            logging.info(f"Sent message via Websocket: {response}")
    
    except WebSocketDisconnect:
        logging.info("websocket client disconnected.")
    except Exception as e:
        logging.error(f"error occurred in websocket endpoint: {e}")
    finally:
        logging.info("websocket connection closed.")                
            
        
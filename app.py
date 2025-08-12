import os
import requests
import json
import re
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, File, UploadFile
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv

import assemblyai as aai
import google.generativeai as genai

# --- 1. INITIAL SETUP & CONFIGURATION ---

load_dotenv()

# API Key Configuration
MURF_API_URL = "https://api.murf.ai/v1/speech/generate"
MURF_API_KEY = os.getenv("MURF_API_KEY")
ASSEMBLYAI_API_KEY = os.getenv("ASSEMBLYAI_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if not all([MURF_API_KEY, ASSEMBLYAI_API_KEY, GEMINI_API_KEY]):
    raise RuntimeError("One or more API keys are missing from the .env file.")

#aai.settings.api_key = ASSEMBLYAI_API_KEY
genai.configure(api_key=GEMINI_API_KEY)

# History and Fallback File Paths
HISTORY_FILE = "chat_history.json"
FALLBACK_AUDIO_PATH = Path("static/fallback_audio.mp3")
FALLBACK_ERROR_TEXT = "I'm having a little trouble connecting right now. Please try again in a moment."

chat_histories = {}

# --- 2. HELPER FUNCTIONS ---

def load_history():
    """Safely loads chat history from the JSON file."""
    global chat_histories
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, "r") as f:
                if os.path.getsize(HISTORY_FILE) > 0:
                    chat_histories = json.load(f)
                    print("✅ Chat history loaded successfully.")
                else:
                    print("⚠️ History file is empty. Starting fresh.")
                    chat_histories = {}
        except (json.JSONDecodeError, IOError) as e:
            print(f"❌ Error loading history file: {e}. Starting fresh.")
            chat_histories = {}
    else:
        print("⚠️ No history file found. Starting fresh.")
        chat_histories = {}

def save_history():
    """Saves the in-memory chat history to the JSON file."""
    with open(HISTORY_FILE, "w") as f:
        json.dump(chat_histories, f, indent=4)

def generate_fallback_audio():
    """Generates a fallback audio file on server startup if it doesn't exist."""
    if FALLBACK_AUDIO_PATH.exists():
        print("✅ Fallback audio already exists.")
        return
    print("Generating fallback audio...")
    try:
        headers = {"Content-Type": "application/json", "api-key": MURF_API_KEY}
        payload = {
            "text": "I'm having a little trouble connecting right now. Please try again in a moment.",
            "voice_id": "en-US-miles"
        }
        response = requests.post(MURF_API_URL, headers=headers, json=payload, timeout=30)
        response.raise_for_status()
        
        audio_url = response.json().get("audioFile")
        if not audio_url: raise Exception("Murf API did not return an audio file URL.")
        
        audio_response = requests.get(audio_url, timeout=30)
        audio_response.raise_for_status()

        with open(FALLBACK_AUDIO_PATH, "wb") as f:
            f.write(audio_response.content)
        print("✅ Fallback audio generated successfully.")
    except Exception as e:
        print(f"❌ CRITICAL: Could not generate fallback audio: {e}")

def split_text_into_chunks(text, chunk_size=2800):
    """Splits text into chunks for the TTS API."""
    # This function remains unchanged
    chunks = []
    sentences = re.split(r'(?<=[.!?])\s+', text)
    current_chunk = ""
    for sentence in sentences:
        if len(current_chunk) + len(sentence) + 1 < chunk_size:
            current_chunk += sentence + " "
        else:
            chunks.append(current_chunk.strip())
            current_chunk = sentence + " "
    if current_chunk:
        chunks.append(current_chunk.strip())
    return chunks

# --- 3. FASTAPI LIFESPAN MANAGER ---

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manages startup and shutdown events."""
    print("Server is starting up...")
    generate_fallback_audio()
    load_history()
    yield
    print("Server is shutting down. Saving history...")
    save_history()

# --- 4. FASTAPI APP INITIALIZATION ---

app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# --- 5. PYDANTIC MODELS ---

class TTSRequest(BaseModel):
    text: str

# --- 6. API ENDPOINTS ---

@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    """Serves the main HTML page."""
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse("static/favicon.ico")

@app.post("/tts/generate")
async def generate_tts_endpoint(request_body: TTSRequest):
    """Endpoint for the simple Text-to-Speech functionality."""
    # This endpoint remains largely unchanged, but simplified for clarity
    try:
        headers = {"Content-Type": "application/json", "api-key": MURF_API_KEY}
        payload = {"text": request_body.text, "voice_id": "en-US-miles"}
        response = requests.post(MURF_API_URL, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
        if "audioFile" in data:
            return {"audioUrl": data["audioFile"]}
        else:
            raise HTTPException(status_code=500, detail="TTS API did not return an audio file.")
    except Exception as e:
        print(f"TTS generation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/agent/history/{session_id}")
async def get_history(session_id: str):
    """Retrieves the chat history for a given session ID."""
    return chat_histories.get(session_id, [])

@app.post("/agent/chat/{session_id}")
async def agent_chat(session_id: str, audio_file: UploadFile = File(...)):
    """Handles a full conversational turn with robust error handling."""
    try:
        # --- Step 1: Transcribe Audio ---
        try:
            audio_data = await audio_file.read()
            transcriber = aai.Transcriber()
            transcript = transcriber.transcribe(audio_data)
            if transcript.status == aai.TranscriptStatus.error:
                raise Exception(f"Transcription failed: {transcript.error}")
            user_text = transcript.text
            if not user_text:
                return {"audioUrl": None, "responseText": "I didn't hear anything.", "transcribedText": "", "error": False}
        except Exception as e:
            print(f"❌ STT Error: {e}")
            raise HTTPException(status_code=503, detail="The speech-to-text service is unavailable.")

        # --- Step 2: Call LLM ---
        try:
            session_history_json = chat_histories.get(session_id, [])
            gemini_formatted_history = [{'role': 'model' if msg['role'] == 'assistant' else 'user', 'parts': [msg['content']]} for msg in session_history_json]
            
            model = genai.GenerativeModel('gemini-1.5-flash-latest')
            chat = model.start_chat(history=gemini_formatted_history)
            llm_response = chat.send_message(user_text)
            llm_text = llm_response.text

            # Update history and save
            final_history_for_json = [{'role': 'assistant' if msg.role == 'model' else 'user', 'content': msg.parts[0].text} for msg in chat.history]
            chat_histories[session_id] = final_history_for_json
            save_history()
        except Exception as e:
            print(f"❌ LLM Error: {e}")
            raise HTTPException(status_code=503, detail="The AI model is currently unavailable.")

        # --- Step 3: Synthesize Speech ---
        try:
            first_chunk = split_text_into_chunks(llm_text)[0]
            headers = {"Content-Type": "application/json", "api-key": MURF_API_KEY}
            murf_payload = {"text": first_chunk, "voice_id": "en-US-miles"}
            murf_response = requests.post(MURF_API_URL, headers=headers, json=murf_payload, timeout=30)
            murf_response.raise_for_status()
            audio_url = murf_response.json().get("audioFile")
            if not audio_url: raise Exception("TTS API did not return an audio file.")
        except Exception as e:
            print(f"❌ TTS Error: {e}")
            raise HTTPException(status_code=503, detail="The text-to-speech service is unavailable.")

        # --- Step 4: Return Success Response ---
        return {"audioUrl": audio_url, "transcribedText": user_text, "responseText": llm_text, "error": False}

    except HTTPException as e:
        return {"fallbackAudioUrl": str(FALLBACK_AUDIO_PATH), "error": True, "errorMessage": e.detail, "responseText": FALLBACK_ERROR_TEXT}
    except Exception as e:
        print(f"❌ An unexpected error occurred in agent_chat: {e}")
        return {"fallbackAudioUrl": str(FALLBACK_AUDIO_PATH), "error": True, "errorMessage": "An unexpected server error occurred.", "responseText": FALLBACK_ERROR_TEXT}
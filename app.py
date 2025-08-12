import os
import requests
from fastapi import FastAPI, HTTPException, Request, File, UploadFile, Form
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import assemblyai as aai
import google.generativeai as genai
import re
import json
from contextlib import asynccontextmanager



load_dotenv()
app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# --- 2. API KEY CONFIGURATION ---

MURF_API_URL = "https://api.murf.ai/v1/speech/generate"
MURF_API_KEY = os.getenv("MURF_API_KEY")
if not MURF_API_KEY:
    raise RuntimeError("MURF_API_KEY not found in .env file.")

ASSEMBLYAI_API_KEY = os.getenv("ASSEMBLYAI_API_KEY")
if not ASSEMBLYAI_API_KEY:
    raise RuntimeError("ASSEMBLYAI_API_KEY not found in .env file.")
aai.settings.api_key = ASSEMBLYAI_API_KEY

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY not found in .env file.")
genai.configure(api_key=GEMINI_API_KEY)


# --- new chat history setup ---
HISTORY_FILE = "chat_history.json"
# 2. This dictionary will hold all conversation histories while the server is running.
chat_histories = {}
def load_history():
    """
    Safely loads history from the JSON file.
    Handles errors if the file is empty or corrupted.
    """
    global chat_histories
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, "r") as f:
                # We check if the file is not empty before trying to load
                if os.path.getsize(HISTORY_FILE) > 0:
                    chat_histories = json.load(f)
                    print("✅ Chat history loaded successfully.")
                else:
                    print("⚠️ History file is empty. Starting fresh.")
                    chat_histories = {} # Ensure it's a clean dict
        except (json.JSONDecodeError, IOError) as e:
            # If file is corrupted or can't be read, start with an empty history
            print(f"❌ Error loading history file: {e}. Starting with a fresh history.")
            chat_histories = {}
    else:
        print("⚠️ No history file found. Starting fresh.")
        chat_histories = {}


def save_history():
    """Saves the in-memory chat_histories dict to the JSON file."""
    with open(HISTORY_FILE, "w") as f:
        json.dump(chat_histories, f, indent=4)


# --- UPDATED: Lifespan manager with shutdown saving ---

# --- 3. PYDANTIC MODELS ---

class TTSRequest(BaseModel):
    text: str
    voice_id: str = "en-US-miles"  # Optional: set a default voice
    format: str = "mp3"       # Optional: set a default format
    quality: str = "high"    # Optional: set a default quality
    style: str = "newscast"  # Optional: set a default style

class LLMQueryRequest(BaseModel):
    text: str

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Manages startup and shutdown events.
    """
    # --- Startup ---
    print("Server is starting up...")
    load_history()
    
    yield # The application runs here
    
    # --- Shutdown ---
    print("Server is shutting down. Saving history...")
    save_history()
    
@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse("static/favicon.ico")

@app.get("/",response_class=HTMLResponse)
async def read_root(request: Request):
    """
    This endpoint is triggered when a user goes to the main page (the "/" path).
    It uses the template engine to find "index.html" and sends it back.
    """
    return templates.TemplateResponse("index.html", {"request": request})


                    # ---4 API Endpoint for Text-to-Speech ---

@app.post("/tts/generate")
async def generate_tts(request_body: TTSRequest):
    """
    Accepts text and other optional parameters, calls the Murf AI TTS API,
    and returns the URL of the generated audio file.
    """
    # 1. Set up the headers for the Murf API request
    headers = {
        "Content-Type": "application/json",
        "api-key": MURF_API_KEY
    }

    # 2. Create the payload with the data from our endpoint's request
    payload = {
        "text": request_body.text,
        "voice_id": request_body.voice_id,
        "format": request_body.format,
        "quality": request_body.quality,
        "style": request_body.style
    }

    try:
        # 3. Make the POST request to the Murf AI API
        response = requests.post(MURF_API_URL, headers=headers, json=payload)

        # 4. Raise an exception if the API call was not successful
        response.raise_for_status()

        # 5. Parse the JSON response from Murf
        murf_response_data = response.json()
        # 6. Check if the audioFile is in the response
        if "audioFile" in murf_response_data:
            # 7. Return the successful response
            return {"audioUrl": murf_response_data["audioFile"]}
        else:
            # Handle cases where the API call was successful but didn't return a file
            raise HTTPException(status_code=500, detail="Murf API did not return an audio file Url.")

    except requests.exceptions.HTTPError as http_err:
        # Handle HTTP errors (like 401 Unauthorized, 400 Bad Request, etc.)
        # Log the error for debugging
        print(f"HTTP error occurred: {http_err}")
        print(f"Response content: {response.text}")
        raise HTTPException(status_code=response.status_code, detail=f"Error from Murf API: {response.text}")
    except Exception as e:
        # Handle other potential errors (network issues, etc.)
        print(f"An unexpected error occurred: {e}")
        raise HTTPException(status_code=500, detail=f"An internal server error occurred: {str(e)}")

def split_text_into_chunks(text, chunk_size=2800):
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


@app.post("/llm/query")
async def llm_query(audio_file: UploadFile = File(...)):
    """
    The full pipeline: Audio -> Transcribe -> LLM -> Synthesize -> Audio URL
    """
    try:
        # Step 1: Transcribe audio
        audio_data = await audio_file.read()
        transcriber = aai.Transcriber()
        transcript = transcriber.transcribe(audio_data)

        if transcript.status == aai.TranscriptStatus.error:
            raise HTTPException(status_code=500, detail=f"Transcription failed: {transcript.error}")
        
        transcribed_text = transcript.text
        if not transcribed_text:
            raise HTTPException(status_code=400, detail="No speech detected in the audio.")

        # Step 2: Get response from LLM
        # This gives the model instructions on how to behave.
        system_prompt = "You are a helpful and factual AI assistant. Answer the user's question as accurately as possible."
        full_prompt = f"{system_prompt}\n\nUser question: {transcribed_text}"

        model = genai.GenerativeModel('gemini-1.5-flash-latest')
        llm_response = model.generate_content(full_prompt) # Use the full prompt
        llm_text = llm_response.text
        
        # --- NEW: Chunk the text if it's too long ---
        text_chunks = split_text_into_chunks(llm_text)
        first_chunk = text_chunks[0] # We will only process the first chunk for now

        # Step 3: Generate speech from the first chunk of LLM response
        headers = {"Content-Type": "application/json", "api-key": MURF_API_KEY}
        murf_payload = {
            "text": first_chunk, 
            "voice_id": "en-US-miles"
        }
        
        murf_response = requests.post(MURF_API_URL, headers=headers, json=murf_payload)
        murf_response.raise_for_status()
        murf_data = murf_response.json()

        # Step 4: Return the audio URL
        return {
            "audioUrl": murf_data.get("audioFile"),
            "transcribedText": transcribed_text,
            "responseText": llm_text  # Add the LLM's full text response
        }

    except Exception as e:
        print(f"An error occurred in the LLM query endpoint: {e}")
        raise HTTPException(status_code=500, detail=f"An internal server error occurred: {str(e)}")


@app.get("/agent/history/{session_id}")
async def get_history(session_id: str):
    """
    Retrieves the chat history for a given session ID.
    """
    if session_id in chat_histories:
        return chat_histories[session_id]
    else:
        # It's okay if a new session has no history yet.
        return []


@app.post("/agent/chat/{session_id}")
async def agent_chat(session_id: str, audio_file: UploadFile = File(...)):
    """
    Handles a full conversational turn: Audio -> STT -> History -> LLM -> History -> TTS -> Audio
    """
    global chat_histories
    
    try:
        # Step 1: Transcribe audio
        audio_data = await audio_file.read()
        transcriber = aai.Transcriber()
        transcript = transcriber.transcribe(audio_data)

        if transcript.status == aai.TranscriptStatus.error:
            raise HTTPException(status_code=500, detail=f"Transcription failed: {transcript.error}")
        
        user_text = transcript.text
        if not user_text:
            raise HTTPException(status_code=400, detail="No speech detected in the audio.")
        
        #step 2: retrive and Update History ---
        session_history = chat_histories.get(session_id,[])
        session_history.append({"role": "user", "content": user_text})
        gemini_formatted_history = []
        for message in session_history:
    # The 'assistant' role in our file must be sent as 'model' to the API
            role = 'model' if message['role'] == 'assistant' else 'user'
    
            gemini_formatted_history.append({
                'role': role,
                'parts': [message['content']] # The text content is now inside a list
            })

        #step 3: Call the LLM with full context ---
        model = genai.GenerativeModel('gemini-1.5-flash-latest')
        #start a char session with existing history
        chat = model.start_chat(history=gemini_formatted_history)
        llm_response = chat.send_message(user_text)
        llm_text = llm_response.text
        
        #step 4: Add LLM response to history and save ---
        session_history.append({"role": "assistant", "content": llm_text})
        chat_histories[session_id] = session_history
        save_history()  # Save the updated history to file
        
        text_chunks = split_text_into_chunks(llm_text)
        first_chunk = text_chunks[0]

        headers = {"Content-Type": "application/json", "api-key": MURF_API_KEY}
        murf_payload = {"text": first_chunk, "voice_id": "en-US-miles"}
        
        murf_response = requests.post(MURF_API_URL, headers=headers, json=murf_payload)
        murf_response.raise_for_status()
        murf_data = murf_response.json()
        
        # --- Step 6: Return the final response ---
        return {
            "audioUrl": murf_data.get("audioFile"),
            "transcribedText": user_text,
            "responseText": llm_text
        }


    except Exception as e:
        print(f"An error occurred in the agent chat endpoint: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"An internal server error occurred: {str(e)}")


# app.py
import os
import requests
from fastapi import FastAPI, HTTPException, Request, File, UploadFile
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv
import shutil
import uuid



# Load environment variables from the .env file
load_dotenv()
# Initialize the FastAPI application
app = FastAPI()

# This line tells FastAPI that any URL path that starts with "/static"
# should be served from the local folder named "static".
# This is how the browser will find our script.js file.
app.mount("/static", StaticFiles(directory="static"), name="static")
# Initialize Jinja2 templates for rendering HTML
templates = Jinja2Templates(directory="templates")


                 # --- Pydantic Model for Request Body ---
# This defines the expected structure of the JSON data for our endpoint.
# It ensures that any request to /tts/generate must have a "text" field.
class TTSRequest(BaseModel):
    text: str
    voice_id: str = "en-US-miles"  # Optional: set a default voice
    format: str = "mp3"       # Optional: set a default format
    quality: str = "high"    # Optional: set a default quality
    style: str = "newscast"  # Optional: set a default style


                # --- Murf AI API Configuration ---
MURF_API_URL = "https://api.murf.ai/v1/speech/generate"
API_KEY = os.getenv("MURF_API_KEY")

# Check if the API key is loaded
if not API_KEY:
    raise RuntimeError("MURF_API_KEY not found in .env file. Please add it.")

@app.get("/",response_class=HTMLResponse)
async def read_root(request: Request):
    """
    This endpoint is triggered when a user goes to the main page (the "/" path).
    It uses the template engine to find "index.html" and sends it back.
    """
    return templates.TemplateResponse("index.html", {"request": request})

                # --- API Endpoint for Text-to-Speech ---
@app.post("/tts/generate")
async def generate_tts(request_body: TTSRequest):
    """
    Accepts text and other optional parameters, calls the Murf AI TTS API,
    and returns the URL of the generated audio file.
    """
    # 1. Set up the headers for the Murf API request
    headers = {
        "Content-Type": "application/json",
        "api-key": API_KEY
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

# file upload endpoint section
        # --- NEW ENDPOINT FOR UPLOADING AUDIO ---

@app.post("/upload-audio/")
async def upload_audio(audio_file: UploadFile = File(...)):
    """
    Endpoint to upload an audio file.
    Saves the file to the 'uploads' directory with a unique name.
    and returns the file details.
    """
    # Ensure the uploads directory exists
    uploads_dir = "uploads"
    os.makedirs(uploads_dir, exist_ok=True)

    # Create a unique filename using uuid
    file_extension = ".webm"
    unique_filename = f"{uuid.uuid4()}{file_extension}"
    
    # Save the uploaded file
    file_path = os.path.join(uploads_dir, unique_filename)
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(audio_file.file, buffer)
        return {
            "message": "File uploaded successfully",
            "filename": unique_filename,
            "content_type": audio_file.content_type,
            "size_bytes": audio_file.size
        }   
         
    except Exception as e:
        print(f"Error occurred while saving file: {e}")
        raise HTTPException(status_code=500, detail=f"Error occurred while saving file: {str(e)}")
    

import requests
import os
import re

MURF_API_URL = "https://api.murf.ai/v1/speech/generate"
MURF_API_KEY = os.getenv("MURF_API_KEY")


def split_text_into_chunks(text: str, chunk_size: int = 2900) -> list[str]:
    """Splits text into chunks for the TTS API."""
    
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


def generate_audio(text: str) -> str:
    """
    Generates audio from the given text using the Murf AI TTS API.

    Args:
        text: The text to be converted to speech.

    Returns:
        The URL of the generated audio file.

    Raises:
        Exception: If the TTS API call fails or returns an invalid response.
    """
    if not MURF_API_KEY:
        raise Exception("MURF_API_KEY is not configured.")

    try:
        # We only process the first chunk for this application's purposes
        text_chunks = split_text_into_chunks(text)
        first_chunk = text_chunks[0]

        headers = {"Content-Type": "application/json", "api-key": MURF_API_KEY}
        payload = {"text": first_chunk, "voice_id": "en-US-miles"}
        
        response = requests.post(MURF_API_URL, headers=headers, json=payload, timeout=30)
        response.raise_for_status()  # Raise an exception for bad status codes (4xx or 5xx)
        
        data = response.json()
        audio_url = data.get("audioFile")

        if not audio_url:
            raise Exception("TTS API did not return an audio file URL.")
            
        return audio_url

    except requests.exceptions.RequestException as e:
        raise Exception(f"Network error calling TTS API: {e}")
    except Exception as e:
        raise e

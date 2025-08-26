# llm_service.py
import os
import google.generativeai as genai
import logging
from typing import List, Dict

logger = logging.getLogger(__name__)

class LLMService:
    """Handles interaction with the Google Gemini LLM."""
    def __init__(self):
        self.api_key = os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY environment variable not set.")
        genai.configure(api_key=self.api_key)
        
        self.model = genai.GenerativeModel(
            'gemini-1.5-flash-latest',
            system_instruction="You are a helpful voice assistant. Keep responses concise and use plain text. Do not use markdown."
        )

    async def get_response_stream(self, session_history: List[Dict], transcript: str):
        """
        Gets a streaming response from the LLM and yields clean text chunks.
        """
        try:
            gemini_formatted_history = [
                {'role': 'model' if msg['role'] == 'assistant' else 'user', 'parts': msg.get('parts', [])}
                for msg in session_history
            ]
            chat = self.model.start_chat(history=gemini_formatted_history)
            response_stream = await chat.send_message_async(transcript, stream=True)
            
            full_response = ""
            async for chunk in response_stream:
                if hasattr(chunk, 'text') and chunk.text:
                    text = chunk.text
                    full_response += text
                    
                    # Clean the text for TTS
                    cleaned_text = text.replace('*', '').replace('\n', '. ').strip()
                    if cleaned_text:
                        # Yield the original text for the UI and the cleaned text for TTS
                        yield {"ui_chunk": text, "tts_chunk": cleaned_text + " "}
            
            logger.info(f"--- LLM Stream Complete. Full Response: '{full_response.strip()}' ---")
        except Exception as e:
            logger.error(f"Error during LLM streaming: {e}")
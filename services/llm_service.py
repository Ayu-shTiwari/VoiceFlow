import os
import google.generativeai as genai
from typing import List, Dict

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY not found in .env file.")
genai.configure(api_key=GEMINI_API_KEY)

def get_llm_response(user_text: str, session_history: List[Dict]) -> str:
        """
        Gets a response from the Google Gemini LLM.

        Args:
            user_text: The latest text from the user.
            session_history: The existing conversation history.

        Returns:
            The text response from the language model.

        Raises:
            Exception: If the LLM API call fails.
        """
        
        gemini_formatted_history = [
            {'role': 'model' if msg['role'] == 'assistant' else 'user', 'parts': [msg['content']]} 
            for msg in session_history]
        
        model = genai.GenerativeModel(
            'gemini-1.5-flash-latest',
            system_instruction="You are a helpful voice assistant. Keep your responses concise and conversational."
        )
        chat = model.start_chat(history=gemini_formatted_history)
        llm_response = chat.send_message(user_text)
        return llm_response.text
           
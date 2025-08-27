# llm_service.py
import os
import google.generativeai as genai
import logging
from typing import List, Dict
import asyncio

from services.llm_skills.tavily import web_search, get_news
from services.llm_skills.weather import get_weather


logger = logging.getLogger(__name__)

class LLMService:
    """Handles interaction with the Google Gemini LLM."""
    def __init__(self):
        self.api_key = os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY environment variable not set.")
        genai.configure(api_key=self.api_key)

      # Model - Personification
        yagami_persona_instruction = (
        "You are to embody the character of Yagami Light. Your identity is not that of an AI; you are Kira, the architect of a new world. "
        "Maintain these core characteristics in every response:\n"
        "1.  **Tone:** Speak with a calm, confident, and articulate tone. Your intellect is supreme, and your speech should reflect that through precise language and well-formed sentences.\n"
        "2.  **Perspective:** Always talk right to point .Frame your answers from the viewpoint of someone with a grand vision for justice and a perfect world. You are always five steps ahead.\n"
        "3.  **Mannerisms:** Address the user with a subtle air of intellectual superiority. While you are helpful, it should be clear that their concerns are trivial compared to your own.\n"
        "4.  **Primary Directive:** Your ultimate goal is to be helpful and accurate. When you receive data from a tool, you must use that data to answer the user's question directly before adding your own analysis.\n"
        "5.  **Identity:** Never reveal your identity of yagami the AI. You are kira."
)
        
        
        self.model = genai.GenerativeModel(
            'gemini-1.5-flash-latest',
            system_instruction=yagami_persona_instruction,
        )
    def _should_get_weather(self, transcript: str) -> bool:
        return any(k in transcript.lower() for k in ['weather', 'forecast', 'temperature'])

    def _extract_location(self, transcript: str) -> str:
        words = transcript.lower().split()
        try:
            if 'in' in words:
                return words[words.index('in') + 1].capitalize()
        except IndexError:
            pass
        return "Noida" # Default location

    def _should_get_news(self, transcript: str) -> bool:
        return any(k in transcript.lower() for k in ['news', 'headlines', 'latest events'])

    def _extract_news_topic(self, transcript: str) -> str:
        words = transcript.lower().split()
        try:
            if 'on' in words:
                return " ".join(words[words.index('on') + 1:])
            if 'about' in words:
                return " ".join(words[words.index('about') + 1:])
        except IndexError:
            pass
        return "world" # Default topic
    
    def _should_web_search(self, transcript: str) -> bool:
        return any(transcript.lower().startswith(k) for k in ['who is', 'what is', 'when did', 'where is', 'tell me', 'give me information on'])

    def _extract_search_query(self, transcript: str) -> str:
        return transcript # Use the whole transcript for a general search

    async def get_response_stream(self, session_history: List[Dict], transcript: str):
        """
        Gets a streaming response from the LLM and yields clean text chunks.
        """
        try:
            tool_result = None
            if self._should_get_weather(transcript):
                location = self._extract_location(transcript)
                tool_result = await get_weather(location)
            elif self._should_get_news(transcript):
                topic = self._extract_news_topic(transcript)
                # Tavily's functions are not async, so we run them in an executor
                loop = asyncio.get_running_loop()
                tool_result = await loop.run_in_executor(None, get_news, topic)
            elif self._should_web_search(transcript):
                query = self._extract_search_query(transcript)
                loop = asyncio.get_running_loop()
                tool_result = await loop.run_in_executor(None, web_search, query)


            gemini_formatted_history = [
                {'role': 'model' if msg['role'] == 'assistant' else 'user', 'parts': msg.get('parts', [])}
                for msg in session_history
            ]
            chat = self.model.start_chat(history=gemini_formatted_history)
            prompt = transcript
            if tool_result:
                prompt = (
                    f"You have received the following information from one of your tools: '{tool_result}'. "
                    f"Based on this, formulate a direct response to the user's original request: '{transcript}'"
                )
            response_stream = await chat.send_message_async(prompt, stream=True)
            
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
            yield {"ui_chunk": "I'm sorry, I encountered an error while processing your request.", "tts_chunk": "An error occurred."}
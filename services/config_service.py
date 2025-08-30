import os 
import json
import logging
import asyncio
import httpx
import google.generativeai as genai
import assemblyai as aai
import websockets
from tavily import TavilyClient

logger = logging.getLogger(__name__)
KEYS_FILE = "api_keys.json"

def load_keys_from_file() -> dict:
    if os.path.exists(KEYS_FILE):
        try:
            with open(KEYS_FILE, 'r') as f:
                if os.path.getsize(KEYS_FILE) > 0:
                    return json.load(f)
                return {}
        except (json.JSONDecodeError, IOError):
            return {}
    return {}

def save_keys_to_file(keys: dict):
    try:
        with open(KEYS_FILE, 'w') as f:
            json.dump(keys, f, indent=4)
    except IOError as e:
        logger.error(f"Error saving API keys: {e}")
        
async def validate_gemini_key(api_key: str) -> bool:    
        if not api_key: return False
        try:
                genai.configure(api_key=api_key)
                models = [m for m in genai.list_models()]
                return len(models) > 0
        except Exception as e:
                logger.error(f"❌ Gemini Key Validation Failed: {e}") 
                return False
            
async def validate_assemblyai_key(api_key: str) -> bool:
    """Validates the AssemblyAI API key by trying to create a transcriber."""
    if not api_key: return False
    try:
        aai.settings.api_key = api_key
        aai.Transcriber()
        return True
    except Exception as e:
        logger.error(f"❌ AssemblyAI Key Validation Failed: {e}")
        return False
    
async def validate_murf_key(api_key: str) -> bool:
        """Validates the Murf AI API key by attempting a WebSocket connection."""
        if not api_key: return False
        url = f"wss://api.murf.ai/v1/speech/stream-input?api-key={api_key}"
        try:
            async with websockets.connect(url,open_timeout=5):
                pass
            return True
        except Exception as e:
            logger.error(f"❌ Murf Key Validation Failed: {e}")
            return False
        
async def validate_tavily_key(api_key: str) -> bool:
    if not api_key: return False
    try:
        tavily = TavilyClient(api_key=api_key)
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, tavily.search, "test query")
        return True
    except Exception as e:
        logger.error(f"❌ Tavily Key Validation Failed: {e}")
        return False
    
async def validate_weather_key(api_key: str) -> bool:
    if not api_key: return False
    try:
        url = f"http://api.openweathermap.org/data/2.5/weather?q=Noida&appid={api_key}"
        async with httpx.AsyncClient() as client:
            response = await client.get(url)
            if response.status_code != 200:
                logger.error(f"❌ Weather Key Validation Failed: Status {response.status_code} - {response.text}")
                return False
            return True
    except Exception as e:
        logger.error(f"❌ Weather Key Validation Failed: {e}")
        return False    
        
async def validate_keys(keys: dict) -> dict:
                tasks = {
                    "gemini": validate_gemini_key(keys.get("GEMINI_API_KEY", "")),
                    "assembly": validate_assemblyai_key(keys.get("ASSEMBLYAI_API_KEY", "")),
                    "murf": validate_murf_key(keys.get("MURF_API_KEY", "")),
                    "weather": validate_weather_key(keys.get("WEATHER_API_KEY")),
                    "tavily": validate_tavily_key(keys.get("TAVILY_API_KEY"))
                    }
            
                results = await asyncio.gather(*tasks.values())
                
                validation_status = {name: "valid" if result else "invalid" for name, result in zip(tasks.keys(), results)}
                
                logger.info(f"Key validation results: {validation_status}")
                return validation_status
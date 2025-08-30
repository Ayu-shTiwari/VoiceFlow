from pydantic import BaseModel
from typing import Optional

class ChatResponse(BaseModel):
    """
    Defines the structure for a successful response from the chat agent.
    """
    audioUrl: Optional[str] = None
    transcribedText: str
    responseText: str
    error: bool = False
    
class ErrorResponse(BaseModel):
    """
    Defines the structure for an error response.
    """
    fallbackAudioUrl: str
    error: bool = True
    errorMessage: str
    responseText: str    
    
class ApiKeys(BaseModel):
    GEMINI_API_KEY: Optional[str] = None
    ASSEMBLYAI_API_KEY: Optional[str] = None
    MURF_API_KEY: Optional[str] = None
    TAVILY_API_KEY: Optional[str] = None
    WEATHER_API_KEY: Optional[str] = None
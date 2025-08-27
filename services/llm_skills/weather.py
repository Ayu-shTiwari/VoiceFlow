import os
import httpx
import logging
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

async def get_weather(location: str) -> str:
    logger.info(f"Get weather for location '{location}'")
    api_key = os.getenv("WEATHER_API_KEY")
    if not api_key:
        return "Error: Weather API key is not configured."
    
    url = f"http://api.openweathermap.org/data/2.5/weather?q={location}&appid={api_key}&units=metric"
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, timeout=10.0)
            response.raise_for_status()
            data = response.json()
            report = (
                f"The current weather in {data.get('name')} is {data.get('weather', [{}])[0].get('description')}. "
                f"The temperature is {data.get('main', {}).get('temp')} degrees Celsius."
            )
            return report
        except httpx.HTTPStatusError:
            return f"I could not find weather data for {location}. Please be more specific."
        except Exception as e:
            logger.error(f"An error occurred while fetching weather: {e}")
            return "An error occurred while fetching the weather."

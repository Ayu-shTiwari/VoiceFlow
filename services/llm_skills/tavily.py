import os
import logging
from typing import List, Dict
from tavily import TavilyClient

logger = logging.getLogger(__name__)

def web_search(query: str) -> List[Dict]:
    """
    Performs a web search using the Tavily API to find relevant information.
    Args:
        query: The search query from the user.
    Returns:
        A list of search results, summarized for the LLM.
    """
    logger.info(f"Performing web search for query: {query}")
    try:
        api_key = os.getenv("TAVILY_API_KEY")
        if not api_key:
            logger.error("TAVILY_API_KEY environment variable not set.")
            return [{"error" : "Search API key is not configured."}]
         
        tavily = TavilyClient(api_key = api_key)
        response = tavily.search(
            query=query,
            topic="news",
            max_results=3,
            include_answer="basic"
        ) 
        answer = response.get("answer", "No direct answer found.")
        logger.info(f"Search answer: {answer}")
        return [{"answer": answer}]
    
    except Exception as e:
        logger.error(f"Error occurred during web search: {e}")
        return [{"error": "An error occurred while performing the search."}]
    
    
def get_news(topic: str) -> str:
    logger.info(f"Get some news on topic '{topic}'.")
    try:
        api_key = os.getenv("TAVILY_API_KEY")
        tavily = TavilyClient(api_key=api_key)
        response = tavily.search(query=f"latest news on {topic}", topic="news", search_depth="basic", max_results=3)
        results = response.get("results", [])
        if not results:
            return f"No recent news regarding {topic}."
        formatted_results = f"Here are the top news headlines regarding {topic}:\n"
        for result in results:
            formatted_results += f"- {result.get('content')}\n"
        return formatted_results
    except Exception as e:
        logger.error(f"An error occurred during Tavily news search: {e}")
        return "An error occurred while searching for news."

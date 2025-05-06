import os
import requests
from typing import Dict, List, Any, Optional, Union, Tuple


def send_openrouter_request(
    messages: List[Dict[str, Any]],
    model: str,
    max_tokens: int = 4096,
    temperature: float = 0.7,
    max_thinking_tokens: int = 8000
) -> Dict[str, Any]:
    """
    Send a request to the OpenRouter API endpoint.
    
    Args:
        messages: List of message objects with role and content
        model: OpenRouter model ID (e.g., "openai/gpt-4o-mini")
        api_key: OpenRouter API key (defaults to env var)
        max_tokens: Maximum tokens to generate
        temperature: Sampling temperature (0-2)
        thinking: Whether to request thinking tokens
        stream: Whether to stream the response
        max_thinking_tokens: Maximum tokens for thinking
        
    Returns:
        Dict containing the API response
    """

    # Get API key from environment if not provided
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise ValueError("OpenRouter API key is required")

    # Base URL for OpenRouter API
    base_url = os.environ.get("OPENROUTER_CHAT_URL")
    if not base_url:
        raise ValueError("OpenRouter chat URL is required")

    # Prepare headers
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    # Prepare request payload
    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "reasoning": {
            "max_tokens": max_thinking_tokens
        }
    }

    # Send the request
    response = requests.post(base_url, headers=headers, json=payload)
    response.raise_for_status()
    return response.json()

def process_openrouter_response(
    response: Dict[str, Any]
) -> Tuple[str, Optional[str]]:
    """
    Process the response from OpenRouter API, extracting content and thinking tokens.
    
    Args:
        response: The response from the OpenRouter API
        
    Returns:
        Tuple of (content, thinking_content) where thinking_content may be None
    """

    if not response or "choices" not in response or not response["choices"]:
        return "", None

    # Get the first choice
    choice = None
    if "message" in response["choices"][0]:
        choice = response["choices"][0]["message"]

    content = choice.get("content", "")
    reasoning = choice.get("reasoning", "")
    print(f"Content: {content}")
    print(f"Reasoning: {reasoning}")

    return content, reasoning

def chat_with_openrouter(
    messages: List[Dict[str, Any]],
    model: str = "openai/gpt-4o-mini",
    max_tokens: int = 1000,
    temperature: float = 0.7,
    max_thinking_tokens: int = 8000
) -> Union[str, Tuple[str, str]]:
    """
    Send a chat request to OpenRouter and process the response.
    
    Args:
        messages: List of message objects with role and content
        model: OpenRouter model ID
        max_tokens: Maximum tokens to generate
        temperature: Sampling temperature
        max_thinking_tokens: Maximum tokens for thinking
        
    Returns:
        Response content or thinking content
    """
    # Send the request with thinking enabled if requested
    response = send_openrouter_request(
        messages=messages,
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        max_thinking_tokens=max_thinking_tokens
    )
    
    # Process the response
    content, thinking = process_openrouter_response(response)
    if content:
        return content
    else:
        return f"Thinking: \n{thinking}"


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    
    # Example messages
    messages = [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "What is the capital of France?"}
    ]
    # With thinking tokens
    response = chat_with_openrouter(
        messages, 
        model="anthropic/claude-3.7-sonnet",
        max_thinking_tokens=1000,
        max_tokens=4000,
        temperature=0.7
    )
    print(f"Response: {response}")

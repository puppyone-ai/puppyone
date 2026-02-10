import json
import logging
import requests
from typing import Dict, List, Optional, Union


logger = logging.getLogger(__name__)


class OllamaLocalInference:
    def __init__(
        self,
        model_register: Union[str, Dict] = "model_register.json"
    ):
        """
        Initialize OllamaLocalInference with either a path to model register JSON or a dictionary.
        
        Args:
            model_register: Either a path to JSON file or a dictionary containing model configurations
        """

        self.model_register = model_register
        self.base_url = "http://localhost:11434/api"
        
    def load_model_register(
        self
    ) -> Dict:
        if isinstance(self.model_register, dict):
            return self.model_register

        try:
            with open(self.model_register, 'r') as f:
                return json.load(f)
        except FileNotFoundError:
            logger.error(f"Model register file not found at {self.model_register}")
            return {}
        except json.JSONDecodeError:
            logger.error("Invalid JSON in model register file")
            return {}

    def validate_model(
        self,
        model_name: str
    ) -> Optional[Dict]:
        if model_name not in self.model_register:
            logger.warning(f"Model {model_name} not found in register")
            return None
 
        model_info = self.model_register[model_name]
        if model_info.get("inference_method") != "ollama":
            logger.warning(f"Model {model_name} is not configured for Ollama inference")
            return None
            
        return model_info

    def generate_chat_completion(
        self,
        model_name: str,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        is_structured_output: bool = False,
        json_format: Optional[Dict] = None,
    ) -> Optional[Union[str, Dict]]:
        """
        Generate chat completion using Ollama local inference.
        
        Args:
            model_name: Name of the model to use
            messages: List of message dictionaries with 'role' and 'content'
            temperature: Sampling temperature (0-1)
            max_tokens: Maximum tokens to generate
            json_format: Format specification for structured JSON output
        
        Returns:
            Generated response as string or dict if JSON format is specified
        """

        model_info = self.validate_model(model_name)
        if not model_info:
            return None

        payload = {
            "model": model_name,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": temperature
            }
        }

        if max_tokens:
            payload["options"]["num_predict"] = max_tokens

        if is_structured_output:
            payload["format"] = json_format or "json"

        try:
            response = requests.post(
                f"{self.base_url}/chat",
                headers={"Content-Type": "application/json"},
                json=payload,
                timeout=120
            )
            response.raise_for_status()
            
            result = response.json()
            
            if not result.get("done", False):
                logger.error("Inference did not complete successfully")
                return None

            content = result["message"]["content"]
            
            # Try parsing as JSON if json_format was specified
            if is_structured_output:
                try:
                    return json.loads(content)
                except json.JSONDecodeError:
                    logger.warning("Failed to parse response as JSON")
                    return content
            
            return content

        except requests.RequestException as e:
            logger.error(f"Request failed: {str(e)}")
            return None
        except KeyError as e:
            logger.error(f"Unexpected response format: {str(e)}")
            return None


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    test_model_register = {
        "llama2": {
            "inference_method": "ollama",
        },
        "mistral": {
            "inference_method": "ollama",
        }
    }
    
    # Initialize with direct dictionary
    ollama = OllamaLocalInference(test_model_register)
    
    json_format = {
        "type": "object",
        "properties": {
            "capital": {"type": "string"},
            "country": {"type": "string"},
            "population": {"type": "integer"}
        }
    }
    response = ollama.generate_chat_completion(
        model_name="llama2",
        messages=[{"role": "user", "content": "Provide information about Paris, France"}],
        temperature=0.1,
        is_structured_output=True,
        json_format=json_format
    )
    logger.info(f"Structured output response: {response}")

    logger.info("--------------------------------")
    conversation = [
        {"role": "user", "content": "Let's talk about programming."},
        {"role": "assistant", "content": "Sure! What would you like to know about programming?"},
        {"role": "user", "content": "What are the main differences between Python and JavaScript?"}
    ]
    response = ollama.generate_chat_completion(
        model_name="llama2",
        messages=conversation,
        max_tokens=150
    )
    logger.info(f"Multi-turn conversation response: {response}")

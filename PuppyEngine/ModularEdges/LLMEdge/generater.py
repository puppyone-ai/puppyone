# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import os
from typing import Any, List, Dict
from litellm import completion
from ModularEdges.EdgeFactoryBase import EdgeFactoryBase
from Utils.PuppyEngineExceptions import PuppyEngineException, global_exception_handler


class ChatService:
    """
    Chat configurations to interact with LiteLLM"s completion API with optional parameters.

    Init Args:
        api_key (str): The API key to use for the OpenAI API. Use the environment variable OPENAI_API_KEY if not provided.
        base_url (str): The base URL for the OpenAI API. Use the environment variable OPENAI_BASE_URL if not provided.
        model (str): The model to use for the LLM. Use the environment variable OPENAI_MODEL if not provided.
        messages (list): List of messages comprising the conversation so far.
        temperature (float, optional): The temperature of the LLM. The higher the temperature, the more random the output. The default is 0.1 for stable responses.
        max_tokens (int, optional): The maximum number of tokens to generate. The default is 4096.
        printing (bool, optional): Whether to print the response. The default is False.
        stream (bool, optional): Whether to stream the response. The default is True.
        top_p (float, optional): Nucleus sampling probability.
        n (int, optional: Number of chat completion choices to generate. The default is 1.
        presence_penalty (float, optional): Penalty for new tokens based on their presence.
        frequency_penalty (float, optional): Penalty for new tokens based on their frequency.
        kwargs (dict, optional): Additional parameters for any LLMs API require.

    Returns:
        str: The response from the LiteLLM API.
    """

    def __init__(
        self,
        api_key: str = None,
        base_url: str = None,
        model: str = "gpt-4o-2024-08-06",
        messages: list = None,
        temperature: float = 0.1, 
        max_tokens: int = 2048,
        printing: bool = False, 
        stream: bool = True,
        top_p: float = None,
        n: int = 1,
        presence_penalty: float = None,
        frequency_penalty: float = None,
        **kwargs
    ):  
        self.api_key = api_key or os.environ.get("DEEPBRICKS_API_KEY", api_key)
        if not self.api_key:
            raise PuppyEngineException(3701, "Missing Large Language Model API Key")
        
        self.base_url = base_url or os.environ.get("DEEPBRICKS_BASE_URL", base_url)

        self.model = model or os.environ.get("OPENAI_MODEL", model)
        if not self.model:
            raise PuppyEngineException(3702, "Missing Large Language Model Name")

        if not messages:
            raise PuppyEngineException(3700, "Missing Prompt Message", "The messages field is required for the chat completion tasks with the specific LLM.")

        self.messages = messages
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.printing = printing
        self.stream = stream
        self.top_p = top_p
        self.n = n
        self.presence_penalty = presence_penalty
        self.frequency_penalty = frequency_penalty

        # Set any additional attributes from kwargs
        for key, value in kwargs.items():
            setattr(self, key, value)

    @global_exception_handler(3600, "Error Generating Response for the Current Prompt Message")
    def chat_completion(
        self, 
    ) -> Any:
        """
        Sending prompts to the specified model and returning the response based on the configuration.

        Args:
            printing (bool): Whether to print the response. The default is False.

        Returns:
            Any: The response from the model.
        """

        data = {k: v for k, v in self.__dict__.items() if v is not None and k != "printing"}
        response = completion(**data)
        if self.stream:
            return self._handle_stream_response(response)
        else:
            return self._handle_non_stream_response(response)

    def _handle_non_stream_response(
        self, 
        response: Any, 
    ) -> str:
        """
        Handle the non-stream response from the model.

        Args:
            response (Any): The response from the model.

        Returns:
            str: The response content.
        """

        response_content = response.choices[0].message.content
        if self.printing:
            print(response_content + "\n")
        return response_content

    def _handle_stream_response(
        self, 
        response: Any
    ) -> str:
        """
        Handle the stream response from the model.

        Args:
            response (Any): The response from the model.

        Returns:
            str: The response content.
        """

        final_response = ""
        for chunk in response:
            chunk_content = chunk.choices[0].delta.content
            if chunk_content:
                if self.printing:
                    print(chunk_content, end="")
                final_response += chunk_content
        if self.printing:
            print("\n")
        return final_response


@global_exception_handler(3601, "Error Generating Response Using Lite LLM")
def lite_llm_chat(
    history: List[Dict[str, str]] = None,
    **kwargs
) -> str:
    """
    The main function to interact with the litellm interface and generate responses based on the configuration.

    Args:
        **kwargs: The keyword arguments for the chat configurations, including:
        - api_key
        - model
        - base_url
        - messages
        - temperature
        - max_tokens
        - printing
        - stream
        - top_p
        - n
        - stop
        - presence_penalty
        - frequency_penalty
        - kwargs

    Returns:
        str: The response content.
    """

    # Construct the prompt
    messages = kwargs.get("messages", None)
    if history:
        messages = history + messages
    kwargs["messages"] = messages

    # Initialize the ChatService with the configured settings
    chat_service = ChatService(**kwargs)

    # Call the chat method and print the results if printing is set to True
    result = chat_service.chat_completion()

    # Return the result from the chat service
    return result

class LLMFactory(EdgeFactoryBase):
    @staticmethod
    def execute(
        init_configs: Dict[str, Any] = None,
        extra_configs: Dict[str, Any] = None
    ) -> str:
        return lite_llm_chat(**init_configs)


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    
    context = ["The quick brown fox jumps over the lazy dog."]
    query = "What does the fox jump over?"
    user_prompt = """
Context:
PuppyAgent is a company focused on building agent-based technologies.
Their mission is to 'build the world with agents', key points about PuppyAgent include:
1.They have developed an agent framework called Puppys.
2.Their roadmap includes developing agent-powered SaaS (Software as a Service) solutions for vertical markets.
3.The company appears to be in an early stage, with a focus on iterating their product and collecting feedback from potential B2B customers, primarily overseas.

Query: What's the name of the PuppyAgent's agent framework?
    """
    structure = {
        "type": "json_schema",
        "json_schema": {
            "name": "test",
            "schema": {
            "type": "object",
            "properties": {
                "name": {
                "type": "string"
                },
            }
            },
            "required": ["name"]
        }
    }
    
    response = lite_llm_chat(
        user_prompt=user_prompt,
        response_format=structure,
        messages=[
            {"role": "user", "content": user_prompt}
        ],
        history=[
            {"role": "system", "content": "You are a helpful assistant designed to output JSON."}
        ],
        max_tokens=100
    )
    print(response)
    
    structure = {
        "type": "json_schema",
        "json_schema": {
            "name": "chunked_document",
            "schema": {
                "type": "object",
                "properties": {
                    "chunks": {
                        "type": "array",
                        "items": {
                            "type": "string"
                        }
                    }
                },
                "required": ["chunks"]  # Specify required properties
            }
        }
    }
    doc = """
Artificial Intelligence (AI) is the simulation of human intelligence in machines.
AI systems are used to perform tasks that normally require human intelligence.
There are two types of AI: narrow AI and general AI.
Narrow AI is designed to perform a narrow task like facial recognition.
General AI, on the other hand, is a form of intelligence that can perform any intellectual task that a human can do.
"""
    response = lite_llm_chat(
        user_prompt=user_prompt,
        response_format=structure,
        messages=[
            {"role": "user", "content": doc}
        ],
        history=[
            {"role": "system", "content": "You are an expert document chunker. Your task is to split the original document into semantically meaningful chunks. Ensure that the document is chunked in a way that each chunk contains coherent and complete thoughts or ideas. Output in json."}
        ],
        max_tokens=100
    )
    print(response)

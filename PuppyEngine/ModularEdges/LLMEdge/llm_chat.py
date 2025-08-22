# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import instructor
from openai import OpenAI
from typing import Any, Dict
from litellm import completion
from pydantic import BaseModel
from Utils.puppy_exception import PuppyException, global_exception_handler


# The OpenAI client is instantiated with environment defaults, but
# we will pass api_key/base_url dynamically into each request via kwargs
# from the ChatService, so ensure the client picks up latest env.
openai_client = OpenAI(
  base_url=os.environ.get("OPENROUTER_BASE_URL"),
  api_key=os.environ.get("OPENROUTER_API_KEY"),
)

class Content(BaseModel):
    content: Dict[str, Any]


class ChatService:
    """
    Chat configurations to interact with LiteLLM's completion API with optional parameters.

    Init Args:
        api_key (str): The API key to use for the OpenAI API. Use the environment variable OPENAI_API_KEY if not provided.
        base_url (str): The base URL for the OpenAI API. Use the environment variable OPENAI_BASE_URL if not provided.
        model (str): The model to use for the LLM. Use the environment variable OPENAI_MODEL if not provided.
        messages (list): List of messages comprising the conversation so far.
        temperature (float, optional): The temperature of the LLM. The higher the temperature, the more random the output. The default is 0.1 for stable responses.
        max_tokens (int, optional): The maximum number of tokens to generate. The default is 4096.
        printing (bool, optional): Whether to print the response. The default is False.
        stream (bool, optional): Whether to stream the response. The default is False.
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
        is_openrouter: bool = True,
        api_key: str = None,
        base_url: str = None,
        model: str = "gpt-4o-2024-08-06",
        messages: list = None,
        temperature: float = 0.1, 
        max_tokens: int = 10000,
        printing: bool = False, 
        stream: bool = False,
        **kwargs
    ):
        if not model:
            raise PuppyException(3702, "Missing Large Language Model Name")

        if not messages:
            raise PuppyException(3700, "Missing Prompt Message", "The messages field is required for the chat completion tasks with the specific LLM.")

        self.is_openrouter = is_openrouter
        self.api_key = api_key
        self.base_url = base_url
        self.model = model
        self.messages = messages
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.printing = printing
        self.stream = stream

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
        is_openrouter = data.pop("is_openrouter", True)
        base_url = data.pop("base_url", None)
        api_key = data.pop("api_key", None)
        
        self.structured_output = data.pop("structured_output", None)
        if self.structured_output:
            client = OpenAI(base_url=base_url, api_key=api_key) if is_openrouter else None
            openai_client_json = instructor.from_openai(client or openai_client, mode=instructor.Mode.JSON)
            response = openai_client_json.chat.completions.create(**data, response_model=Content) if is_openrouter else completion(**data)
        else:
            client = OpenAI(base_url=base_url, api_key=api_key) if is_openrouter else None
            response = (client or openai_client).chat.completions.create(**data) if is_openrouter else completion(**data)

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
        try:
            if self.structured_output:
                response_content = response.content
            else:
                response_content = response.choices[0].message.content
        except Exception as e:
            raise PuppyException(3701, "Error Parsing LLM Client Response", str(e))

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


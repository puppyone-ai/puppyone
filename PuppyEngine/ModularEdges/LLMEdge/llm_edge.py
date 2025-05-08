# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import os
import json
import logging
import requests
from typing import Any, List, Dict, Tuple
from ModularEdges.LLMEdge.llm_chat import ChatService
from ModularEdges.EdgeFactoryBase import EdgeFactoryBase
from Utils.puppy_exception import PuppyException, global_exception_handler


def get_open_router_models(
    url: str = "https://openrouter.ai/api/v1/models"
) -> List[str]:
    try:
        response = requests.get(url)
        all_model_info = response.json().get("data", [])
        valid_modalities = {"text+image->text", "text->text"}
        valid_models = [
            model_info.get("id") 
            for model_info in all_model_info 
            if model_info.get("architecture").get("modality") in valid_modalities
        ]
    except Exception as e:
        logging.error(f"Error getting open router models: {e}")
        valid_models = ["openai/gpt-4o-mini"]

    return valid_models

open_router_models = get_open_router_models()
open_router_supported_models = [
    "openai/o1-pro",
    "openai/o3-mini-high",
    "openai/o3-mini",
    "openai/o1",
    "openai/o1-mini",
    "openai/gpt-4.5-preview",
    "openai/gpt-4o-2024-11-20",
    "openai/gpt-4o-mini",
    "openai/gpt-4-turbo",
    "deepseek/deepseek-chat-v3-0324:free",
    "deepseek/deepseek-r1-zero:free",
    "anthropic/claude-3.5-haiku",
    "anthropic/claude-3.5-sonnet",
    "anthropic/claude-3.7-sonnet",
]

def get_open_router_llm_settings(
    model: str = None,
    api_key: str = None,
    base_url: str = None,
    supported_models: List[str] = open_router_supported_models,
) -> Tuple[str, str, str]:
    api_key = api_key or os.environ.get("OPENROUTER_API_KEY")
    base_url = base_url or os.environ.get("OPENROUTER_BASE_URL")
    if model not in supported_models:
        raise PuppyException(3701, "Invalid Open Router Model")
    return api_key, base_url, model

def get_lite_llm_settings(
    model: str = None,
    api_key: str = None,
    base_url: str = None,
) -> Tuple[str, str, str]:
    # Convert model name to api model name
    valid_models = {
        "gpt-4o": "openai/gpt-4o-2024-08-06",
        "gpt-4o-mini": "openai/gpt-4o-mini-2024-07-18",
        "gpt-4.5-preview": "openai/gpt-4.5-preview-2025-02-27",
        "o1": "openai/o1-2024-12-17",
        "o1-mini": "openai/o1-mini-2024-09-12",
        "o3-mini": "openai/o3-mini-2025-01-31",
        "claude-3.7-sonnet": "anthropic/claude-3-7-sonnet-latest",
        "claude-3.7-sonnet-thinking": "anthropic/claude-3-7-sonnet-latest",
        "claude-3.5-sonnet": "anthropic/claude-3-5-sonnet-latest",
        "claude-3.5-haiku": "anthropic/claude-3-5-haiku-latest",
        "claude-3-opus": "anthropic/claude-3-opus-latest",
        "deepseek-v3": "deepseek/deepseek-chat",
        "deepseek-r1": "deepseek/deepseek-reasoner",
    }
    valid_model = valid_models.get(model, "openai/gpt-4o-2024-08-06")

    if valid_model.startswith("openai"):
        key_name = "DEEPBRICKS_API_KEY"
    elif valid_model.startswith("anthropic"):
        key_name = "ANTHROPIC_API_KEY"
    elif valid_model.startswith("deepseek"):
        key_name = "DEEPSEEK_API_KEY"
    else:
        raise PuppyException(3701, "Missing Large Language Model API Key")

    api_key = api_key or os.environ.get(key_name)
    base_url = base_url or os.environ.get("DEEPBRICKS_BASE_URL")
    return api_key, base_url, valid_model

def get_huggingface_llm_settings(
    model: str = None,
    api_key: str = None,
    api_base: str = None,
) -> Tuple[str, str, str]:
    api_key = api_key or os.environ.get("HUGGINGFACE_API_KEY")
    model = f"huggingface/{model}" if model else "huggingface/meta-llama/Meta-Llama-3.1-8B-Instruct"
    return api_key, api_base, model

@global_exception_handler(3601, "Error Generating Response Using Lite LLM")
def lite_llm_chat(
    history: List[Dict[str, str]] = None,
    **kwargs
) -> str:
    """
    The main function to interact with the litellm interface and generate responses based on the configuration.

    Args:
        **kwargs: The keyword arguments for the chat configurations, including:
        - hoster (str): "openrouter" or "huggingface" or "litellm"
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

    # Handle structured output
    structured_output = kwargs.get("structured_output", False)
    if structured_output:
        kwargs["messages"].append({"role":"user", "content":"in json format"})

    # Construct the prompt
    messages = kwargs.get("messages", None)
    if history:
        messages = history + messages
    kwargs["messages"] = messages
    # print("Messages: ", messages)

    hoster = kwargs.pop("hoster", "openrouter")
    if hoster == "openrouter":
        kwargs["api_key"], kwargs["base_url"], kwargs["model"] = get_open_router_llm_settings(
            model=kwargs.get("model"),
            api_key=kwargs.get("api_key"),
            base_url=kwargs.get("base_url"),
            supported_models=open_router_supported_models
        )
        kwargs["is_openrouter"] = True
    elif hoster == "huggingface":
        kwargs["api_key"], kwargs["base_url"], kwargs["model"] = get_huggingface_llm_settings(
            model=kwargs.get("model"),
            api_key=kwargs.get("api_key"),
            api_base=kwargs.get("api_base")
        )
        kwargs["is_openrouter"] = False
    else:
        kwargs["api_key"], kwargs["base_url"], kwargs["model"] = get_lite_llm_settings(
            model=kwargs.get("model"),
            api_key=kwargs.get("api_key"),
            base_url=kwargs.get("base_url")
        )
        kwargs["is_openrouter"] = False

    # Initialize the ChatService with the configured settings
    chat_service = ChatService(**kwargs)

    # Call the chat method and print the results if printing is set to True
    result = chat_service.chat_completion()

    # Return the result from the chat service
    if structured_output:
        try:
            if isinstance(result, str):
                return json.loads(result)
            else:
                return result
        except json.JSONDecodeError:
            logging.error(f"Error parsing structured output: {result}")
            return result

    return result


class LLMFactory(EdgeFactoryBase):
    @staticmethod
    @global_exception_handler(3014, "Error Executing LLM Edge")
    def execute(
        init_configs: Dict[str, Any] = None,
        extra_configs: Dict[str, Any] = None
    ) -> str:
        # hoster = init_configs.pop("hoster", "openrouter")
        # if hoster == "openrouter":
        #     return openrouter_llm_chat(**init_configs)
        # else:
        #     return lite_llm_chat(**init_configs)
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
        # free model for testing
        # model="google/gemini-flash-1.5-8b-exp",
        model="openai/o3-mini-high",
        response_format=structure,
        messages=[
            {"role": "user", "content": user_prompt}
        ],
        history=[
            {"role": "system", "content": "You are a helpful assistant designed to output JSON."}
        ],
        max_tokens=1000,
        hoster="openrouter"
    )
    print(response)
    
    
#     structure = {
#         "type": "json_schema",
#         "json_schema": {
#             "name": "chunked_document",
#             "schema": {
#                 "type": "object",
#                 "properties": {
#                     "chunks": {
#                         "type": "array",
#                         "items": {
#                             "type": "string"
#                         }
#                     }
#                 },
#                 "required": ["chunks"]  # Specify required properties
#             }
#         }
#     }
#     doc = """
# Artificial Intelligence (AI) is the simulation of human intelligence in machines.
# AI systems are used to perform tasks that normally require human intelligence.
# There are two types of AI: narrow AI and general AI.
# Narrow AI is designed to perform a narrow task like facial recognition.
# General AI, on the other hand, is a form of intelligence that can perform any intellectual task that a human can do.
# """
#     response = lite_llm_chat(
#         user_prompt=user_prompt,
#         response_format=structure,
#         messages=[
#             {"role": "user", "content": doc}
#         ],
#         history=[
#             {"role": "system", "content": "You are an expert document chunker. Your task is to split the original document into semantically meaningful chunks. Ensure that the document is chunked in a way that each chunk contains coherent and complete thoughts or ideas. Output in json."}
#         ],
#         max_tokens=100
#     )
#     print(response)

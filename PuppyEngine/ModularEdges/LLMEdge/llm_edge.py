# If you are a VS Code users:
import os
import sys
# Add the root directory to sys.path to allow importing from tools
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

import os
import json
import logging
import requests
from typing import Any, List, Dict, Tuple
from ModularEdges.LLMEdge.llm_chat import ChatService
from ModularEdges.EdgeFactoryBase import EdgeFactoryBase
from .llm_settings import (
    open_router_supported_models,
    local_supported_models,
    get_open_router_llm_settings,
    get_lite_llm_settings,
    get_huggingface_llm_settings
)
from ModularEdges.LLMEdge.ollama_local_inference import OllamaLocalInference
from ModularEdges.LLMEdge.hf_local_inference import LocalLLMChat, LocalLLMConfig
from Utils.puppy_exception import PuppyException, global_exception_handler

@global_exception_handler(3601, "Error Generating Response Using Lite LLM")
def remote_llm_chat(
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
        - chat_histories
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
    chat_histories = kwargs.pop("chat_histories", None)
    if chat_histories and isinstance(chat_histories, list) and \
        len(chat_histories) > 0 and isinstance(chat_histories[0], dict) and\
            "role" in chat_histories[0] and "content" in chat_histories[0]:
        messages = chat_histories + messages
    kwargs["messages"] = messages

    model = list(kwargs.get("model", {}).keys())[0]
    hoster = kwargs.pop("hoster", "openrouter")
    if hoster == "openrouter":
        kwargs["api_key"], kwargs["base_url"], kwargs["model"] = get_open_router_llm_settings(
            model=model,
            api_key=kwargs.get("api_key"),
            base_url=kwargs.get("base_url"),
            supported_models=open_router_supported_models
        )
        kwargs["is_openrouter"] = True
    elif hoster == "huggingface":
        kwargs["api_key"], kwargs["base_url"], kwargs["model"] = get_huggingface_llm_settings(
            model=model,
            api_key=kwargs.get("api_key"),
            api_base=kwargs.get("api_base")
        )
        kwargs["is_openrouter"] = False
    else:
        kwargs["api_key"], kwargs["base_url"], kwargs["model"] = get_lite_llm_settings(
            model=model,
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
        model = init_configs.get("model", {})
        model_name = list(model.keys())[0]
        model_info = model.get(model_name, {})
        inference_method = model_info.get("inference_method", "ollama")
        is_local_deployment = model_name not in open_router_supported_models
        logging.info(f"DEPLOYMENT_TYPE={os.environ.get('DEPLOYMENT_TYPE')}")
        logging.info(f"is_local_deployment={is_local_deployment}")
        logging.info(f"model_name={model_name}")

        if is_local_deployment:
            messages = init_configs.get("messages", [])
            structured_output = init_configs.get("structured_output", False)
            if structured_output:
                messages.append({"role":"user", "content":"in json format"})
                
            if inference_method == "huggingface":
                config = LocalLLMConfig(
                    model_name=model_name,
                    temperature=init_configs.get("temperature", 0.7),
                    max_tokens=init_configs.get("max_tokens", 2048),
                    stream=init_configs.get("stream", False)
                )
                chat = LocalLLMChat(config)
                return chat.chat(messages)
            elif inference_method == "ollama":
                ollama = OllamaLocalInference(model)
                return ollama.generate_chat_completion(
                    model_name=model_name,
                    messages=messages,
                    temperature=init_configs.get("temperature", 0.7),
                    max_tokens=init_configs.get("max_tokens", 2048),
                    is_structured_output=init_configs.get("structured_output", False),
                    json_format=init_configs.get("json_format", {})
                )

        # If not local model or local deployment, use remote API
        return remote_llm_chat(**init_configs)


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

    response = remote_llm_chat(
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
#     response = remote_llm_chat(
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

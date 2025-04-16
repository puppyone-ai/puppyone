# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import os
import yaml
import json
import logging
from typing import Any, Dict
from ModularEdges.LLMEdge.llm_chat import ChatService
from ModularEdges.EdgeFactoryBase import EdgeFactoryBase
from ModularEdges.LLMEdge.llm_edge import open_router_supported_models, get_open_router_llm_settings, get_lite_llm_settings, get_huggingface_llm_settings
from Utils.puppy_exception import global_exception_handler


# Load the prompt template
prompt_template_file: str = "ModularEdges/LLMEdge/prompt_templates.yaml"
with open(prompt_template_file, "r") as f:
    prompt_templates = yaml.safe_load(f)

@global_exception_handler(3601, "Error Generating Response Using Lite LLM")
def llm_generation(
    sys_prompt_template: str = "default",
    user_prompt_template: str = "default",
    query: str = None,
    context: str = None,
    hoster: str = "openrouter",
    **kwargs
) -> str:
    """
    The main function to interact with the litellm interface and generate responses based on the configuration.

    Args:
        sys_prompt_template (str): The system prompt template to use for the generation.
        user_prompt_template (str): The user prompt template to use for the generation.
        query (str): The query to generate the response for.
        context (str): The context to generate the response for.
        hoster (str): "openrouter" or "huggingface" or "litellm"
        **kwargs: The keyword arguments for the chat configurations, including:
        - api_key (str): The API key for the hoster.
        - model (str): The model to use for the generation.
        - base_url (str): The base URL for the hoster.
        - max_tokens (int): The maximum number of tokens to generate.
        - structured_output (bool): Whether to return the response in a structured format.
        - kwargs (dict): Additional keyword arguments.

    Returns:
        str: The response content.
    """

    # Get the specific templates based on provided keys
    system_prompt = prompt_templates.get("system_prompts", {}).get(sys_prompt_template, "")
    user_prompt = prompt_templates.get("user_prompts", {}).get(user_prompt_template, "")
    user_prompt = user_prompt.format(context=context, query=query)
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ]

    # Handle structured output
    structured_output = kwargs.get("structured_output", False)
    if structured_output:
        messages.append({"role":"user", "content":"in json format"})

    # Construct the prompt
    kwargs["messages"] = messages

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


class GeneratorFactory(EdgeFactoryBase):
    @staticmethod
    @global_exception_handler(3014, "Error Executing LLM Edge")
    def execute(
        init_configs: Dict[str, Any] = None,
        extra_configs: Dict[str, Any] = None
    ) -> str:
        return llm_generation(**init_configs)


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    
    context = ["The quick brown fox jumps over the lazy dog."]
    query = "What does the fox jump over?"
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

    response = llm_generation(
        model="deepseek/deepseek-chat-v3-0324:free",
        response_format=structure,
        sys_prompt_template="default",
        user_prompt_template="default",
        context=context,
        query=query,
        max_tokens=1000,
        hoster="openrouter"
    )
    print(response)


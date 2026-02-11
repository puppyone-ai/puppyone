import os
import logging
import requests
from typing import List, Tuple
from Utils.puppy_exception import PuppyException

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
        # Leave empty to avoid false negatives when validating availability
        valid_models = []

    return valid_models

open_router_models = get_open_router_models()
# Restrict exposed model list to only GPT-5
open_router_supported_models = ["openai/gpt-5"]

local_supported_models = [
    "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
]

def get_open_router_llm_settings(
    model: str = None,
    api_key: str = None,
    base_url: str = None,
    supported_models: List[str] = open_router_supported_models,
) -> Tuple[str, str, str]:
    """Resolve OpenRouter settings and validate model support.

    - Defaults to 'openai/gpt-5'
    - Validates against dynamic OpenRouter model list fetched from /models
    - Also restricts to our curated supported list (LLM-only)
    """
    api_key = api_key or os.environ.get("OPENROUTER_API_KEY")
    base_url = base_url or os.environ.get("OPENROUTER_BASE_URL")

    # Normalize model id
    model = model or "openai/gpt-5"
    if model == "gpt-5":
        model = "openai/gpt-5"

    # First ensure it is part of our curated list (LLM-only)
    if supported_models and model not in supported_models:
        raise PuppyException(3701, f"Unsupported model '{model}'. Allowed: {supported_models}")

    # Then verify OpenRouter actually advertises this model id
    try:
        dynamic_models = set(open_router_models or [])
        if dynamic_models and model not in dynamic_models:
            # Best-effort refresh in case cache is stale
            refreshed = set(get_open_router_models())
            if model not in refreshed:
                # Provide a helpful error mentioning a few examples
                sample = list(refreshed)[:5]
                raise PuppyException(3701, f"Model '{model}' not available on OpenRouter /models. Examples: {sample}")
    except Exception:
        # If model listing fails, proceed and let the upstream API return the precise error
        pass

    return api_key, base_url, model

def get_lite_llm_settings(
    model: str = None,
    api_key: str = None,
    base_url: str = None,
) -> Tuple[str, str, str]:
    valid_models = {
        "gpt-5": "openai/gpt-5",
    }
    valid_model = valid_models.get(model, "openai/gpt-5")

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
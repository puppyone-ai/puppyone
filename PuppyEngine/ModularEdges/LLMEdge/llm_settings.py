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
    "perplexity/sonar-reasoning-pro",
    "perplexity/sonar-pro",
    "perplexity/sonar-deep-research"
    "perplexity/r1-1776",
    "perplexity/sonar-reasoning",
    "perplexity/sonar",
    "perplexity/llama-3.1-sonar-large-128k-online",
    "perplexity/llama-3-sonar-large-32k-online",
    "perplexity/llama-3-sonar-small-32k-online",
]

local_supported_models = [
    "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
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
    valid_models = {
        "gpt-4o": "openai/gpt-4o-2024-11-20",
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
    valid_model = valid_models.get(model, "openai/gpt-4o-2024-11-20")

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
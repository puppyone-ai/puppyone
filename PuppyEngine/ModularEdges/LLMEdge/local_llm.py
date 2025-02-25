# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import torch
from threading import Thread
from dataclasses import dataclass
from typing import List, Dict, Generator, Optional
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    TextIteratorStreamer,
    GenerationConfig,
    StoppingCriteria,
    StoppingCriteriaList
)
from Utils.PuppyEngineExceptions import global_exception_handler


@dataclass
class LocalLLMConfig:
    """Configuration for local LLM chat"""
    model_name: str
    device: str = "cuda" if torch.cuda.is_available() else "cpu"
    max_tokens: int = 2048
    temperature: float = 0.7
    top_p: float = 0.95
    top_k: int = 50
    repetition_penalty: float = 1.1
    stop_sequences: Optional[List[str]] = None
    stream: bool = False


class StopOnSequences(StoppingCriteria):
    """Custom stopping criteria for generation"""
    def __init__(
        self,
        stops: List[str] = None,
        tokenizer=None
    ):
        super().__init__()
        self.stops = stops or []
        self.tokenizer = tokenizer

    def __call__(
        self,
        input_ids: torch.LongTensor,
        scores: torch.FloatTensor,
        **kwargs
    ) -> bool:
        if not self.stops:
            return False

        for stop in self.stops:
            stop_ids = self.tokenizer(stop, add_special_tokens=False, return_tensors='pt')
            stop_ids = stop_ids["input_ids"].squeeze().tolist()

            # Check if the last tokens match any stop sequence
            for i in range(len(stop_ids)):
                if input_ids[0][-len(stop_ids[i:]):].tolist() == stop_ids[i:]:
                    return True
        return False


class LocalLLMChat:
    """Chat interface for local LLMs using HuggingFace transformers"""

    def __init__(
        self,
        config: LocalLLMConfig
    ):
        self.config = config
        self.tokenizer = AutoTokenizer.from_pretrained(
            config.model_name,
            trust_remote_code=True
        )
        self.model = AutoModelForCausalLM.from_pretrained(
            config.model_name,
            torch_dtype=torch.float16,
            device_map="auto",
            trust_remote_code=True
        ) if config.device == "cuda" else AutoModelForCausalLM.from_pretrained(
            config.model_name,
            torch_dtype=torch.float32,
            trust_remote_code=True,
            low_cpu_mem_usage=False,
            device_map=None
        ).to("cpu")

        # Set padding token if not set
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

    def _prepare_messages(
        self,
        messages: List[Dict[str, str]]
    ) -> str:
        """Convert message list to prompt string"""

        prompt = ""
        for msg in messages:
            role = msg["role"]
            content = msg["content"]
            if role == "system":
                prompt += f"System: {content}\n"
            elif role == "user":
                prompt += f"User: {content}\n"
            elif role == "assistant":
                prompt += f"Assistant: {content}\n"
        prompt += "Assistant: "
        return prompt

    def _get_generation_config(self) -> GenerationConfig:
        """Get generation config based on settings"""
        return GenerationConfig(
            max_new_tokens=self.config.max_tokens,
            temperature=self.config.temperature,
            top_p=self.config.top_p,
            top_k=self.config.top_k,
            repetition_penalty=self.config.repetition_penalty,
            do_sample=self.config.temperature > 0,
            pad_token_id=self.tokenizer.pad_token_id,
            eos_token_id=self.tokenizer.eos_token_id,
        )

    @global_exception_handler(3603, "Error Generating Response Using Local Models")
    def chat(
        self,
        messages: List[Dict[str, str]],
        stream: bool = None,
        **kwargs
    ) -> Generator[str, None, None] | str:
        """
        Chat with the local LLM
        
        Args:
            messages: List of message dicts with 'role' and 'content'
            stream: Whether to stream the response
            **kwargs: Additional generation parameters
            
        Returns:
            Generator yielding response tokens or complete response string
        """

        # Update config with any passed kwargs
        for k, v in kwargs.items():
            if hasattr(self.config, k):
                setattr(self.config, k, v)

        # Override stream setting if specified
        stream = stream if stream is not None else self.config.stream

        # Prepare input
        prompt = self._prepare_messages(messages)
        inputs = self.tokenizer(prompt, return_tensors="pt").to(self.config.device)

        # Setup generation config
        generation_config = self._get_generation_config()

        # Setup stopping criteria
        stopping_criteria = None
        if self.config.stop_sequences:
            stopping_criteria = StoppingCriteriaList([
                StopOnSequences(self.config.stop_sequences, self.tokenizer)
            ])

        if stream:
            # Setup streamer
            streamer = TextIteratorStreamer(
                self.tokenizer,
                skip_prompt=True,
                skip_special_tokens=True
            )
            
            # Run generation in separate thread
            generation_kwargs = dict(
                **inputs,
                streamer=streamer,
                generation_config=generation_config,
                stopping_criteria=stopping_criteria,
            )
            
            thread = Thread(target=self.model.generate, kwargs=generation_kwargs)
            thread.start()

            # Yield from streamer
            for text in streamer:
                yield text

        else:
            # Generate complete response
            outputs = self.model.generate(
                **inputs,
                generation_config=generation_config,
                stopping_criteria=stopping_criteria,
            )
            response = self.tokenizer.decode(outputs[0], skip_special_tokens=True)
            return response[len(prompt):]


if __name__ == "__main__":
    # Example usage
    config = LocalLLMConfig(
        model_name="microsoft/Phi-3.5-mini-instruct",
        temperature=0.7,
        max_tokens=1000,
        stream=True
    )
    print("Config: ", config)

    chat = LocalLLMChat(config)

    messages = [
        {"role": "system", "content": "You are a helpful AI assistant."},
        {"role": "user", "content": "What is the capital of France?"}
    ]

    # Test streaming
    print("Streaming response:")
    for chunk in chat.chat(messages, stream=True):
        print(chunk, end="", flush=True)
    print("\n")

    # Test complete response
    print("Complete response:")
    response = chat.chat(messages, stream=False)
    print(response)

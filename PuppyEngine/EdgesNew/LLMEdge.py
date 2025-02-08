# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'))

import json
from typing import Dict, Any
from Utils.PuppyEngineExceptions import global_exception_handler
from Edges.Generator import lite_llm_chat

class LLM:
    @global_exception_handler(3005, "Unexpected Error in LLM Edge Execution")
    def process(
        self,
        edge: Dict[str, Any],
        input_blocks: Dict[str, Dict[str, Any]]
    ) -> Dict[str, Dict[str, Any]]:
        """
        Process the LLM edge, replace the placeholders with the actual content, handle structured output, and execute the LLM.

        INPUTS, FOR EXAMPLE:

        edge = {
            "llm-1727235281399": {
                "type": "llm",
                "data": {
                "messages": [
                    {"role": "system", "content": "You are a helpful AI assistant that called {{c}}"},
                    {"role": "user", "content": "introduce yourself as a {{b}}{{c}}"}
                ],
                "model": "gpt-4o",
                "max_tokens": 2048,
                "temperature": 0.7,
                "inputs": {"2": "b", "3": "c"},
                "outputs": {"4": "b"},
                "structured_output": True
                }
            }
        }
        input_blocks = {
            "2": {
                "label": "b",
                "type": "structured",
                "data": {
                    "content": {"name": "Gangstar"},
                    "embedding_view": []
                }
            },
            "3": {
                "label": "c",
                "type": "text",
                "data": {
                        "content": "lovable puppy"
                }
            }
        }

        OUTPUTS, FOR EXAMPLE:
        {
            '4': {
                'data': {
                    'content': {
                        'name': 'Gangstar',
                        'type': 'puppy',
                        'description': (
                            "I'm a lovable puppy with a heart full of energy and affection. "
                            "I love playing fetch, wagging my tail, and giving endless cuddles. "
                            "My playful bark and floppy ears are sure to bring smiles to everyone around me. "
                            "Let's have some fun together!"
                        )
                    }
                }
            }
        }

        """
        # Get the first (and only) value from the edge dictionary
        edge_config = next(iter(edge.values()))
        edge_data = edge_config.get("data", {})
        messages = edge_data.get("messages", [])

        
        # replace the placeholders with the actual content
        # Create a mapping of labels to content from input blocks
        label_to_content = {}
        for block_id, label in edge_data.get("inputs", {}).items():
            if block_id in input_blocks:
                block_content = input_blocks[block_id].get("data", {}).get("content", "")
                label_to_content[label] = str(block_content) 

        # Process each message and replace placeholders
        processed_messages = []
        for message in messages:
            content = message["content"]
            # Replace all {{label}} patterns with corresponding content
            for label, content_value in label_to_content.items():
                placeholder = f"{{{{{label}}}}}"
                # Handle structured content (convert dict to string if necessary)
                content = content.replace(placeholder, content_value)
            
            processed_messages.append({
                "role": message["role"],
                "content": content
            })
        
        messages = processed_messages

        ## Handle structured output
        is_structured_output = edge_data.get("structured_output", False)
        if is_structured_output:
            response_format = {"type": "json_object"}

            # OpenAI's offical requirement, even if it's fucked up
            if is_structured_output:
                response_format = {"type": "json_object"}
                messages.append({"role":"user", "content":"in json format"})
            else:
                response_format = None
        else:
            response_format = None

        ## LLM Execution    
        response = lite_llm_chat(
            history=edge_data.get("history", None),
            messages=messages,
            model=edge_data.get("model", "gpt-4o-2024-08-06"),
            base_url=edge_data.get("base_url", None),
            max_tokens=edge_data.get("max_tokens", 4096),
            temperature=edge_data.get("temperature", 0.7),
            printing=False,
            stream=False,
            response_format=response_format,
        )

        if is_structured_output == False:
            final_response = response
        elif is_structured_output == True:
            final_response = json.loads(response)

        target_block_dict = {}
        # Get the target block ID from outputs if it exists, otherwise use edge_id
        for key, value in edge_data.get("outputs", {}).items():
            target_block_dict[key] = {"data": {"content": final_response}}

        # Return tuple of target block ID and output dictionary
        return target_block_dict 



if __name__ == "__main__":
    test_edge = {
        "llm-1727235281399": {
            "type": "llm",
            "data": {
                "messages": [
                    {"role": "system", "content": "You are a helpful AI assistant that called {{c}}"},
                    {"role": "user", "content": "introduce yourself as a {{b}}{{c}}"}
                ],
                "model": "gpt-4o",
                "max_tokens": 2048,
                "temperature": 0.7,
                "inputs": {"2": "b", "3": "c"},
                "outputs": {"4": "b"},
                "structured_output": True
            }
        }
    }
    
    input_blocks = {
        "2": {
            "label": "b",
            "type": "structured",
            "data": {
                "content": {"name": "Gangstar"},
                "embedding_view": []
            }
        },
        "3": {
            "label": "c",
            "type": "text",
            "data": {
                "content": "lovable puppy"
            }
        }
    }

    edge = LLM()
    result = edge.process(test_edge, input_blocks)
    print(result)
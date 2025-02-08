import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from typing import Dict, Any
from Utils.PuppyEngineExceptions import global_exception_handler
from Sandbox.code_v4 import CustomCode

class Code:
    @global_exception_handler(3011, "Unexpected Error in Code Edge Execution")
    def process(
        self,
        edge: Dict[str, Any],
        input_blocks: Dict[str, Dict[str, Any]]
    ) -> Dict[str, Dict[str, Any]]:
        """
        Process the Code edge, execute the code with provided arguments.

        INPUTS, FOR EXAMPLE:
        edge = {
            "code-1727595538664": {
                "type": "code",
                "data": {
                    "inputs": {"1":"a"},
                    "outputs": {"2":"b"},
                    "code": "def func(arg_1):\n    return(arg_1)\n    \n",
                    "arg_values": {"1":"a"}
                }
            }
        }
        input_blocks = {
        "2": {
            "type": "text",
            "label": "b",
            "data": {
                "content": ""
            },
        "1": {
            "label":"a",
            "type": "text",
            "data": {
                "content": "hello world"
            }
        }

        """
        edge_config = next(iter(edge.values()))
        edge_data = edge_config.get("data", {})
        
        code = edge_data.get("code", "")
        arg_values = edge_data.get("arg_values", {})
        custom_code = CustomCode()
        result = custom_code.execute_restricted_code(code, arg_values)
        return result


if __name__ == "__main__":
    # Test case
    test_edge = {
        "code-1727595538664": {
            "type": "code",
            "data": {
                "inputs": {"1":"a"},
                "outputs": {"2":"b"},
                "code": "def func(arg_1):\n    return(arg_1)\n    \n"
            }
        }
    }
    
    input_blocks = {
        "2": {
            "type": "text",
            "label": "b",
            "data": {
                "content": ""
            }
        },
        "1": {
            "label":"a",
            "type": "text",
            "data": {
                "content": "hello world"
            }
        }
    }
    
    edge = Code()
    result = edge.process(test_edge, input_blocks)
    print(result)

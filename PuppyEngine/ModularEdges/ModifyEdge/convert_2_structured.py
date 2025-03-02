# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import re
import json
import ast
from typing import Any, List, Dict, Union, Tuple
from Utils.PuppyEngineExceptions import global_exception_handler
from ModularEdges.ModifyEdge.modify_strategy import ModifyStrategy


class ModifyConvert2Structured(ModifyStrategy):
    @global_exception_handler(3802, "Error Converting Block Content")
    def modify(
        self
    ) -> Any:
        """
        Convert string content to structured data (dict or list) using various methods.

        Conversion modes:
        - wrap_into_dict: Wraps string in a dictionary with specified key
        - parse_as_json: Parses string as JSON structure
        - parse_as_list: Extracts JSON structures embedded in string into list elements
        - split_by_length: Splits string into chunks of specified length
        - split_by_character: Splits string by specified characters

        Returns:
            Structured data (dict or list) based on conversion mode
        """
        conversion_mode = self.extra_configs.get("conversion_mode", "wrap_into_dict")

        # Handle empty content
        if not self.content or not isinstance(self.content, str):
            return {} if "dict" in conversion_mode else []

        match conversion_mode:
            case "wrap_into_dict":
                dict_key = self.extra_configs.get("dict_key", "value")
                return {dict_key: self.content}
            case "parse_as_json":
                return self.parse_json_from_string(self.content)
            case "parse_as_list":
                return self._extract_mixed_content_to_list(self.content)
            case "split_by_length":
                text_unit_size = self.extra_configs.get("text_unit_size", 1000)
                if not isinstance(text_unit_size, int) or text_unit_size <= 0:
                    raise ValueError("text_unit_size must be a positive integer")
                return [self.content[i:i+text_unit_size] for i in range(0, len(self.content), text_unit_size)]
            case "split_by_character":
                delimiters = self.extra_configs.get("delimiters", [","])
                if not delimiters:
                    return [self.content]
                return self.split_string_by_multiple_delimiters(self.content, delimiters)
            case _:
                raise ValueError(f"Unsupported conversion mode: {conversion_mode}")

    def _try_parse_python_literal(self, text: str) -> Tuple[bool, Any]:
        """
        Try to parse a Python literal (dict, list, etc.) using ast.literal_eval
        
        Args:
            text: String to parse
            
        Returns:
            Tuple of (success, result)
        """
        try:
            result = ast.literal_eval(text)
            if isinstance(result, (dict, list)):
                return True, result
            return False, None
        except (SyntaxError, ValueError):
            return False, None

    def _extract_mixed_content_to_list(
        self,
        text: str
    ) -> List[Any]:
        """
        Extract mixed content from text into a list, preserving structure of JSON objects/arrays.
        
        For example:
        "This is ['a', 'b', 'c'] a {'key': 'value'} test."
        → ["This is", ['a', 'b', 'c'], "a", {'key': 'value'}, "test."]
        
        Args:
            text: Input text possibly containing JSON structures
            
        Returns:
            List containing extracted components with proper types
        """
        if not text.strip():
            return []

        # Try parsing the entire string
        success, result = self._try_parse_python_literal(text)
        if success:
            if isinstance(result, list):
                return result
            return [result]

        # Extract all JSON-like structures with their positions
        result = []
        segments = self._extract_json_segments(text)
        
        # No JSON structures found, return the whole text as a single element
        if not segments:
            return [text.strip()]
            
        # Process text with JSON segments
        last_end = 0
        for start, end, parsed_obj in segments:
            # Add any text before this JSON segment
            if start > last_end:
                prefix = text[last_end:start].strip()
                if prefix:
                    result.append(prefix)
            
            # Add the parsed JSON object
            result.append(parsed_obj)
            last_end = end
        
        # Add any remaining text after the last JSON segment
        if last_end < len(text):
            suffix = text[last_end:].strip()
            if suffix:
                result.append(suffix)
                
        return result

    def _extract_json_segments(
        self, 
        text: str
    ) -> List[Tuple[int, int, Any]]:
        """Extract all valid JSON or Python dict/list structures with their positions."""
        segments = []
        i = 0
        
        while i < len(text):
            # Look for start of JSON/dict/list structure
            if text[i] in '{[':
                i = self._process_potential_json_structure(text, i, segments)
            else:
                i += 1
                
        return segments

    def _process_potential_json_structure(
        self, 
        text: str, 
        start_idx: int, 
        segments: List[Tuple[int, int, Any]]
    ) -> int:
        """Process a potential JSON structure at the given position and update segments list."""
        open_char = text[start_idx]
        close_char = '}' if open_char == '{' else ']'
        start_pos = start_idx
        
        # Find matching close bracket with proper nesting
        level = 1
        i = start_idx + 1
        
        while i < len(text) and level > 0:
            if text[i] == open_char:
                level += 1
            elif text[i] == close_char:
                level -= 1
            i += 1
        
        if level == 0:  # Found complete structure
            self._try_parse_and_add_segment(text, start_pos, i, segments)
            
        return i  # Return the new position

    def _try_parse_and_add_segment(
        self, 
        text: str, 
        start_pos: int, 
        end_pos: int, 
        segments: List[Tuple[int, int, Any]]
    ) -> None:
        """Try to parse a text segment as a Python literal or JSON and add to segments if valid."""
        potential_structure = text[start_pos:end_pos]
        
        # Try Python literal parsing first (handles single quotes)
        success, parsed_obj = self._try_parse_python_literal(potential_structure)
        if success:
            segments.append((start_pos, end_pos, parsed_obj))
            return
        
        # Try standard JSON parsing as fallback
        try:
            parsed_obj = json.loads(potential_structure)
            segments.append((start_pos, end_pos, parsed_obj))
        except json.JSONDecodeError:
            pass  # Not valid structure, ignore

    def parse_json_from_string(
        self,
        input_str: str
    ) -> Union[Dict[str, Any], List[Any]]:
        """
        Parse all valid JSON structures from a string, preserving both JSON and text.
        
        Args:
            input_str: Input string containing potential JSON structures
            
        Returns:
            Dictionary with structured representation of the content
        """
        # Try parsing the entire string as a Python literal first
        success, result = self._try_parse_python_literal(input_str.strip())
        if success:
            return result  # Return as-is if it's a valid Python dict/list
            
        # Then try standard JSON
        try:
            parsed = json.loads(input_str)
            return parsed  # Return as-is if it's valid JSON
        except json.JSONDecodeError:
            pass
            
        # Extract JSON segments with their positions
        segments = self._extract_json_segments(input_str)
        
        # If no valid JSON found, return original as single value
        if not segments:
            return {"text_1": input_str.strip()}
            
        # Create a structured representation with text and objects
        result = {}
        last_end = 0
        text_count = 1
        dict_count = 1
        list_count = 1
        
        for start, end, parsed_obj in segments:
            # Add any text before this JSON segment
            if start > last_end:
                prefix = input_str[last_end:start].strip()
                if prefix:
                    result[f"text_{text_count}"] = prefix
                    text_count += 1
            
            # Add the parsed JSON object with appropriate type key
            if isinstance(parsed_obj, dict):
                result[f"dict_{dict_count}"] = parsed_obj
                dict_count += 1
            elif isinstance(parsed_obj, list):
                result[f"list_{list_count}"] = parsed_obj
                list_count += 1
                
            last_end = end
        
        # Add any remaining text after the last JSON segment
        if last_end < len(input_str):
            suffix = input_str[last_end:].strip()
            if suffix:
                result[f"text_{text_count}"] = suffix
                
        return result

    def split_string_by_multiple_delimiters(
        self,
        string: str,
        delimiters: List[str]
    ) -> List[str]:
        """Split string by multiple delimiter characters."""
        pattern = "|".join(map(re.escape, delimiters))
        split_result = [s.strip() for s in re.split(pattern, string)]
        return [s for s in split_result if s]  # Remove empty strings


if __name__ == "__main__":
    # Test cases
    print("\n=== Testing wrap_into_dict ===")
    content = "Hello, world!"
    extra_configs = {
        "conversion_mode": "wrap_into_dict",
        "dict_key": "greeting"
    }
    converted_content = ModifyConvert2Structured(content=content, extra_configs=extra_configs).modify()
    print(f"Input: {content}\nOutput: {converted_content}")
    
    print("\n=== Testing parse_as_json ===")
    content = "Hello! {'name': 'Test', 'values': [1, 2, 3]} abc[1, 2, 3]"
    extra_configs = {
        "conversion_mode": "parse_as_json",
    }
    converted_content = ModifyConvert2Structured(content=content, extra_configs=extra_configs).modify()
    print(f"Input: {content}\nOutput: {converted_content}")
    
    # Test with just a dictionary string
    content = "{'name': 'Test', 'values': [1, 2, 3]}"
    extra_configs = {
        "conversion_mode": "parse_as_json",
    }
    converted_content = ModifyConvert2Structured(content=content, extra_configs=extra_configs).modify()
    print(f"Input: {content}\nOutput: {converted_content}")

    print("\n=== Testing parse_as_list ===")
    content = "Hello! {'name': 'Test', 'values': [1, 2, 3]} abc[1, 2, 3]"
    extra_configs = {
        "conversion_mode": "parse_as_list",
    }
    converted_content = ModifyConvert2Structured(content=content, extra_configs=extra_configs).modify()
    print(f"Input: {content}\nOutput: {converted_content}")
    content = "[1, 2, 3]"
    extra_configs = {
        "conversion_mode": "parse_as_list",
    }
    converted_content = ModifyConvert2Structured(content=content, extra_configs=extra_configs).modify()
    print(f"Input: {content}\nOutput: {converted_content}")
    content = "abc"
    extra_configs = {
        "conversion_mode": "parse_as_list",
    }
    converted_content = ModifyConvert2Structured(content=content, extra_configs=extra_configs).modify()
    print(f"Input: {content}\nOutput: {converted_content}")
    
    print("\n=== Testing split_by_length ===")
    content = "Large Language Model is a type of AI model that uses a large amount of data."
    extra_configs = {
        "conversion_mode": "split_by_length",
        "text_unit_size": 20
    }
    converted_content = ModifyConvert2Structured(content=content, extra_configs=extra_configs).modify()
    print(f"Input: {content}\nOutput: {converted_content}")
    
    print("\n=== Testing split_by_character ===")
    content = "Hello, World! This is a test."
    extra_configs = {
        "conversion_mode": "split_by_character",
        "delimiters": [",", ".", "!"]
    }
    converted_content = ModifyConvert2Structured(content=content, extra_configs=extra_configs).modify()
    print(f"Input: {content}\nOutput: {converted_content}")

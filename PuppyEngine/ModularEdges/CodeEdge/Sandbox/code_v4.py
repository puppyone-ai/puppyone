import os
import re
import sys
import ast
import json
import logging
import subprocess
from typing import Dict, Any
from operator import getitem
from RestrictedPython import compile_restricted
from RestrictedPython.Guards import safe_builtins
from ModularEdges.EdgeFactoryBase import EdgeFactoryBase
from RestrictedPython.PrintCollector import PrintCollector
from Utils.PuppyEngineExceptions import global_exception_handler


class CoderFactory(EdgeFactoryBase):
    @global_exception_handler(3900, "Error Preprocessing Code")
    def preprocess_code(
        self,
        code_string: str = "",
        variables: dict = {}
    ) -> str:
        """
        Prepares the code string by appending a function call with explicit keyword arguments.

        Args:
            code_string (str): The code string to preprocess.
            variables (dict): A dictionary of variables to pass into the function.

        Returns:
            str: The preprocessed code string.
        """

        signature_regex = r"def\s+([a-zA-Z_]\w*)\s*\((.*?)\)\s*:"
        match = re.search(signature_regex, code_string)

        if not match:
            raise ValueError("Invalid function signature in the provided code string.")

        func_name = match.group(1)  # Extract function name
        arg_names = match.group(2).split(",")  # Extract parameter names

        # Remove any extra spaces and prepare arguments as keyword arguments
        variables = {f"arg_{k}": v for k, v in variables.items()}
        formatted_args = ", ".join(
            f"{arg.strip()}={repr(variables.get(arg.strip(), None))}" for arg in arg_names
        )

        # Append print statement for function execution
        code_string += f"\nprint({func_name}({formatted_args}))"
        return code_string

    @global_exception_handler(3901, "Error Executing Restricted Code")
    def execute(
        self,
        init_configs: Dict[str, Any] = None,
        extra_configs: Dict[str, Any] = None
    ) -> str:
        """
        Executes the restricted code with predefined variables in a sandboxed environment.

        Args:
            code_string (str): The code string to execute.
            variables (dict): A dictionary of variables to pass into the function.

        Returns:
            str: The output of the executed code.
        """

        try:
            # Preprocess the code string
            code_string = init_configs.get("code_string")
            variables = init_configs.get("variables", {})
            code_string = self.preprocess_code(code_string, variables)

            # Set up restricted globals with PrintCollector
            restricted_globals = {
                '__builtins__': safe_builtins,
                '_print_': PrintCollector,
                '_getattr_': getattr,
                '_getiter_': iter,
                '_getitem_': getitem,
                'json': json,
                '_apply_': lambda func, *args: func(*args),
            }

            restricted_globals['_print'] = PrintCollector()

            byte_code = compile_restricted(
                code_string,
                filename='<inline>',
                mode='exec'
            )

            exec(byte_code, restricted_globals)

            output = restricted_globals['_print']()
            output_lines = output.strip().split('\n') if output.strip() else []

            # Return string if single line, otherwise return list
            output = output_lines[0] if len(output_lines) == 1 else output_lines
            try:
                return ast.literal_eval(output)
            except Exception:
                return output

        except Exception as e:
            return f"Error: {str(e)}"

    @global_exception_handler(3902, "Error Creating Virtual Environment")
    def create_virtualenv(
        self
    ):
        venv_dir = os.path.join(self.env_path, self.env_name)
        if not os.path.exists(venv_dir):
            subprocess.run([sys.executable, "-m", "venv", venv_dir])
            logging.info(f"Virtual environment `{self.env_name}` created at {self.env_path}")
        else:
            logging.info(f"Virtual environment `{self.env_name}` already exists at {self.env_path}")

    @global_exception_handler(3903, "Error Installing Dependencies")
    def install_dependencies(
        self,
        requirements_file: str = "code_venv_requirements.txt"
    ):
        venv_python = os.path.join(self.env_path, self.env_name, "Scripts" if os.name == "nt" else "bin", "python")
        requirements_file = os.path.join(self.env_path, requirements_file)

        # Upgrade pip and install dependencies
        subprocess.run([venv_python, "-m", "pip", "install", "--upgrade", "pip"])
        subprocess.run([venv_python, "-m", "pip", "install", "-r", requirements_file])

        logging.info(f"Dependencies installed in virtual environment `{self.env_name}`")


if __name__ == "__main__":
    variables = {
        'arg_a': 3,
        'arg_b': 4
    }
    sample_code = """
def add_two_numbers(arg_a, arg_b):
    return arg_a + arg_b
"""

    results = CoderFactory.execute(init_configs={"code_string": sample_code, "variables": variables})
    print("\nExecution Results:")
    print("------------------")
    print("results: ", results)

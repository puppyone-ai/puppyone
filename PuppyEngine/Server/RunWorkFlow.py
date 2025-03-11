import os
import sys
import json
import logging
import argparse
from typing import Any, Dict, List, Optional, Union
from pathlib import Path
from WorkFlow import WorkFlow
from dotenv import load_dotenv

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()


class TerminalColors:
    """
    ANSI color codes for terminal output
    """

    HEADER = '\033[95m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'


class JsonPrinter:
    """
    Handles formatted JSON output with color support
    """

    def __init__(
        self,
        max_length: int = 1000
    ):
        self.max_length = max_length

    def _shorten_strings(
        self,
        obj: Any
    ) -> Any:
        """
        Truncate long strings in JSON data structures
        """

        if isinstance(obj, dict):
            return {k: self._shorten_strings(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [self._shorten_strings(item) for item in obj]
        elif isinstance(obj, str) and len(obj) > self.max_length:
            return (f"{obj[:self.max_length]}"
                   f"{TerminalColors.YELLOW}... [truncated, total length: {len(obj)}]"
                   f"{TerminalColors.ENDC}")
        return obj

    def _colorize_json(
        self,
        json_str: str
    ) -> str:
        """
        Add color highlighting to JSON string
        """

        return (json_str
                .replace('"', f'{TerminalColors.GREEN}"')
                .replace('": ', f'"{TerminalColors.ENDC}: ')
                .replace('true', f'{TerminalColors.YELLOW}true{TerminalColors.ENDC}')
                .replace('false', f'{TerminalColors.YELLOW}false{TerminalColors.ENDC}')
                .replace('null', f'{TerminalColors.RED}null{TerminalColors.ENDC}'))

    def print_json(
        self,
        data: Union[str, Dict, List],
        title: Optional[str] = None
    ) -> None:
        """
        Format and print JSON data with optional title
        """
        if title:
            logger.info(f"{TerminalColors.BOLD}{TerminalColors.CYAN}"
                       f"{title}{TerminalColors.ENDC}")

        # Convert string to JSON if possible
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except json.JSONDecodeError:
                pass

        # Format and print the data
        if isinstance(data, (dict, list)):
            shortened_data = self._shorten_strings(data)
            formatted_json = json.dumps(shortened_data, ensure_ascii=False, indent=2)
            colored_json = self._colorize_json(formatted_json)
            logger.info(colored_json)
        else:
            logger.info(str(data))


class WorkflowRunner:
    """
    Handles workflow execution and file processing
    """

    def __init__(
        self,
        step_mode: bool = False
    ):
        self.step_mode = step_mode
        self.json_printer = JsonPrinter()

    def _process_json_file(
        self,
        file_path: Path
    ) -> Optional[Dict]:
        """
        Process a single JSON file and handle errors
        """

        try:
            return json.loads(file_path.read_text(encoding='utf-8'))
        except json.JSONDecodeError as e:
            self._handle_json_error(file_path, e)
        except Exception as e:
            logger.error(f"Error reading file '{file_path}': {str(e)}")
        return None

    def _handle_json_error(
        self,
        file_path: Path,
        error: json.JSONDecodeError
    ) -> None:
        """
        Handle and display JSON parsing errors
        """

        logger.error(f"Invalid JSON format in file '{file_path}'")
        logger.error(f"Error location: Line {error.lineno}, Column {error.colno}")
        logger.error(f"Error message: {error.msg}")

        try:
            lines = file_path.read_text(encoding='utf-8').splitlines()
            if 0 <= error.lineno-1 < len(lines):
                error_line = lines[error.lineno-1]
                logger.error(f"Problematic line: {error_line}")
                logger.error(f"{' ' * (error.colno-1)}^ Error position")
        except Exception:
            pass

    def run_workflow(
        self,
        data: Dict
    ) -> None:
        """
        Execute workflow with the provided data
        """

        outputs = []
        workflow = WorkFlow(data, step_mode=self.step_mode)
        batch_count = 0

        for output_blocks in workflow.process():
            batch_count += 1
            logger.info(f"Received output blocks: {output_blocks}")
            outputs.append(output_blocks)

            if output_blocks:
                logger.info(f"\n===== Batch #{batch_count} Output Blocks =====")
                self.json_printer.print_json(output_blocks)

        # Print final status
        logger.info("\n===== Final Block Status =====")
        self.json_printer.print_json(workflow.blocks)

        # Print summary
        logger.info("\n===== Batch Processing Summary =====")
        logger.info(f"Processed {batch_count} batches, "
                   f"generated {sum(len(out) for out in outputs)} output blocks")

        workflow.clear_workflow()

    def process_files(
        self,
        files: List[Path]
    ) -> None:
        """
        Process multiple workflow files
        """

        for file_path in files:
            logger.info(f"\n{'=' * 25} {file_path.name} {'=' * 25}")

            if data := self._process_json_file(file_path):
                self.run_workflow(data)


def parse_arguments() -> argparse.Namespace:
    """
    Parse and validate command line arguments
    """

    parser = argparse.ArgumentParser(description="Workflow Engine Test Runner")
    parser.add_argument(
        "--step",
        action="store_true",
        help="Enable step-by-step testing mode"
    )
    parser.add_argument(
        "--file",
        type=Path,
        help="Specify a single JSON file to test"
    )
    parser.add_argument(
        "--dir",
        type=Path,
        default=Path("TestKit/"),
        help="Specify directory containing JSON test files"
    )
    return parser.parse_args()


def get_files_to_process(
    args: argparse.Namespace
) -> List[Path]:
    """
    Determine which files to process based on arguments
    """

    if args.file:
        if not args.file.is_file():
            logger.error(f"File not found: '{args.file}'")
            sys.exit(1)
        return [args.file]

    if not args.dir.is_dir():
        logger.error(f"Directory not found: '{args.dir}'")
        sys.exit(1)

    files = list(args.dir.glob("*.json"))
    if not files:
        logger.warning(f"No JSON files found in '{args.dir}'")
        sys.exit(0)

    return files


def main():
    """
    Main entry point for the workflow runner
    """

    args = parse_arguments()
    files = get_files_to_process(args)

    runner = WorkflowRunner(step_mode=args.step)
    runner.process_files(files)


if __name__ == "__main__":
    main()

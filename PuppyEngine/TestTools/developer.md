## Test and Debug in production

### Concept

The `TestActionflow` class is designed to test a specific action flow in debug mode. It allows developers to modify attributes of a stored `puppy_instance` and execute the modified instance multiple times to test the stability and success rate. The class provides both an inline mode and an interactive command-line mode for modifying attributes, making it versatile for different testing scenarios.

### Code Design

The `TestActionflow` class is structured to:

- Initialize with an instance of the class to be tested.
- Provide methods to modify attributes either inline or through a command-line interface.
- Execute the action flow from specified nodes.
- Save the modified instance in a pickle file and its modifiable attributes in a JSON file.

### Parameters and Attributes

#### Attributes

- `puppy_instance`: The instance of the class being tested.
- `GREEN`, `GREY`, `RED`, `RESET`: Color codes for terminal output.

#### Public Methods

- `__init__`: Initializes the `TestActionflow` instance.
- `test_run`: Executes the code in debug mode.
- `inline_mode`: Modifies the attribute values via  monkey patching.
- `command_line_mode`: Provides an interactive command-line interface for modifying attributes.
- `execute_code`: Executes the code from the specified node number.
- `save_updated_puppy_instance`: Saves the updated instance to a pickle file.
- `save_instance_to_json`: Saves the instance attributes to a JSON file.

#### Private Methods

- `_parse_inner_json`: Parses an object into inner JSON objects.
- `_advanced_print`: Advanced print function for both standard and self-defined types.
- `_set_code_node`: Sets the code nodes tobe executed based on the given node number.
- `_separate_runtime_dict`: Separates a dictionary into picklable and non-picklable values.
- `_find_differences`: Finds differences between dictionaries in a list.
- `_convert_value`: Converts the input value from `str` to the target type.
- `_input_value`: Ensures the input value is of the target type.
- `_modify_list`: Modifies list attributes element-wise.
- `_has_nested_attr`: Checks if the object has a nested attribute.
- `_get_nested_attr`: Gets the value of a nested attribute.
- `_set_nested_attr`: Sets the value of a nested attribute.

### Detailed Code Logic of `test_run` Method

```python
def test_run(
    self,
    node_num: int,
    num_of_action: int,
    handle_exceptions: bool = True,
    use_command_line: bool = False,
    updates: dict = None
) -> list:

```

#### Parameters

- `node_num`: Specifies the node to start execution from.
    - `0`: The current code.
    - `1`: From the current code to all future codes.
    - `1`: From history codes to the current code.
    - `2`: All code nodes.
    - `2`: The last node of history codes, the current code, and the first node of future codes.
- `num_of_action`: The number of times to execute the action flow.
- `handle_exceptions`: If `True`, stops and returns the exception on error. If `False`, captures exceptions and includes them in the results list.
- `use_command_line`: If `False`, applies inline updates. If `True`, provides a command-line interface for updates.
- `updates`: Dictionary of attribute updates for inline mode.

#### Logic

1. Updates attributes either inline or via command line.
2. Executes the specified code nodes `num_of_action` times.
3. Handles exceptions based on `handle_exceptions`.
4. Return a list of dictionaries that stores the result of each execution. 
    
    Note: Only the first element contains the full values, the rest elements only contains the values that are different to the first element so as to save the printing length and storage.
    
5. Saves the updated instance and execution results.

#### Inline Mode

The `inline_mode` function allows developers to update the attribute values of a `puppy_instance` using a provided dictionary. This method is straightforward, where each key-value pair in the dictionary is used to set the corresponding attribute in the `puppy_instance`. If an attribute does not exist, an error is raised.

#### Command-line Mode

The `command_line_mode` function provides an interactive interface for developers to modify the attribute values of a `puppy_instance` and execute code nodes multiple times for testing purposes. This mode is highly useful for fine-tuning and debugging the `puppy_instance` attributes on the fly.

**Interaction Logic**

1. **Display Attributes**:
    - The current attributes and their values of the `puppy_instance` are displayed.
2. **Prompt for Action**:
    - Developers are asked whether they want to execute codes (`y`) or change attributes (`n`).
3. **Executing Codes**:
    - If `y`, the specified code nodes are executed multiple times, and the results are displayed.
    - Developers can choose to exit the test run or continue.
4. **Changing Attributes**:
    - If `n`, developers can input the attribute name to change.
    - The current value of the attribute is displayed.
    - If the attribute is a list, specific elements can be modified.
    - For other types, the new value is input and set.
    - Developers can choose to modify another attribute or return to the initial prompt.

#### Benefits

The `command_line_mode` is recommended as it provides a robust and interactive way to fine-tune and debug `puppy_instance` attributes, making it easier for developers to iteratively test and refine their code. This method ensures a streamlined workflow for testing and debugging, improving development efficiency.

#### Example Usage

```python
# Initialize with an instance of the class
tester = TestActionflow(puppy_instance)

# Run test with inline updates
results = tester.test_run(
    node_num=0,
    num_of_action=5,
    handle_exceptions=True,
    use_command_line=False,
    updates={"attribute_name": "new_value"}
)

# Run test with command-line updates
results = tester.test_run(
    node_num=0,
    num_of_action=5,
    handle_exceptions=True,
    use_command_line=True
)

```

### Detailed Code Logic of Other Public Methods

#### `inline_mode`

Modifies attributes inline based on the provided `updates` dictionary.

```python
def inline_mode(self, updates: dict) -> None:
```

#### `command_line_mode`

Provides an interactive command-line interface for modifying attributes.

```python
def command_line_mode(
    self,
    num_of_action: int,
    node_num: int,
    results: list,
    handle_exceptions: bool = True
) -> list:
```

`execute_code_multiple_times` 

Execute the code multiple times and append the results to the results list.

```python
def execute_code_multiple_times(
        self,
        num_of_action: int,
        node_num: int,
        results: list,
        handle_exceptions: bool = True
    ) -> list:
```

#### `execute_code`

Executes code from the specified node number.

```python
def execute_code(self, node_num: int) -> dict:
```

#### `save_updated_puppy_instance`

Saves the updated instance to a pickle file.

```python
def save_updated_puppy_instance(
	self, 
	root_path: str = "user_case_history", 
	file_name: str = "puppy_instance_updated.pkl"
) -> None
```

#### `save_instance_to_json`

Saves all key-value pairs of an instance to a JSON file.

```python
def save_instance_to_json(
	self, 
	instance: dict, 
	root_path: str = "user_case_history", 
	file_name: str = "puppy_instance_values.json"
) -> None:
```

### Customizing `test_run` Method

To customize the `test_run` method, you can call other public methods for specific purposes.

#### Example: Inline Mode Customization

```python
# Initialize with an instance of the class
tester = TestActionflow(puppy_instance)

# Modify attributes inline
tester.inline_mode({"attribute_name": "new_value"})

# Execute code from a specific node
result = tester.execute_code(node_num=0)

# Save the updated instance
tester.save_updated_puppy_instance()

```

#### Example: Command-Line Mode Customization

```python
# Initialize with an instance of the class
tester = TestActionflow(puppy_instance)

# Modify attributes via command-line interface
tester.command_line_mode()

# Execute code from a specific node
result = tester.execute_code(node_num=0)

# Save the updated instance into a specific path
tester.save_updated_puppy_instance(
	root_path = "debuging_log", 
	file_name = "updated_instance.pkl"
)

```

### Summary

The `TestActionflow` class provides a robust framework for testing and debugging action flows. It allows for detailed modification of instance attributes and repeated execution to test stability. The class supports both inline and command-line modes for attribute updates, making it flexible for various testing needs.

#### Possible Future Works

- **Enhance attribute modification**: Provide more intuitive ways to modify deeply nested attributes.
- **Improve error handling**: Enhance exception handling to provide more detailed error messages.
- **Expand functionality**: Add more methods to support different types of testing scenarios and enhance the overall testing framework.
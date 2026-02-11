
## Tutorial

### Building a Gaming Agent

Let's start building a more complicated and useful agent using `Puppys`!

In the *escape room* game, the agent will play as a cute puppy locked in a room. The puppy must collect keys to open the door so it can get back its freedom and delicious food!


The simple game requires agents to solve puzzles, navigate environments, and interact with various game elements dynamically.

This showcase is given in the `user_case/room_escape/` directory, which contains three files:

- agent_client.py: game environment definition for the gaming agent
- escaping.py: prompts and other configurations of the gaming agent
- game_server.py: game server on the local host


To run the example, you must first install the `pygame` dependency.
```shell
pip install pygame
```
Then, you can start the gaming server on a local host.
```shell
python user_case/room_escape/game_server.py
```
Keep the server process running, and then run the gaming agent in another terminal.
```shell
python user_case/room_escape/agent_client.py
```
Now your little puppy starts working on the puzzle, let's see whether it can reach the door!

### Game Overview and Rules

#### Game Description

The *escape room* game is set on a grid-based map where each cell contains one object, such as a key, box, wall, or an exit door. The agent is self-controlled with the goal of finding the correct keys specified in the client (some hidden in boxes) and using them to unlock the door and escape the room.

##### Core Mechanics

- **Grid**: The room is represented as a grid where each square might contain a key (box), a door, a wall, or be empty.
- **Agent**: Move around the grid to interact with objects.
- **Keys and Boxes**: Keys can be freely lying around or contained within boxes. Boxes need to be opened to reveal contents.
- **Door**: The escape objective. It requires certain keys to be opened.

##### Rules

- The agent must navigate to collect keys.
- All required keys must be collected to unlock and open the door.
- Movement is constrained by walls and the edges of the grid.
- The game wins when the agent opens the door.

### Building a gaming agent using `Puppys` 

#### Setting Up the Game (Server-side)

- **`GameSettings`**: Configures basic game settings like grid size and display properties.
- **`Grid`**: Manages the game space where walls, keys, and the door are placed. Responsible for the logical state of the game environment.
- `Game`: The server manages the game state and handles requests from the client, ensuring that the game logic is processed correctly based on the agent's actions.

#### Setting Up the Game (Client-side)

##### ServerConnection Class

- Handles data transfer between the game server and the client.
- Sends commands to the server and processes the game state updates received.
- Manages connection integrity and re-establishes connection if needed.

##### Agent Tools Setup

Tools are crucial for the agentic system to perform real-world tasks, going beyond mere text generation to executing meaningful actions. Large Language Models (LLMs) cannot act by default; therefore, they rely on tools to perform specific actions when given appropriate instructions. Each tool encapsulates a particular action the agent can execute within the game, aligning closely with the game mechanics and rules, such as moving the agent or using a key.

In the Puppys framework, tools are defined as regular Python functions. It is essential to provide comprehensive documentation for each function to guide the LLM on how to utilize these tools correctly. This documentation should contextualize the tool within the application's rules and objectives, ensuring that the agent can perform actions effectively and appropriately.

It is worth mentioning that the LLM does not interpret the underlying logic of these tools; it simply utilizes them. Thus, developers must ensure these tools are error-free and perfectly aligned with intended functionalities since the LLM treats them as reliable actions to be executed.

**Recommended Documentation Template:**

- **Function Description:** Briefly describe what the function does, ideally linking it to the application's context, like the escape room rules and game elements in this use case.
- **Parameters:** List all free parameters the function accepts (DO NOT include any fixed parameters), clearly stating their types and the role they play.
- **Returns:** Describe what the function returns after execution.
- **Notes:** Emphasize some points that the agent might get confused and point out that the positional arguments have to be written while writing code to call the function.
- **Examples:** Provide examples demonstrating various ways the function can be used, covering as many scenarios as possible to guide the LLM's interaction with the tool.

**Sample Function Definitions:**

```python
def move_agent(connection: ServerConnection, direction: str, step: int) -> None:
    """
 Moves the agent on the game grid based on the specified direction and number of steps.
 Parameters:
 - direction (str): The direction to move (up, down, left, right).
 - step (int): The number of grid spaces to move.
 Returns:
 - None
 Note: 
 You HAVE TO write the positional arguments when writing code to call the function.
 Example Usage:
 move_agent(direction="down", step=3)  # Moves the agent three steps down.
 """
    # [Implementation details]
```

#### Customizing the Agent

The agent class in the Puppys framework is a crucial component that encapsulates all the features and attributes needed for your custom agent. Here's a detailed walkthrough of building the agent class, specifically the `Escaper` class for our room escape game.

##### Inheritance from Puppy Class

The `Escaper` class inherits from the `Puppy` parent class. `Puppy` includes all necessary features and attributes needed for building a customized agent.

In the `__init__` method, you initialize the `Puppy` class, set the agent's name, description, and version, and establish a connection to the server.

```python
class Escaper(Puppy):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.name = "Escaper"
                self.description = "A puppy that can play the game room escape."
                self.version = "0.0.1"
```

##### `FuncEnv`: The Functional Environment

The `FuncEnv` is a subclass of the `Env` class, designed specifically for functions. It includes the concept of fixed parameters and free parameters to provide more flexibility while interpreting functions as an environment:

- **Fixed Parameters**: These are predefined by the developers and won't be known or altered by the agent.
- **Free Parameters**: These were decided and adjusted by the agent during execution.

This design ensures that the agent only performs authorized actions, enhancing security and preventing incorrect actions.

```python
self.move_agent = FuncEnv(
    value=move_agent,
    name=move_agent.__name__,
    description=move_agent.__doc__,
    fixed_params={"connection": self.connection},
    free_params=["direction", "step"]
)
```

##### Creating the Game Environment

**Using the `Env` Class to Represent the Game Environment:**

The `get_game_env` method in the Escaper class is designed to create a nested `Env` instance representing the game map. While this method is not strictly necessary for building a custom agent, it is crucial in the room escape scenario. It allows the agent to understand the current game environment, make informed decisions, and act accordingly.

Unlike the `FuncEnv` class, which is tailored for functions, the `Env` class can encapsulate any type of object, providing a flexible way to represent the entire game environment. You can specify the value, name, and description for each environment, making it highly adaptable.

**Nested Environments:**

A key feature of the `Env` class is its ability to define nested environments. This means you can have multiple sub-environments within a main environment. In the room escape game, the main environment `game_map` represents the entire game map. Within this, there are several sub-environments, such as:

- **agent_location**: Represents the agent's current position.
- **door_status**: Indicates whether the door is open or closed.
- **available_keys**: Lists the keys the agent has collected.
- **used_keys**: Tracks the keys the agent has used.
- **target_keys**: Shows the keys needed to win the game.

**Visibility and Exploration:**

Environments can be either visible or invisible. All self-defined environments are visible by default and can be explored to fetch their values, names, and descriptions. However, certain environments within the `Puppys` framework, such as `Actionflow` and `PuppyVars`, are invisible and cannot be explored.

This feature allows some parts of the environment to remain hidden initially and be revealed when necessary. Information can only be explored one layer deep. For example, under the main environment, only the `game_map` and other `Env` instances will be explored initially. All other sub-environments (like `agent_location`, `door_status`, etc.) can only be explored under the `game_map` environment. This hierarchical structure allows for a more organized exploration of the environment.

**Utilizing Explored Results:**

The explored results can be used in prompts to help the LLM understand the current state. They can also be utilized in function tools to control what is needed and what is not, and to easily switch between different environments for various actions. This structured approach ensures that the agent has a clear and comprehensive understanding of the game environment, enabling it to make effective decisions and actions.

**Example of Nested Environments:**

```python
game_map = Env(
    name= "The current game map",
    description=grid_string
)
game_map.agent_location = Env(
    name= "The agent's current location",
    description=f"({agent_y}, {agent_x})."
)
game_map.door_status = Env(
    name= "The door status",
    description=door_dict
)
game_map.available_keys = Env(
    name= "The keys you've already taken",
    description=available_keys
)
game_map.used_keys = Env(
    name= "The used keys",
    description=used_keys
)
game_map.target_keys = Env(
    name= "The target keys",
    description=target_keys
)
```

#### The Escaping Action

The final necessary step in customizing an agent is to equip it with actions. Unlike the function tools of the `FuncEnv` type, actions are common Python functions built for calling the Large Language Model (LLM) and processing its responses. While the previous steps involve setting up the environment and defining tools, actions are the real tasks the agent performs using the LLM as a base to complete specific goals.

Actions serve as the entry points for understanding human instructions and performing the corresponding tasks. The `Puppys` framework includes several predefined actions, such as:

- **do**: Performs a specified task.
- **check**: Checks whether a task has been finished.
- **do_check**: Combines the `do` and `check` steps.

Additional actions include:

- **rewrite**: Rewrites the human query, prompt, or instructions to better align with the equipped function tools, enhancing the LLM's ability to identify the most appropriate tool for the current step.
- **go_to**: Switches to another `Env` instance.

##### **Designing Custom Actions**

Although the action concept is designed for using the LLM as the base, actions can also be LLM-excluded. They can be performed independently, included in other LLM-included actions, or used directly in the custom action flow function. All LLM-based actions are defined using the `Action` class, which includes general functionalities, making it easier to customize new actions.

##### Example of exploring the game map `Env`

```python
# Get the game state
envs = explore(
    environment=puppy_instance.env_node, 
    target=Env, 
    output_content_mode= "attribute", 
    attributes=["name", "description"]
)

sub_game_map = explore(
    environment=puppy_instance.env_node.game_map, 
    target=Env, 
    output_content_mode= "attribute", 
    attributes=["name", "description"]
)

game_map_dict = {"game_map": envs.get("game_map")}
game_map_dict.update(sub_game_map)

# Convert into formatted string to be inserted in the prompt
game_map_string =""
for value in game_map_dict.values():
 game_map_string += f"{value['name']}: {value['description']}\n"
```

##### LLM prompt template for the customized action

```python
prompt = [
 {"role": "system",
         "content": """
Objective: As an AI code agent, your goal is to help the agent escape the room by collecting keys with specific key names and using them to open the exit door. You need to write Python codes to achieve these.

1. You always write Python code! You are really good at it. Your natural language output should be written as a comment in Python code.
You can express your thoughts and reasons in the comment.
 For example: # Hello, I am an agent. 

2. Your code will be run immediately after you write it. If you assume any hypothetical function, the the system will crash. 

3. Your response cannot only be a comment. You HAVE to write codes

4. Make sure that the parameter in your response code follows the type of the parameter in the function instruction. 

5. About the Game: [Game Descriptions]

6. About the movement: [Movement Rules]

7. Rules for Escaping (win/end the game): [Winning Strategies]

8. Game Mechanics: [Game Rules]

9. Additional Notes: [Some notes on the points that the LLM might get confused]

Ensure each part of your response contains Python code actions for the next step, following the example provided, with concise and clear logic comments embedded in the code.
Your response should be similar to the following example(ONLY CODE) and NOTHING ELSE.
"""},
        # 2. Provide the current var and usable keys
 {"role": "user",
         "content": f"""
Your formally-defined parameters and their previewing are as follows: 
{puppy_instance.puppy_vars.preview()}

Check if the undefined or unspecific variables are in the above preview, if so, use them when needed in your code.

Your default function is writing Python dictionaries.
You are also allowed to use the customized functions below; use them by just writing code as an example. The description shows how to use them. You are not allowed to call functions that are out of the given range and Python popular package:
{explore(environment=puppy_instance.env_node, target=FuncEnv, output_content_mode="attribute", attributes=["name", "description"])}

You are only allowed to generate code that replaces the `self.escaping(...)` part and write code to control the agent to escape the room for the next step ONLY.

The current game map and all the relevant information about the current game status are included below; read them carefully to understand the current game environment and plan your next actions accordingly.
{game_map_string}

[Additional Notes]

# Example codes for using all the keys available:
[Few-Shot Examples]

Now, write your code to control the agent to escape the room:
"""}]
```

##### Example: Using the `Action` Class

The code in `escaping.py` demonstrates how to use the `Action` class to build a new action. You can use this as a template for creating your own actions. Each LLM-based action allows the LLM to write code to perform tasks, adhering to the framework's code-driven approach. The `Action` class's methods handle various aspects of code processing during execution, such as:

- **Highlighting the action**: Highlighting the current action being performed.
- **Cleaning the code**: Filter out the markdown symbols for the code section to keep only the codes.
- **Running with or without error handling**: Executing the code with appropriate error management.
- **Replacing code**: Optionally replacing the action codes from the original action flow with the current code written by the LLM.

If the code is replaced, it is stored as the current code in the `puppy_instance` (the instance of the `Puppys` class defined for your custom agent). In the room escape case, this is the `Escaper` class. This allows the prompts for the LLM to include the current replaced code, informing the LLM of the actions already performed and what needs to be done next, thus avoiding redundant actions. The detailed guide on how to do this can be found in the `prompts` in the `do.py`.

##### Action Parameters

All LLM-included actions have to have `show_prompt` and `show_response` as part of the parameters:

- **show_prompt**: Displays the complete prompt for the current action without any formatted string parts.
- **show_response**: Prints the response produced by the LLM in the terminal to keep users informed about the ongoing process.

```python
action = Action(
 puppy_instance,
        action_name="",
        show_prompt=show_prompt,
        show_response=show_response,
        retries=0,
        replace_code=True
 )

 action.highlighting(
        action_type= "escaping",
        prompt=prompt,
        prompt_action= "escaping"
 )

 new_code = open_ai_chat(
        prompt=prompt, 
        model=model, 
        printing=show_response, 
        stream=True
 )

 new_code = action.clean_llm_code(new_code, add_code=True)

    # Run the code
    try:
        return action.run_without_errors(new_code)
    # Handle errors
    except Exception as e:
 error_details = action.run_with_errors(e)
        print(error_details)
```

#### Building the Action Flow

The action flow is a function that serves as the entry point for directing the agent's actions. Although it is a method in the `Escaper` class, its code body is defined outside the class. The default parameter for this function is `self`, which refers to the instance of the class, but additional parameters can be added as needed, just like any standard Python class method.

In the action flow, you can call the `escaping` action using `self.escaping` to instruct the agent to perform tasks necessary for escaping the room. The action flow defines the action flow by combining typical Python code with calls to the actions. This integration ensures that the agent's code merges seamlessly with the developer's code, ultimately creating a temporary action flow that can be reused.

This aspect of the framework highlights the benefits of a code-driven agent framework, which positions the agent as an assistant that helps developers code, build applications, and execute tasks without any gap. The action flow function in `agent_client.py` exemplifies this by defining the action flow in native Python code, supporting features like package imports, variable assignments, if statements, loops, inner functions, and inner classes. Developers can insert actions wherever needed to fit the overall action flow.

In the room escape scenario, a loop keeps calling the `escaping` action, prompting the LLM to write code using the function tools to perform the next step until the agent successfully escapes the room or the server-side connection is closed. A sleep function is used to avoid incomplete updates on the server side.

The overall code in the action flow is divided into various blocks based on Python's Abstract Syntax Tree (AST), ensuring that necessary code segments (like loops or if statements) remain intact and not separated line by line. During execution, the code runs block by block in sequence, with previous runtime values updated to the next ones to prevent data loss.

The LLM is only called within the action (e.g., `escaping`), not within the action_flow itself. Therefore, the LLM is unaware of the variables defined or values changed in the action flow. The framework stores all action flow codes during execution and splits them into `history_codes`, `current_code`, and `future_codes`. These can be inserted into the prompt using formatted strings, allowing access to variable values under the `actionflow` attribute of the `puppy_instance` (i.e., `self` in the action flow):

- `puppy_instance.actionflow.history_codes`
- `puppy_instance.actionflow.current_code`
- `puppy_instance.actionflow.future_codes`

You can then specify these and explain how the LLM can use the previous variables when generating the next part of the code. Alternatively, defining and storing values as class attributes rather than common variables is more intuitive. For example, in the action flow function, `self.target_keys` is defined rather than `target_keys`. As such, `self.target_keys` is treated as an `Env` and explored during execution, allowing the agent to automatically know the variable and its value, with values updated after modifications.

The action flow function does not need to be named `action_flow`. You can name it whatever you prefer, as long as it includes `self` as the default parameter.

##### Example Code

Here's how you can structure the action flow:

```python
def action_flow(self, target_keys):
    import time
    # Convert the target keys to lowercase to avoid case-sensitive issues
    self.target_keys = [keys.lower() for keys in target_keys]
    # Pre-update the target keys to the server
    self.connection.update_state({"target_keys": target_keys})
    while True:
        # Check if the door is open or the game is over, if so, close the connection
        self.game_state = self.connection.fetch_state()
        if self.game_state.get("door_dict", {}).get("open") or not self.game_state:
            self.connection.close()
            break
        # Using the LLM to generate the next action's code and execute it
        self.escaping(show_response=True)
        # Update the game map environment after each action
        self.game_map = self.get_game_env()
        # Sleep for 2 seconds to wait for the agent's action to be completely executed
 time.sleep(2)
```

##### Running the action flow

- **Initialization**: An instance of the Escaper class is created initialized with the action flow function that defines the agent's behavior.

```python
escaper = Escaper(action_flow)
```

- **Execution**: The action flow method is invoked to start the game loop, which continues until the game is won or terminated.

```python
escaper.run(target_keys=["yellow", "blue"])
```

## What's Next

### Saving and Reusing the Action Flow

After running the action flow, the real action flow will be saved in `user_case_history/temp_actionflow_code.py`. You can easily copy this entire action flow function to other codebases, allowing you to reuse the agent-generated code. This integration avoids the need for repeated calls to the LLM, saving both time and costs while providing a more stable and robust codebase.

### Debugging with the Saved `puppy_instance`

The `puppy_instance` is saved in `user_case_history/puppy_instance.pkl`. For debugging purposes, you can call the `test_run` method, which enables you to tweak and test the agent's behavior.

```python
escaper.test_run(
    node_num=-1, # Run all the code after value changes
    num_of_action=2, # Execute the same code twice
    handle_exceptions=False, # Does not handle exceptions
    max_length=1000, # Maximum output length in the terminal is 1000
    use_command_line=True # Use the command line to debug interactively
)
```

In the `test_run` method, you can modify any attribute values within `puppy_instance` to observe changes in the execution results. This iterative process helps you determine the optimal set of attribute values for executing the current action flow. For more instructions on test and debugging, please check the documentation on `puppys.pp.default_env.actionflow.debug_actionflow`.

By using these saved resources, you can streamline development and debugging processes, ensuring your agent performs efficiently and effectively.

<!-- ## Conclusion

This guide provides a structured approach to developing an interactive room escape game using the `Puppys` framework. By following the steps described, developers can leverage the framework's capabilities to build complex code-based agent-driven games and applications. -->


## PuppyAgent

All powered by  [<img src="../PuppyAgent.png" height="18" alt="Description" />](https://www.puppyagent.com)
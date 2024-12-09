*Environment-Oriented Programing Framework for AI Agents*

[![Twitter](https://img.shields.io/badge/-PuppyAgent-1DA1F2?style=flat&logo=X&logoColor=ffffff&color=%23000000&)](https://twitter.com/PuppyAgentTech) &ensp;
[![Discord](https://img.shields.io/badge/-PuppyAgent-7289DA.svg?logo=discord&labelColor=%235462eb&logoColor=%23ffffff&color=%235462eb&label=&style=flat)](https://discord.com/channels/1249674961199829053/1249674961644163164)

## Install

1. Set up the local virtual environment (you can skip this if you want a global install).
 ```bash
    python3 -m venv my_env
    source my_env/bin/activate
 ```
2. Clone the repository from Github
 ```bash
    git clone https://github.com/PuppyAgent/Puppys.git
 ```
3. Install from the local project directory
 ```bash
    cd Puppys
    pip install requirements.txt
    pip install -e .
 ```
4. You can also install the stable version directly from `pip`.
 ```bash
    pip install Puppys
 ```

## Getting Started

### Configure your API key

First, you need an API key to access at least one large language model. For the capability of agent applications, we recommend GPT4o or GPT4 Turbo from [OpenAI](https://help.openai.com/en/articles/4936850-where-do-i-find-my-openai-api-key).

1. In your project directory, create a file `your_working_dir/.env`. This file will contain your environment variables.

2. Open the `your_working_dir/.env` file and add your environment variables in the format KEY=VALUE. For example:
```
OPEN_API_KEY=your_api_key_here
DATABASE_URL=your_database_url_here
```

Other LLM models are also supported via the [`litellm`](https://github.com/BerriAI/litellm) proxy. You can configure the default LLM chat used by agents by creating an instance of `FunEnv`.

If you want to enable more tools for your agent, e.g., a search engine, you must further configure their API keys. We use [perplexity search](https://www.perplexity.ai/) as the default search engine.

### A simple example

Here is a [simple example](https://github.com/PuppyAgent/Puppys/blob/main/user_case/hacker_news.py) that shows how to make an agent that can fetch news from the internet with only a few instructions.

First, we import a minimal agent template `Mei` from `Puppys`, which contains basic functionalities including LLMs request, web search, and Python script execution.

```python
from puppys.pp.mei import Mei
```
Next, we define the *action flow* for the `Mei`, which sets the goal or tasks for it to achieve. Here, a series of milestones are set in the action flow using the `do_check` method. The `do_check` method will instruct the agent to take actions for a milestone and finally check whether the milestone is accomplished upon the completion of each action taken.
In this simple example, the agent is required to fetch some news from the "hacker news" webpage.

```python
def hacker_news_action_flow(self, url):

    self.do_check(f"go to the given {url}, save the page's HTML", show_response=True)

    self.do_check("show the top 10 news @llm, and send it to me", show_response=True)

    self.do_check("pick the news that related to Large Language Models, summarize all the news, and send it to me", show_response=True)
```

While we call the method an "action flow", it can actually be a tree with many different branches. Hence, the logic and behavior of the agent will be straightforward. It will try to accomplish these milestones one by one by taking a flow of actions. More complicated action flows are possible to define using a combination of `do` and `check` (together as `do_check`) methods and the integrated compound statements (e.g. `if`, `while`) in Python.

```python
hacker_news = Mei(value=hacker_news_action_flow)
hacker_news.run(url="https://news.ycombinator.com/")
```

Finally, we can pass the action flow as an argument to instantiate an agent called `hacker_news`. The agent will start working once the `run` method is invoked. Now, you get a hacker newsagent that can fetch hacker news for you!

### Example Gallery

For more examples, you can check the [user cases](https://github.com/PuppyAgent/Puppys/blob/main/user_case/) folder on Github. These cases demonstrate how `puppies` can be used to automate various simple tasks, including text games, internet searching, or data analysis.

## What Is an LLM Agent?

A Large Language Model (LLM) or Artificial Intelligence (AI) agent is a specialized software entity that utilizes an LLM to perform various tasks autonomously.

For example, you may want your AI copilot to automatically write and execute a piece of code for you directly instead of telling you how to write it and letting you copy the code and run it yourself.
That simple step from *talking* to *doing* makes a huge difference between a chatbot and an agent.
Imagine you are the manager of a company. You may need consultants who advise you on what to do, but you will definitely need a hardworking team that can get the job done, and that is what LLM agents will be doing in the future.
This small step will make LLMs, or more generally, AIs, indispensable parts of human production and eventually change the way people work.

According to OpenAI, the ability of artificial intelligence can be ranked into five levels:

1. Chatbots
2. Reasoners
3. Agents
4. Innovators
5. Organizers

In 2024, state-of-the-art LLMs like GPT-4o are somewhere between level 2 and level 3. While LLMs have been successful at chatting, searching, and consulting, they still lack the ability to help people do tasks or jobs directly.

### Basic Elements

What is the most fundamental difference between an LLM and an agent? Our answer to this question is:

- An LLM predicts the next token.
- An agent predicts the next action.

When you give your agent a task, the agent must be able to autonomously or interactively understand what needs to be done first, check what knowledge, data, or instruments are available or need to be used, and then decide how to solve the problem step by step; and finally, perform these actions one by one. If problems are encountered, the agent should also be able to adjust its strategy according to feedback or at least report these issues.
One can summarise these elements as follows:

- Sensing
- Planning
- Executing
- Reacting

This is a highly simplified version of what an autonomous agent is expected to do. While this process seems relatively straightforward, in reality, it can be highly non-linear and involves a lot of uncertainties and iterations.

### Challenges

Predicting the next action is called *decision making* in cognitive science, which, as we know, is not only difficult for artificial intelligence but also challenging even for humans ourselves.
Today, state-of-the-art LLMs already have a decent ability to reasoning and a broader knowledge base than average individuals. Yet, they still can't deal with some tasks that can be easily handled by humans.
Two major challenges exist in the decision-making process of LLMs.

1. Enormous space for possible actions
2. Incomplete information on environments

Due to the two challenges listed above, LLMs-based agents are still a state-of-the-art concept instead of a ready-for-production technology.
At the current moment, despite many exploratory works from various teams worldwide, there has yet to be a consensus in academics and industry about how a good agent should be designed or how it should behave.

## Philosophy  of `Puppys`

The `Puppys` is a framework for developing LLM-based agents.
We hope the framework could make it easier for engineers and scientists to develop agentic systems and applications.

### Environment-Oriented

Natural history tells us it is intelligence that distinguishes humans from other species and makes us succeed in natural selection. Yet, while intelligence is mostly attributed to the human brain, few realize a homo-sapine must use his eyes and ears first to gather sufficient information before he can use his brain to make a good decision.
We believe that *sensing environment* is as important as making decisions.

Let us consider two fundamental questions: What is the *environment* of an LLM agent? How should an LLM agent *detect* and *perceive* its environment?

Our answer to the first question is that the *environment* of an agent is specified by its mission. For an agent designed for stock trading, the share prices of NASDAQ and available (financial) instruments will be its environment. For an agent designed for data analysis, the database and available visualizing tools will be its environment. By detecting the environment, the agent should be able to answer the two questions:
Which situation is faced by the agent? Which tools or resources are available?

Our answer to the second question is limited by the nature of LLMs, that LLM agents can only sense their environment through *structured texts*.
The *structured texts* contain any information encoded in text format, including but not limited to text, data, and code in various non-binary formats (.txt, .json, .csv, .md, .html, .xml, .py, .cpp).
`Puppys` is designed to be an *environment-oriented* agentic framework. It provides a general interface (encapsulated as `Env`) for an LLM agent to sense its environment, as well as a mechanism to dynamically update its knowledge of the environment after taking action.

By properly defining and customizing the `Env` corresponding to specific tasks, developers can easily create a robust, adaptive agent that can adjust its behaviors from varying environments and feedback that is capable of highly complicated tasks. 

<div align="center">
<img src="../../assets/environment_oriented.png" alt="Image" width="800">
</div>

### Code-Driven

Let us consider another fundamental question: How should an LLM agent actually *do* things or perform actions?
Our answer to this question is that **LLM agents do things via code**.
We believe that the LLM agent should play a role as the translator between the nonexecutable natural language and the executable programming language. In future workflows, humans will give orders and instructions while LLM agents generate scripts and codes to make ideas come to life.
The`Puppys` framework is designed to *be code-driven*. When having the agent predict the next action, `Puppys` generates not only natural language to describe the action but also **code** that performs the actions.

<div align="center">
<img src="../../assets/PuppyVsOthers.png" alt="Image" width="800">
</div>
The programming language also provided a natural way to extend the ability of LLMs. Via a set of application programming interfaces (APIs), LLM-based agents can seamlessly interact with the existing software systems and use the available external instruments to perform many tasks beyond their original capability.

### Hybrid Decision Making

Another fundamental question for LLM-based agents is how to make decisions or predict the next actions. As we discussed before -- delegating the decision-making process completely to the LLM behind an agent is not a *good* solution.
Our answer to this question is that considering the current capability of LLMs, we should leave the macro or strategic decision-making and planning to humans but delegate the micro or tactical decision-making and problem-solving to LLMs.
<div align="center">
<img src="../../assets/AgentRPA_1.png" alt="Image" width="800">
</div>

Instead of allowing the LLM to make arbitrary decisions and act completely by itself, like in the case of an autonomous system, the human user is required to set a series of *fixed milestones* in the path to the final goal, while the agent is allowed to make decisions and take actions between one milestone and the next. By reducing the size of possible action space and regulating the behaviors of agents, these milestones can effectively improve the robustness and efficiency of LLM-based agents. 

This hybrid decision-making for agents is implemented in the `Puppys` framework, allowing users to customize the logic level they would like to delegate to LLM when designing an agent.
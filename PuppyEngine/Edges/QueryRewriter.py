# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import re
import json
from typing import Dict, List
from Edges.Generator import lite_llm_chat
from Utils.PuppyEngineExceptions import global_exception_handler


class QueryRewriter:
    def __init__(
        self,
        query: str,
        model: str = "gpt-4o"
    ):
        """
        Initialize the QueryRewriter with the original query.
        
        :param query: The original query string provided by the user.
        """

        self.original_query = query
        self.model = model

    def _execute_lite_llm_chat(
        self,
        prompt: List[Dict[str, str]]
    ) -> str:
        """
        Execute a Lite LLM chat conversation with the given prompt.

        :param prompt: The list of prompt messages for the chat conversation.
        :return: The response string from the chat conversation.
        """

        response = lite_llm_chat(
            messages=prompt,
            model=self.model,
            temperature=0.3,
            max_tokens=4096,
            printing=True,
            stream=True
        ).strip()
        return response

    @staticmethod
    @global_exception_handler(3900, "Error Parsing LLM Response")
    def _safe_eval(
        expression: str
    ) -> List[str]:
        """
        Safely extract and evaluate a list of strings from a given LLM response string.
        
        :param expression: The string expression to evaluate.
        :return: The evaluated list of strings.
        """

        try:
            # Regular expression to match a list of strings in the format ["string1", "string2", ...]
            list_pattern = re.compile(r'\[\s*("[^"]*"(?:\s*,\s*"[^"]*")*)\s*\]')
            match = list_pattern.search(expression)
            if match:
                # Extract the list string and safely load it using json.loads
                list_str = match.group(0)
                result = json.loads(list_str)
                if isinstance(result, list) and all(isinstance(item, str) for item in result):
                    return result
            raise ValueError("No valid list of strings found in the expression.")
        except Exception as e:
            raise ValueError(f"Safe eval error: {str(e)}")

    @global_exception_handler(3901, "Error Rewrite Using Multi-Query")
    def multi_query(
        self, 
        num_query: int
    ) -> List[str]:
        prompt = [
            {
                "role": "system",
                "content": f"""
Your task is to generate {num_query} different versions of the given user question to retrieve relevant documents from a vector database. 
By generating multiple perspectives on the user question, your goal is to help the user overcome some of the limitations of the distance-based similarity search.

Example:
User"s input:
"Who won a championship more recently, the Red Sox or the Patriots?"

Your output:
[
    "When was the last time the Red Sox won a championship?",
    "When was the last time the Patriots won a championship?"
]
"""
            },
            {
                "role": "user",
                "content": self.original_query
            }
        ]

        multi_q = self._execute_lite_llm_chat(prompt)
        return self._safe_eval(multi_q)

    @global_exception_handler(3902, "Error Rewrite Using Query Expansion")
    def query_expansion(
        self
    ) -> List[str]:
        prompt = [
            {
                "role": "system",
                "content": """
Your task is to expand the given user query by adding related terms, synonyms, and relevant keywords. 
The goal is to enhance the query"s ability to retrieve more comprehensive results from the database.

Example:
User"s input:
"renewable energy sources"

Your output:
[
    "renewable energy sources",
    "alternative energy sources",
    "green energy",
    "sustainable energy sources"
]
"""
            },
            {
                "role": "user",
                "content": self.original_query
            }
        ]

        expanded_query = self._execute_lite_llm_chat(prompt)
        return self._safe_eval(expanded_query)

    @global_exception_handler(3903, "Error Rewrite Using Query Relaxation")
    def query_relaxation(
        self
    ) -> str:
        prompt = [
            {
                "role": "system",
                "content": """
Your task is to relax the given query by broadening its scope. 
This may involve replacing specific terms with more general ones or removing restrictive conditions.

Example:
User"s input:
"best sushi restaurants in downtown San Francisco"

Your output:
"best sushi restaurants in San Francisco"
"""
            },
            {
                "role": "user",
                "content": self.original_query
            }
        ]

        relaxed_query = self._execute_lite_llm_chat(prompt)
        return relaxed_query.strip()

    @global_exception_handler(3904, "Error Rewrite Using Query Segmentation")
    def query_segmentation(
        self
    ) -> List[str]:
        prompt = [
            {
                "role": "system",
                "content": """
Your task is to segment the given complex query into smaller, independent sub-queries that can be answered individually.

Example:
User"s input:
"How to improve fuel efficiency in cars and what are the most efficient hybrid models?"

Your output:
[
    "How to improve fuel efficiency in cars?",
    "What are the most efficient hybrid models?"
]
"""
            },
            {
                "role": "user",
                "content": self.original_query
            }
        ]

        segmented_query = self._execute_lite_llm_chat(prompt)
        return self._safe_eval(segmented_query)

    @global_exception_handler(3905, "Error Rewrite Using Query Scoping")
    def query_scoping(
        self
    ) -> str:
        prompt = [
            {
                "role": "system",
                "content": """
Your task is to focus or narrow down the given user query by adding specific constraints or clarifications, making the query more precise.

Example:
User"s input:
"latest smartphone releases"

Your output:
"latest smartphone releases in 2024"
"""
            },
            {
                "role": "user",
                "content": self.original_query
            }
        ]

        scoped_query = self._execute_lite_llm_chat(prompt)
        return scoped_query.strip()

    @global_exception_handler(3906, "Error Rewrite Using Sub-Question Query")
    def sub_question_query(
        self
    ) -> List[str]:
        prompt = [
            {
                "role": "system",
                "content": """
Your task is to break down the given complex query into smaller, more specific sub-questions that can be addressed individually.

Example:
User"s input:
"How do renewable energy sources compare in terms of cost, efficiency, and environmental impact?"

Your output:
[
    "How do renewable energy sources compare in terms of cost?",
    "How do renewable energy sources compare in terms of efficiency?",
    "How do renewable energy sources compare in terms of environmental impact?"
]
"""
            },
            {
                "role": "user",
                "content": self.original_query
            }
        ]

        sub_questions = self._execute_lite_llm_chat(prompt)
        return self._safe_eval(sub_questions)

    @global_exception_handler(3907, "Error Rewrite Using HYDE Query")
    def hyde_query_conversion(
        self
    ) -> str:
        prompt = [
            {
                "role": "system",
                "content": """
Your task is to convert the given query into a detailed pseudo-document that captures the context and intent of the query.

Example:
User"s input:
"Who is the current president of the USA?"

Your output:
"The current president of the United States is Joe Biden, who assumed office on January 20, 2021. Biden, a member of the Democratic Party, previously served as the 47th vice president from 2009 to 2017 under President Barack Obama."
"""
            },
            {
                "role": "user",
                "content": self.original_query
            }
        ]

        pseudo_doc = self._execute_lite_llm_chat(prompt)
        return pseudo_doc.strip()

    @global_exception_handler(3908, "Error Rewrite Using Step-Back Prompting")
    def step_back_prompting(
        self
    ) -> List[str]:
        prompt = [
            {
                "role": "system",
                "content": """
Your task is to generate a more general or abstract version of the given query to retrieve broader context, followed by specific sub-queries for detailed retrieval.

Example:
User"s input:
"What are the economic effects of climate change in developing countries?"

Your output:
[
    "What are the effects of climate change?",
    "What are the economic effects of climate change?",
    "What are the economic effects of climate change in developing countries?"
]
"""
            },
            {
                "role": "user",
                "content": self.original_query
            }
        ]

        step_back_queries = self._execute_lite_llm_chat(prompt)
        return self._safe_eval(step_back_queries)

    @global_exception_handler(3909, "Error Rewrite Using Rewrite-Retrieve-Read")
    def rewrite_retrieve_read(
        self
    ) -> List[str]:
        prompt = [
            {
                "role": "system",
                "content": """
Your task is to rewrite the given query for improved retrieval, perform the retrieval, and then generate a final response based on the combined information.

Example:
User"s input:
"How to improve website SEO rankings?"

Your output:
[
    "How to improve SEO rankings for websites?",
    "How to improve Google search rankings?"
]
"""
            },
            {
                "role": "user",
                "content": self.original_query
            }
        ]

        rewritten_queries = self._execute_lite_llm_chat(prompt)
        return self._safe_eval(rewritten_queries)

    @global_exception_handler(3910, "Error Rewrite Using Query-to-Doc")
    def query2doc(
        self
    ) -> str:
        prompt = [
            {
                "role": "system",
                "content": """
Your task is to generate a pseudo-document from the given query that captures all relevant context and information, to be used for enhanced retrieval.

Example:
User"s input:
"What is the history of the internet?"

Your output:
"The history of the internet began with the development of electronic computers in the 1950s. The initial concept of packet networking originated in several computer science laboratories in the United States, United Kingdom, and France. The US Department of Defense awarded contracts as early as the 1960s, including for the development of the ARPANET, which later became the foundation for the internet we know today."
"""
            },
            {
                "role": "user",
                "content": self.original_query
            }
        ]

        pseudo_doc = self._execute_lite_llm_chat(prompt)
        return pseudo_doc

    @global_exception_handler(3911, "Error Rewrite Using Iter-Retgen")
    def iter_retgen(
        self,
        iterations: int = 3
    ) -> List[str]:
        prompt = [
            {
                "role": "system",
                "content": f"""
Your task is to iteratively refine the retrieval and generation process for the given query over {iterations} iterations. 
With each iteration, generate a more refined query and retrieve more specific information.

Example:
User"s input:
"Explain the impact of climate change on polar bears."

Your output for each iteration might look like:
[
    "How does climate change affect polar bears in the Arctic region?",
    "What are the primary causes of habitat loss for polar bears?",
    "How do rising temperatures specifically affect the hunting patterns of polar bears?"
]

The goal is to narrow down the query with each iteration, getting closer to specific and detailed aspects of the original question.
"""
            },
            {
                "role": "user",
                "content": self.original_query
            }
        ]

        iter_results = []
        current_query = self.original_query

        for i in range(iterations):
            # Generate the next iteration of the query refinement
            response = self._execute_lite_llm_chat(
                [
                    {"role": "system", "content": f"Iteration {i+1}: {prompt[0]['content']}"},
                    {"role": "user", "content": current_query}
                ]
            )
            refined_query = self._safe_eval(response)
            iter_results.append(refined_query)
            # Get the most refined one
            current_query = refined_query[-1]
        return iter_results


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    rewriter = QueryRewriter("What is your name?")
    print(rewriter.multi_query(3))

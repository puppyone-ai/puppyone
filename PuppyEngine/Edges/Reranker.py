# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import os
import json
from typing import List, Dict
from abc import ABC, abstractmethod
import cohere
from torch import no_grad
from transformers import AutoTokenizer, AutoModelForSequenceClassification
from Utils.PuppyEngineExceptions import global_exception_handler
from Edges.Generator import lite_llm_chat


class BaseReranker(ABC):
    @abstractmethod
    def rerank(
        self,
        query: str,
        retrieval_chunks: List[str],
        top_k: int = 5
    ) -> List[Dict[str, float]]:
        pass


class LLMBasedReranker(BaseReranker):
    def __init__(
        self,
        model_name: str = None
    ):
        self.model_name = model_name if model_name else "gpt-4o"
  
    @global_exception_handler(3302, "Error Parsing Reranked Content from LLM")
    def _safe_parse_response(
        self,
        response: str
    ) -> List[dict]:
        json_str = ""
        bracket_count = 0
        inside_list = False

        for char in response:
            if char == "[":
                if not inside_list:
                    inside_list = True
                bracket_count += 1
            elif char == "]":
                bracket_count -= 1

            if inside_list:
                json_str += char

            if bracket_count == 0 and inside_list:
                break

        # Parsing the collected JSON-like string
        try:
            return json.loads(json_str)
        except json.JSONDecodeError:
            return []

    @global_exception_handler(3301, "Error Reranking Using LLM")
    def rerank(
        self,
        query: str,
        retrieval_chunks: List[str],
        top_k: int = 5
    ) -> List[Dict[str, float]]:
        sys_prompt = """
You will be provided with a list of strings and a query. Your task is to rank the strings based on their relevance to the given query and assign a score between 0 to 1 for each string, where 1 indicates the highest relevance and 0 indicates no relevance.

When ranking and scoring the strings, follow these guidelines:
- Do not rely solely on keyword matching. Instead, assess the overall context and meaning of each string in relation to the query.
- Consider the diversity of the content. Strings that offer unique or varied perspectives related to the query should be prioritized higher.
- Ensure that the top-ranked strings provide a comprehensive overview of the different aspects related to the query.

The input will be structured as follows:
A query string will be preceded by the label "query:".
A list of strings, each on a new line, will be provided following the label "doc:".

The output should be a ranked list of the strings along with their respective scores, from the most relevant and diverse to the least.
Provide the output in the following format:

[
    {"doc": "Most relevant and diverse string", "score": 0.95},
    {"doc": "Second most relevant and diverse string", "score": 0.85},
    ...
    {"doc": "Least relevant and diverse string", "score": 0.70}
]

Here is an example you can use as a reference:
Example input:
query: "environmental impact of plastic waste"
docs:
"Plastic waste contributes to marine pollution."
"Plastic can take hundreds of years to decompose."
"Plastic waste management practices vary globally."
"Innovations in biodegradable plastics."

Example output:
[
    {"doc": "Plastic waste contributes to marine pollution.", "score": 0.95},
    {"doc": "Innovations in biodegradable plastics.", "score": 0.85},
    {"doc": "Plastic can take hundreds of years to decompose.", "score": 0.80},
    {"doc": "Plastic waste management practices vary globally.", "score": 0.75}
]
"""
        prompt = [
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": f"query: {query}\ndocs: {retrieval_chunks}"}
        ]

        response = lite_llm_chat(
            messages=prompt,
            model=self.model_name,
            temperature=0.3,
            max_tokens=4096,
        )

        final_response = self._safe_parse_response(response)
        return final_response[:top_k]


class HuggingFaceReranker(BaseReranker):
    def __init__(
        self,
        model_name: str
    ):
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.model = AutoModelForSequenceClassification.from_pretrained(model_name)

    @global_exception_handler(3303, "Error Reranking Using Hugging Face Reranking Model")
    def rerank(
        self,
        query: str,
        retrieval_chunks: List[str],
        top_k: int = 5
    ) -> List[Dict[str, float]]:
        self.model.eval()

        pairs = [[query, chunk] for chunk in retrieval_chunks]
        with no_grad():
            inputs = self.tokenizer(pairs, padding=True, truncation=True, return_tensors="pt", max_length=512)
            scores = self.model(**inputs, return_dict=True).logits.view(-1, ).float()

        top_score_indexes = scores.argsort(descending=True)[:top_k]
        ranked_results = [{"doc": pairs[index][1], "score": scores.tolist()[index]} for index in top_score_indexes]
        return ranked_results


class CohereReranker(BaseReranker):
    def __init__(
        self,
        model_name: str = None
    ):
        self.client = cohere.Client(os.environ.get("COHERE_API_KEY"))
        self.model = model_name if model_name else "rerank-english-v3.0"

    @global_exception_handler(3304, "Error Reranking Using Cohere Reranking Model")
    def rerank(
        self,
        query: str,
        retrieval_chunks: List[str],
        top_k: int = 5
    ) -> List[Dict[str, float]]:
        response = self.client.rerank(
            model=self.model,
            query=query,
            documents=retrieval_chunks,
            top_n=top_k,
        )

        final_results: List[Dict[str, float]] = []
        for result in response.results:
            final_results.append({"doc": retrieval_chunks[result.index], "score": result.relevance_score})
        return final_results


class RRFReranker(BaseReranker):
    @global_exception_handler(3305, "Error Reranking Using Reciprocal Rank Fusion")
    def rerank(
        self,
        query: str,
        retrieval_chunks: List[str],
        top_k: int = 5
    ) -> List[Dict[str, float]]:
        def rrf_score(docs):
            fused_scores = {}
            k = 60
            for rank, doc in enumerate(docs):
                doc_str = doc
                if doc_str not in fused_scores:
                    fused_scores[doc_str] = 0
                fused_scores[doc_str] += 1 / (rank + k)
            reranked_results = [{"doc": doc, "score": score} for doc, score in sorted(fused_scores.items(), key=lambda x: x[1], reverse=True)]
            return reranked_results

        results = rrf_score(retrieval_chunks)
        return results[:top_k]


class RerankerFactory:
    @staticmethod
    @global_exception_handler(3300, "Error Creating Reranker")
    def get_reranker(
        reranker_type: str,
        model_name: str = None
    ) -> BaseReranker:
        reranker_classes = {
            "llm": LLMBasedReranker,
            "huggingface": HuggingFaceReranker,
            "cohere": CohereReranker,
            "rrf": RRFReranker
        }

        reranker_class = reranker_classes.get(reranker_type.lower())
        if not reranker_class:
            raise ValueError(f"Unsupported Reranking Type: {reranker_type}!")

        return reranker_class(model_name) if model_name else reranker_class()


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    query = "What is your name?"
    retrieval_chunks=["I am developer", "I am a human", "I am Jack", "Hello", "Working"]
    
    reranker = RerankerFactory.get_reranker(reranker_type="llm")
    result = reranker.rerank(query=query, retrieval_chunks=retrieval_chunks, top_k=3)
    print("LLM-Based Reranker Results:", result)

    reranker = RerankerFactory.get_reranker(reranker_type="huggingface", model_name="BAAI/bge-reranker-base")
    result = reranker.rerank(query=query, retrieval_chunks=retrieval_chunks, top_k=3)
    print("Hugging Face Reranker Results:", result)

    reranker = RerankerFactory.get_reranker(reranker_type="cohere")
    result = reranker.rerank(query=query, retrieval_chunks=retrieval_chunks, top_k=3)
    print("Cohere Reranker Results:", result)

    reranker = RerankerFactory.get_reranker(reranker_type="rrf")
    result = reranker.rerank(query=query, retrieval_chunks=retrieval_chunks, top_k=3)
    print("RRF Reranker Results:", result)

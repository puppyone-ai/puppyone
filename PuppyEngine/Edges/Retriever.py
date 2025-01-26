# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import json
import math
from typing import List, Dict, Tuple
from transformers import AutoTokenizer
from Edges.ExecuteStorage import StorageServerClient
from Utils.PuppyEngineExceptions import global_exception_handler
from Edges.Generator import lite_llm_chat

# Global Storage Client
StorageClient = StorageServerClient()


class Retriever:
    def __init__(
        self,
        retriever_type: str,
        documents: List[str] = None
    ):
        self.retriever_type = retriever_type.lower()
        self.documents = documents
        if self.retriever_type == "word":
            self.init_bm25(corpus=self.documents)

    @global_exception_handler(3400, "Error Retrieving Chunks")
    def retrieve(
        self,
        top_k: int = 10,
        threshold: float = None,
        **kwargs
    ) -> List[Tuple[str, float]]:
        retriever_dict = {
            "word": self.bm25_retrieve,
            "llm": self.llm_retrieve,
            "vector": self.vector_retrieve
        }
        retriever = retriever_dict.get(self.retriever_type)
        if not retriever:
            raise ValueError(f"Unsupported Retriever Type: {self.retriever_type}!")
        return retriever(top_k=top_k, threshold=threshold, **kwargs)
    
    @ global_exception_handler(3401, "Error Initializing BM25 Scorer")
    def init_bm25(
        self,
        corpus: List[str],
        model_name: str = "bert-base-multilingual-cased"
    ):
        """
        BM25 initialization.
        
        Args:
            corpus (List[str]): List of documents as the corpus.
            model_name (str): Tokenizer model for multilingual tokenization.
        """

        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.corpus = corpus
        self.tokenized_corpus = [self._tokenize(doc) for doc in corpus]
        self.doc_count = len(corpus)
        self.avg_doc_len = sum(len(doc) for doc in self.tokenized_corpus) / self.doc_count
        self.inverted_index = self._build_inverted_index()
        self.doc_freq = self._calculate_doc_frequencies()
        self.k1 = 1.5  # BM25 constant
        self.b = 0.75  # BM25 constant

    def _tokenize(
        self,
        text: str
    ) -> List[str]:
        """
        Tokenize a document using the tokenizer.
        
        Args:
            text (str): The document to tokenize.
            
        Returns:
            List[str]: List of tokens.
        """

        return self.tokenizer.tokenize(text)

    def _build_inverted_index(
        self
    ) -> Dict[str, List[int]]:
        """
        Build an inverted index for the corpus.
        
        Returns:
            Dict[str, List[int]]: Dictionary mapping tokens to document indices.
        """

        inverted_index = {}
        for idx, tokens in enumerate(self.tokenized_corpus):
            for token in set(tokens):
                if token not in inverted_index:
                    inverted_index[token] = []
                inverted_index[token].append(idx)
        return inverted_index

    def _calculate_doc_frequencies(
        self
    ) -> Dict[str, int]:
        """
        Calculate document frequencies for all tokens in the corpus.
        
        Returns:
            Dict[str, int]: Dictionary of token and their document frequencies.
        """

        return {token: len(docs) for token, docs in self.inverted_index.items()}

    def _score(
        self,
        query: List[str],
        doc_idx: int
    ) -> float:
        """
        Calculate the BM25 score for a query against a single document.
        
        Args:
            query (List[str]): Tokenized query.
            doc_idx (int): Document index to score against.
            
        Returns:
            float: BM25 score.
        """

        doc_tokens = self.tokenized_corpus[doc_idx]
        doc_len = len(doc_tokens)
        score = 0.0

        for token in query:
            if token not in self.inverted_index:
                continue

            term_freq = doc_tokens.count(token)
            doc_freq = self.doc_freq[token]
            idf = math.log((self.doc_count - doc_freq + 0.5) / (doc_freq + 0.5) + 1)

            numerator = term_freq * (self.k1 + 1)
            denominator = term_freq + self.k1 * (1 - self.b + self.b * (doc_len / self.avg_doc_len))
            score += idf * (numerator / denominator)

        return score

    @global_exception_handler(3402, "Error Retrieving Using BM25 Scorer")
    def bm25_retrieve(
        self,
        top_k: int = 5,
        threshold: float = None,
        query: str = None
    ) -> List[Dict[str, float]]:
        """
        Search the corpus for a given query and return top-k results within the threshold.

        Args:
            query (str): Query string.
            top_k (int): Number of top results to return.
            threshold (float): Minimum score threshold to include a result.

        Returns:
            List[Dict[str, float]]: List of documents with their scores.
        """

        if query is None:
            raise ValueError("Query cannot be None.")
        
        tokenized_query = self._tokenize(query)
        raw_scores = []

        # Calculate scores for all documents
        for idx in range(self.doc_count):
            score = self._score(tokenized_query, idx)
            raw_scores.append({"doc_index": idx, "score": score})

        # Normalize scores
        max_score = max(raw_scores, key=lambda x: x["score"])["score"]
        min_score = min(raw_scores, key=lambda x: x["score"])["score"]
        score_range = max_score - min_score

        # Avoid division by zero
        if score_range == 0:
            normalized_scores = [{"doc_index": doc["doc_index"], "score": 1.0} for doc in raw_scores]
        else:
            normalized_scores = [
                {"doc_index": doc["doc_index"], "score": (doc["score"] - min_score) / score_range}
                for doc in raw_scores
            ]

        # Apply threshold if specified
        if threshold is not None:
            normalized_scores = [doc for doc in normalized_scores if doc["score"] >= threshold]

        # Sort and return top-k results
        return sorted(normalized_scores, key=lambda x: x["score"], reverse=True)[:top_k]

    @global_exception_handler(3403, "Error Parsing Chunks from LLM Scorer")
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

    @global_exception_handler(3404, "Error Retrieving Using LLM Scorer")
    def llm_retrieve(
        self,
        top_k: int = 10,
        threshold: float = None,
        query: str = "",
        llm_prompt_template: str = "",
    ) -> List[Tuple[str, float]]:
        relevances = []

        llm_prompt_template = (
            llm_prompt_template
            if llm_prompt_template
            else """
Given the query and a list of documents, evaluate the relevance of the document to the query.
Consider the following aspects:
1. Keyword overlap
2. Semantic similarity in meaning
3. Matching language style and tone
4. Pattern recognition and textual structure
Please provide a relevance score between 0 and 1, with 1 being highly relevant.
Return in the format of a list of dictionaries, where each dictionary contains the document and the relevance score.

Example:
query: "What did the quick brown fox do?"
documents: ["The quick brown fox jumps over the lazy dog."]
Output:
[{ "document": "The quick brown fox jumps over the lazy dog.", "relevance": 0.8 }]
"""
        )
        user_prompt = f"""
Given the query:
{query}

And the following documents: 
{self.documents}

Output:
"""

        messages = [
            {"role": "system", "content": llm_prompt_template},
            {"role": "user", "content": user_prompt},
        ]
        response = lite_llm_chat(
            messages=messages,
            model="gpt-4o",
            temperature=0.9,
            max_tokens=1024
        )

        # Parse the response string as a list of dictionaries
        relevance_dicts = self._safe_parse_response(response)
        for d in relevance_dicts:
            document = d.get("document", "")
            relevance = float(d.get("relevance", 0.0))

            # Apply the threshold if specified
            if threshold is None or relevance >= threshold:
                relevances.append((document, relevance))

        relevances = sorted(relevances, key=lambda x: x[1], reverse=True)
        return relevances[:top_k]

    @global_exception_handler(3405, "Error Retrieving Using Embedding Scorer")
    def vector_retrieve(
        self,
        top_k: int = 10,
        threshold: float = None,
        query: str = "",
        model: str = "text-embedding-ada-002",
        db_type: str = "pgvector",
        collection_name: str = ""
    ) -> List[Tuple[str, float]]:
        search_configs = {
            "query": query,
            "model": model,
            "vdb_type": db_type,
            "top_k": top_k,
            "threshold": threshold,
        }
        vector_results = StorageClient.search_embedded_vector(
            collection_name=collection_name,
            search_configs=search_configs
        )

        return vector_results


if __name__ == "__main__":
    from dotenv import load_dotenv

    load_dotenv()
    
    def print_results(title: str, results: List[Tuple[str, float]]):
        print(f"\n{title}:")
        for i, (doc, score) in enumerate(results):
            print(f"  {i+1}. {doc} (Score: {score})")

    corpus = [
        "The quick brown fox jumps over the lazy dog.",
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
        "Hola, cómo estás? Estoy aprendiendo BM25 con Python.",
        "こんにちは、元気ですか？PythonでBM25を学んでいます。",
        "你好，你在做什么？我在用Python学习BM25。"
    ]
    documents = [
        "The quick brown fox jumps over the lazy dog.",
        "A fast brown animal jumps over a sleepy canine.",
        "The sky is blue and the sun is bright.",
        "Blue skies and bright sunshine are beautiful.",
        "The dog is sleeping under the tree.",
    ]
    documents_chinese = [
        "敏捷的棕色狐狸跳过懒惰的狗。",
        "一只棕色的快速动物跳过一只昏昏欲睡的小狗。",
        "天空是蓝色的，太阳是明亮的。",
        "蓝天和明媚的阳光是美丽的。",
        "狗正在树下睡觉。",
    ]

    # BM25 Retrieval
    query = "learning BM25 with Python"
    results = Retriever("word", corpus).retrieve(top_k=4, threshold=0.5, query=query)
    print_results("Word Retrieval Results", results)

    # Generate random embeddings
    import numpy as np
    rng = np.random.default_rng(seed=42)
    embeddings = rng.random((len(documents), 512))
    query_embedding = rng.random(512)

    # LLM Retrieval
    results = Retriever("llm", documents).retrieve(top_k=4, threshold=0.5, query=query)
    print_results("LLM Retrieval Results", results)
    
    # Vector Retrieval
    results = Retriever("vector", documents).retrieve(
        top_k=4,
        threshold=0.5,
        query_embedding=query_embedding.tolist(),
        db_type="zilliz",
        collection_name="test_collection"
    )
    print_results("Vector Retrieval Results", results)

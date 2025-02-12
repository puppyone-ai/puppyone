# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import os
import sys
import math
from typing import List, Dict, Optional
from transformers import AutoTokenizer
from Utils.PuppyEngineExceptions import global_exception_handler
from ModularEdges.SearchEdge.search_strategy import BaseRetriever


class KeywordRetrievalStrategy(BaseRetriever):
    """Keyword-based search using BM25."""

    def __init__(
        self,
        query: str,
        extra_configs: dict = None,
        documents: List[str] = None,
        top_k: int = 5,
        threshold: Optional[float] = None,
    ):
        super().__init__(query, extra_configs, documents, top_k, threshold)
        self.tokenizer = AutoTokenizer.from_pretrained(self.extra_configs.get("model_name", "bert-base-multilingual-cased"))
        self.doc_count = len(self.documents)
        self.tokenized_corpus = [self._tokenize(doc) for doc in self.documents]
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
    def search(
        self
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

        if self.query is None:
            raise ValueError("Query cannot be None.")

        tokenized_query = self._tokenize(self.query)
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
        if self.threshold is not None:
            normalized_scores = [doc for doc in normalized_scores if doc["score"] >= self.threshold]

        # Sort and return top-k results
        return sorted(normalized_scores, key=lambda x: x["score"], reverse=True)[:self.top_k]


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    # Keyword Retrieval Example
    query = "What did the fox do?"
    documents = [
        "The quick brown fox jumps over the lazy dog.",
        "A fast brown animal jumps over a sleepy canine.",
        "The sky is blue and the sun is bright.",
        "Blue skies and bright sunshine are beautiful.",
        "The dog is sleeping under the tree."
    ]
    documents = [
        "The quick brown fox jumps over the lazy dog.",
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
        "Hola, cómo estás? Estoy aprendiendo BM25 con Python.",
        "こんにちは、元気ですか？PythonでBM25を学んでいます。",
        "你好，你在做什么？我在用Python学习BM25。"
    ]
    extra_configs = {
        "model_name": "bert-base-multilingual-cased"
    }
    keyword_retrieval = KeywordRetrievalStrategy(query, extra_configs, documents, top_k=2, threshold=0.5)
    print(keyword_retrieval.search())

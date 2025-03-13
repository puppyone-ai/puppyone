# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import os
from typing import List, Dict
from torch import no_grad
from transformers import AutoTokenizer, AutoModelForSequenceClassification
from ModularEdges.RerankEdge.base_reranker import BaseReranker
from Utils.puppy_exception import global_exception_handler


class HuggingFaceReranker(BaseReranker):
    def __init__(
        self,
        model_name: str
    ):
        super().__init__(model_name)
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


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    query = "What is your name?"
    retrieval_chunks=["I am developer", "I am a human", "I am Jack", "Hello", "Working"]

    reranker = HuggingFaceReranker(model_name="BAAI/bge-reranker-base")
    result = reranker.rerank(query=query, retrieval_chunks=retrieval_chunks, top_k=3)
    print("Hugging Face Reranker Results:", result)

# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import os
from typing import List, Dict
import cohere
from ModularEdges.RerankEdge.base_reranker import BaseReranker
from Utils.puppy_exception import global_exception_handler


class CohereReranker(BaseReranker):
    def __init__(
        self,
        model_name: str = None
    ):
        super().__init__(model_name)
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


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    query = "What is your name?"
    retrieval_chunks=["I am developer", "I am a human", "I am Jack", "Hello", "Working"]

    reranker = CohereReranker()
    result = reranker.rerank(query=query, retrieval_chunks=retrieval_chunks, top_k=3)
    print("Cohere Reranker Results:", result)

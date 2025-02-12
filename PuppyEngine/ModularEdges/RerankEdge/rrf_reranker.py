# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import os
from typing import List, Dict
from ModularEdges.RerankEdge.base_reranker import BaseReranker
from Utils.PuppyEngineExceptions import global_exception_handler


class RRFReranker(BaseReranker):
    def __init__(
        self,
        model_name: str = None
    ):
        super().__init__(model_name)

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


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    query = "What is your name?"
    retrieval_chunks=["I am developer", "I am a human", "I am Jack", "Hello", "Working"]

    reranker = RRFReranker()
    result = reranker.rerank(query=query, retrieval_chunks=retrieval_chunks, top_k=3)
    print("RRF Reranker Results:", result)

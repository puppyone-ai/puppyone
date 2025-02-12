# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import os
from ModularEdges.RerankEdge.rrf_reranker import RRFReranker
from ModularEdges.RerankEdge.base_reranker import BaseReranker
from Utils.PuppyEngineExceptions import global_exception_handler
from ModularEdges.RerankEdge.llm_reranker import LLMBasedReranker
from ModularEdges.RerankEdge.cohere_reranker import CohereReranker
from ModularEdges.RerankEdge.hf_reranker import HuggingFaceReranker


class RerankerFactory:
    @staticmethod
    @global_exception_handler(3300, "Error Creating Reranker")
    def execute(
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
    
    reranker = RerankerFactory.execute(reranker_type="llm")
    result = reranker.rerank(query=query, retrieval_chunks=retrieval_chunks, top_k=3)
    print("LLM-Based Reranker Results:", result)

    reranker = RerankerFactory.execute(reranker_type="huggingface", model_name="BAAI/bge-reranker-base")
    result = reranker.rerank(query=query, retrieval_chunks=retrieval_chunks, top_k=3)
    print("Hugging Face Reranker Results:", result)

    reranker = RerankerFactory.execute(reranker_type="cohere")
    result = reranker.rerank(query=query, retrieval_chunks=retrieval_chunks, top_k=3)
    print("Cohere Reranker Results:", result)

    reranker = RerankerFactory.execute(reranker_type="rrf")
    result = reranker.rerank(query=query, retrieval_chunks=retrieval_chunks, top_k=3)
    print("RRF Reranker Results:", result)

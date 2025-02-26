# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import os
from typing import List, Dict, Any
from ModularEdges.EdgeFactoryBase import EdgeFactoryBase
from ModularEdges.RerankEdge.rrf_reranker import RRFReranker
from Utils.PuppyEngineExceptions import global_exception_handler
from ModularEdges.RerankEdge.llm_reranker import LLMBasedReranker
from ModularEdges.RerankEdge.cohere_reranker import CohereReranker
from ModularEdges.RerankEdge.hf_reranker import HuggingFaceReranker


class RerankerFactory(EdgeFactoryBase):
    @staticmethod
    @global_exception_handler(3018, "Error Executing Rerank Edge")
    def execute(
        init_configs: Dict[str, Any] = None,
        extra_configs: Dict[str, Any] = None
    ) -> List[Dict[str, float]]:
        reranker_classes = {
            "llm": LLMBasedReranker,
            "huggingface": HuggingFaceReranker,
            "cohere": CohereReranker,
            "rrf": RRFReranker
        }

        reranker_type = init_configs.get("reranker_type")
        model_name = init_configs.get("model_name", "")
        reranker_class = reranker_classes.get(reranker_type.lower())
        if not reranker_class:
            raise ValueError(f"Unsupported Reranking Type: {reranker_type}!")

        return reranker_class(model_name).rerank(
            query=init_configs.get("query", ""),
            retrieval_chunks=init_configs.get("retrieval_chunks", []),
            top_k=init_configs.get("top_k", 5)
        )


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    query = "What is your name?"
    retrieval_chunks=["I am developer", "I am a human", "I am Jack", "Hello", "Working"]
    
    reranker = RerankerFactory.execute(init_configs={"reranker_type": "llm"})
    result = reranker.rerank(query=query, retrieval_chunks=retrieval_chunks, top_k=3)
    print("LLM-Based Reranker Results:", result)

    reranker = RerankerFactory.execute(init_configs={"reranker_type": "huggingface", "model_name": "BAAI/bge-reranker-base"})
    result = reranker.rerank(query=query, retrieval_chunks=retrieval_chunks, top_k=3)
    print("Hugging Face Reranker Results:", result)

    reranker = RerankerFactory.execute(init_configs={"reranker_type": "cohere"})
    result = reranker.rerank(query=query, retrieval_chunks=retrieval_chunks, top_k=3)
    print("Cohere Reranker Results:", result)

    reranker = RerankerFactory.execute(init_configs={"reranker_type": "rrf"})
    result = reranker.rerank(query=query, retrieval_chunks=retrieval_chunks, top_k=3)
    print("RRF Reranker Results:", result)

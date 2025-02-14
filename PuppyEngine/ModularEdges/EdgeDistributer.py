# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import json
from itertools import product
from typing import List, Dict, Any, Tuple
from DataClass.Chunk import Chunk
from Edges.Chunker import ChunkingFactory 
from Edges.Sandbox.code_v4 import CustomCode
from Edges.Searcher import SearchClientFactory
from Edges.Conditioner import Conditioner
from Utils.PuppyEngineExceptions import global_exception_handler

from abc import ABC, abstractmethod
from PuppyEngine.EdgesNew.LLMEdge import LLM
from PuppyEngine.EdgesNew.ChunkEdge import Chunk
from PuppyEngine.EdgesNew.SearchEdge import SearchPerplexity, SearchGoogle



class EdgeProcessor(ABC):
    type: str
    version: str

    @abstractmethod
    def process(self, edge: Dict[str, Any], input_blocks: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        pass


class EdgeProcessorFactory:

    _processors ={
        "llm": LLM(),
        "search": {
            "perplexity": SearchPerplexity(),
            "google": SearchGoogle(),
            #"embedding": SearchEdgeProcessor(),
            #"llm": SearchEdgeProcessor(),
            #"ddg": SearchEdgeProcessor(),
            #"elastic": SearchEdgeProcessor(),
        },
        "chunk": Chunk(),
        "code": Code(),
        # "ifelse": Conditioner(),
        # "modify": JSONModifier(),
    }

    @classmethod
    def get_processor(cls, edge_type: str) -> EdgeProcessor:
        type_parts = edge_type.split('.')
        
        current_level = cls._processors
        
        for part in type_parts:
            if isinstance(current_level, dict):
                if part in current_level:
                    current_level = current_level[part]
                elif "default" in current_level:
                    return current_level["default"]
                else:
                    raise ValueError(f"Unsupported type path: {edge_type}")
            else:
                return current_level
                
        if not isinstance(current_level, dict):
            return current_level
            
        if "default" in current_level:
            return current_level["default"]
            
        raise ValueError(f"Unsupported type path: {edge_type}")
    

class EdgeDistributor:
    def __init__(
        self,
        edges: Dict[str, Dict[str, Any]],
        input_blocks: Dict[str, Dict[str, Any]]
    ):

        self.edges = edges
        self.input_blocks = input_blocks
        self.edge_id = list(edges.keys())[0]  # Get the first (and only) key
        # Extract edge_id and edge_dict from the input dictionary

        edge_data = edges[self.edge_id]
        self.edge_type = edge_data.get("type", "")
        self.edge_data = edge_data.get("data", {})
    

    @global_exception_handler(3000, "Unexpected Error in Executing Edge")
    def process(self) -> Dict[str, Dict[str, Any]]:
        processor = EdgeProcessorFactory.get_processor(self.edge_type)
        return processor.process(self.edges, self.input_blocks)

    # TODO: Implement Load and Save Edge Execution
    # @global_exception_handler(3002, "Unexpected Error in Load Edge Execution")
    # def load(
    #     self
    # ) -> Any:
    #     block_type = self.data.get("block_type", "")
    #     loader = DataLoader(block_type, self.data)
    #     return loader.load()

    # @global_exception_handler(3003, "Unexpected Error in Save Edge Execution")
    # def save(
    #     self
    # ):
    #     save_name = self.data.get("save_name", "name")
    #     data_to_save = self.data.get("data_to_save", {})
    #     file_type = self.data.get("file_type", "database")
    #     extra_configs = self.data.get("extra_configs", {})

    #     saver = DataSaver()
    #     saver.save_data(data_to_save, save_name, file_type, **extra_configs)


    # @global_exception_handler(3004, "Unexpected Error in Modify Edge Execution")
    # def modify(
    #     self
    # ) -> Any:
    #     content = self.data.get("content", None)
    #     modify_type = self.data.get("modify_type", "")
    #     extra_configs = self.data.get("extra_configs", {})
    #     modifier = JSONModifier(content)
    #     return modifier.modify(modify_type=modify_type, **extra_configs)



    # @global_exception_handler(3008, "Unexpected Error in Search Edge Execution")
    # def search(
    #     self
    # ) -> list:
    #     retrieved_results = SearchClientFactory.create_search_client(
    #         search_type=self.data.get("search_type", ""),
    #         sub_search_type=self.data.get("sub_search_type", ""),
    #         query=self.data.get("query", ""),
    #         extra_configs=self.data.get("extra_configs", {})
    #     )
    #     return retrieved_results
    

    # @global_exception_handler(3006, "Unexpected Error in Chunk Edge Execution")
    # def rechunk(
    #     self
    # ) -> List[str]:
    #     ac = ReChunker()
    #     ac.add_propositions(self.data.get("docs", []))
    #     new_chunks = ac.get_chunks(as_list=self.data.get("as_list", True))
    #     return new_chunks



    # @global_exception_handler(3009, "Unexpected Error in Reranking Edge Execution")
    # def rerank(
    #     self
    # ):
    #     reranker = RerankerFactory.get_reranker(
    #         reranker_type=self.data.get("reranker", ""),
    #         model_name=self.data.get("model", "")
    #     )
    #     result = reranker.rerank(
    #         query=self.data.get("query", ""),
    #         retrieval_chunks=self.data.get("searched_chunks", []),
    #         top_k=self.data.get("top_k", 5)
    #     )
    #     if not self.data.get("show_score", False):
    #         result = [item["text"] for item in result]
    #     return result

    # @global_exception_handler(3010, "Unexpected Error in Query-Rewrite Edge Execution")
    # def query_rewrite(
    #     self
    # ):
    #     rewriter = QueryRewriter(
    #         self.data.get("query", ""),
    #         self.data.get("model", "gpt-4o-2024-08-06")
    #     )
    #     mode = self.data.get("mode", "").lower()
    #     rewrite_methods = {
    #         "multiple": lambda: rewriter.multi_query(self.data.get("num", 3)),
    #         "expansion": rewriter.query_expansion,
    #         "relaxation": rewriter.query_relaxation,
    #         "segmentation": rewriter.query_segmentation,
    #         "scoping": rewriter.query_scoping,
    #         "sub": rewriter.sub_question_query,
    #         "hyde": rewriter.hyde_query_conversion,
    #         "back": rewriter.step_back_prompting,
    #         "rrr": rewriter.rewrite_retrieve_read,
    #         "query2doc": rewriter.query2doc,
    #         "iter": lambda: rewriter.iter_retgen(self.data.get("num", 3))
    #     }
    #     rewrite_method = rewrite_methods.get(mode)
    #     if not rewrite_method:
    #         raise ValueError(f"Unknown query rewrite mode: {mode}")
    #     return rewrite_method()

    @global_exception_handler(3011, "Unexpected Error in Code Edge Execution")
    def code(
        self
    ) -> Any:
        code = self.data.get("code", "")
        arg_values = self.data.get("arg_values", {})
        custom_code = CustomCode()
        result = custom_code.execute_restricted_code(code, arg_values)
        return result

    @global_exception_handler(3012, "Unexpected Error in If-Else Edge Execution")
    def ifelse(
        self
    ) -> Any:
        content_blocks = self.data.get("content_blocks", {})
        cases = self.data.get("cases", [])
        conditioner = Conditioner(content_blocks, cases)
        results = conditioner.evaluate_cases()
        return results


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    
    # LLM Edge TestCase ##################################################
    # Test case for llm edge combining nodes 2 and 3
    test_edge = {
        "llm-1727235281399": {
            "type": "llm",
            "data": {
                "messages": [
                    {"role": "system", "content": "You are a helpful AI assistant that called {{c}}"},
                    {"role": "user", "content": "introduce yourself as a {{b}}{{c}}"}
                ],
                "model": "gpt-4o",
                "max_tokens": 2048,
                "temperature": 0.7,
                "inputs": {"2": "b", "3": "c"},
                "outputs": {"4": "b"},
                "structured_output": True
            }
        }
    }
    input_blocks = {
        "2": {
            "label": "b",
            "type": "structured",
            "data": {
                "content": {"name": "Gangstar"},
                "embedding_view": []
            }
        },
        "3": {
            "label": "c",
            "type": "text",
            "data": {
                "content": "lovable puppy"
            }
        }
    }

    # Chunk Edge TestCase ##################################################
    # Test case for chunk edge
    # test_edge = {
    #     "chunk-1727406844633": {
    #         "type": "chunk",
    #         "data": {
    #             "inputs": {
    #                 "1": "input_text"
    #             },
    #             "outputs": {
    #                 "2": "chunked_output"
    #             },
    #             "chunking_mode": "auto",
    #             "sub_chunking_mode": "",
    #             "extra_configs": {}
    #         }
    #     }
    # }
    # input_blocks = {
    #     "1": {
    #         "label": "input_text",
    #         "type": "text",
    #         "data": {
    #             "content": """In a quaint little town nestled between rolling hills, there lived a talented young musician named Elara. With her golden hair and emerald eyes, she often played her violin by the shimmering lake at sunset, drawing the attention of townsfolk who would pause their busy lives to listen to her enchanting melodies.

    #             One fateful evening, as Elara played a haunting tune that echoed through the trees, she noticed a shimmering light beneath the water's surface. Intrigued, she leaned closer, her bow resting on the strings. To her astonishment, a delicate figure emerged—a water sprite named Lira, with translucent wings and an iridescent gown.

    #             "Your music is beautiful," Lira said, her voice like a gentle breeze. "But it's missing something—a piece that can only be found in the depths of the lake." """
    #         }
    #     }
    # }

    input_blocks =  {
        "2": {
            "type": "structured",
            "label": "b",
            "data": {
                "content": [],
                "embedding_view": []
            }
        },
        "1": {
            "type": "text",
            "label": "a",
            "data": {
                "content": "how to train an anime waifu"
            }
        }
    }

    test_edge = {
        "search-1728381436093": {
            "type": "search.google",
            "data": {
              "search_type": "web",
              "sub_search_type": "google",
              "top_k": 5,
              "inputs": {"1": "a"},
              "outputs": {"2": "b"},
              "query_id": {"1": "a"},
              "extra_configs": {}
            }
          }
    }
    
    # Initialize and process the edge
    edge = EdgeDistributor(test_edge, input_blocks)
    result = edge.process()
    
    # Print the result
    print("Edge Processing Result:", result)
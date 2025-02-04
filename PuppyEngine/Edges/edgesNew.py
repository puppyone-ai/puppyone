# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import json
from itertools import product
from typing import List, Dict, Any, Tuple
from DataClass.Chunk import Chunk
from Blocks.DataSaver import DataSaver
from Blocks.DataLoader import DataLoader
from Edges.Rechunker import ReChunker
from Edges.Modifier import JSONModifier
from Edges.Chunker import ChunkingFactory
from Edges.Reranker import RerankerFactory
from Edges.Sandbox.code_v4 import CustomCode
from Edges.QueryRewriter import QueryRewriter
from Edges.Searcher import SearchClientFactory
from Edges.Conditioner import Conditioner
from Edges.Generator import lite_llm_chat
from Utils.PuppyEngineExceptions import global_exception_handler


class EdgeNew:
    def __init__(
        self,
        workflow: type,
        edge: Dict[str, Dict[str, Any]],
        input_blocks: Dict[str, Dict[str, Any]]
    ):
        # Extract edge_id and edge_dict from the input dictionary
        self.edge_id = list(edge.keys())[0]  # Get the first (and only) key
        self.edge_dict = edge[self.edge_id]  # Get the corresponding edge dictionary
        self.edge_type = self.edge_dict.get("type", "")
        self.edge_data = self.edge_dict.get("data", {})
        self.input_blocks = input_blocks
    @global_exception_handler(3000, "Unexpected Error in Executing Edge")
    def process(
        self
    ) -> Dict[str, Dict[str, Any]]:
        """
        Process the edge, processes it, updates the target block with the result.

        Returns:
            Dict[str, Dict[str, Any]]: A dictionary of block IDs and their updated data.
                
                {"ID1":{   label: str,
                        type: str,
                        "data": {
                            "content": Any,  # The processed content
                            ...  # Other data fields
                        },
                        (NOT REQUIRED) "status": str,  # Optional block status 
                        (NOT REQUIRED) "type": str,    # Optional block type
                        ...  # Other block-level fields
                "ID2":{...},
                ...
                }
        """
        edge_methods = {
            "load": self.load,
            "save": self.save,
            "modify": self.modify,
            "llm": self.llm,
            "chunk": self.chunk,
            "rechunk": self.rechunk,
            "search": self.search,
            "rerank": self.rerank,
            "rewrite": self.query_rewrite,
            "code": self.code,
            "ifelse": self.ifelse
        }
        method = edge_methods.get(self.edge_type)
        
        if not method:
            raise ValueError(f"Unsupported Edge Type: {self.edge_type}!")
        
        return method()


    @global_exception_handler(3002, "Unexpected Error in Load Edge Execution")
    def load(
        self
    ) -> Any:
        block_type = self.data.get("block_type", "")
        loader = DataLoader(block_type, self.data)
        return loader.load()

    @global_exception_handler(3003, "Unexpected Error in Save Edge Execution")
    def save(
        self
    ):
        save_name = self.data.get("save_name", "name")
        data_to_save = self.data.get("data_to_save", {})
        file_type = self.data.get("file_type", "database")
        extra_configs = self.data.get("extra_configs", {})

        saver = DataSaver()
        saver.save_data(data_to_save, save_name, file_type, **extra_configs)

    @global_exception_handler(3004, "Unexpected Error in Modify Edge Execution")
    def modify(
        self,
    ) -> Any:
        content = self.data.get("content", None)
        modify_type = self.data.get("modify_type", "")
        extra_configs = self.data.get("extra_configs", {})
        modifier = JSONModifier(content)
        return modifier.modify(modify_type=modify_type, **extra_configs)

    @global_exception_handler(3005, "Unexpected Error in LLM Edge Execution")
    def llm(
        self
    ) -> Tuple[str, Dict[str, Any]]:
        """
        Process the LLM edge, replace the placeholders with the actual content, handle structured output, and execute the LLM.

        Returns:
            Tuple[str, Dict[str, Any]]: A tuple containing the target block ID and the output dictionary.
        """
        messages = self.edge_data.get("messages", [])
        
        # replace the placeholders with the actual content
        # Create a mapping of labels to content from input blocks
        label_to_content = {}
        for block_id, label in self.edge_data.get("inputs", {}).items():
            if block_id in self.input_blocks:
                block_content = self.input_blocks[block_id].get("data", {}).get("content", "")
                label_to_content[label] = str(block_content) 

        # Process each message and replace placeholders
        processed_messages = []
        for message in messages:
            content = message["content"]
            # Replace all {{label}} patterns with corresponding content
            for label, content_value in label_to_content.items():
                placeholder = f"{{{{{label}}}}}"
                content = content.replace(placeholder, content_value)
            
            processed_messages.append({
                "role": message["role"],
                "content": content
            })
        
        messages = processed_messages

        ## Handle structured output
        is_structured_output = self.edge_data.get("structured_output", False)
        if is_structured_output:
            response_format = {"type": "json_object"}

            # OpenAI's offical requirement, even if it's fucked up
            if is_structured_output:
                response_format = {"type": "json_object"}
                messages.append({"role":"user", "content":"in json format"})
            else:
                response_format = None
        else:
            response_format = None

        ## LLM Execution    
        response = lite_llm_chat(
            history=self.edge_data.get("history", None),
            messages=messages,
            model=self.edge_data.get("model", "gpt-4o-2024-08-06"),
            base_url=self.edge_data.get("base_url", None),
            max_tokens=self.edge_data.get("max_tokens", 4096),
            temperature=self.edge_data.get("temperature", 0.7),
            printing=False,
            stream=False,
            response_format=response_format,
        )

        if is_structured_output == False:
            final_response = response
        elif is_structured_output == True:
            final_response = json.loads(response)

        target_block_dict = {}
        # Get the target block ID from outputs if it exists, otherwise use edge_id
        for key, value in self.edge_data.get("outputs", {}).items():
            target_block_dict[key] = {"data": {"content": final_response}}

        # Return tuple of target block ID and output dictionary
        return target_block_dict

    @global_exception_handler(3006, "Unexpected Error in Chunk Edge Execution")
    def chunk(
        self
    ) -> List[str]:
        chunks = ChunkingFactory.create_chunking(
            chunking_mode=self.data.get("chunking_mode", ""),
            sub_mode=self.data.get("sub_chunking_mode", ""),
            doc=self.data.get("doc"),
            extra_configs=self.data.get("extra_configs", "")
        )

        processed_output = []
        for o in chunks:
            if isinstance(o, Chunk):
                processed_output.append(o.content)
            elif isinstance(o, dict) and "content" in o:
                processed_output.append(o["content"])
            elif isinstance(o, str):
                processed_output.append(o)
            else:
                raise ValueError(f"Invalid chunk type: {type(o)}.")
        return processed_output

    @global_exception_handler(3006, "Unexpected Error in Chunk Edge Execution")
    def rechunk(
        self
    ) -> List[str]:
        ac = ReChunker()
        ac.add_propositions(self.data.get("docs", []))
        new_chunks = ac.get_chunks(as_list=self.data.get("as_list", True))
        return new_chunks

    @global_exception_handler(3008, "Unexpected Error in Search Edge Execution")
    def search(
        self
    ) -> list:
        retrieved_results = SearchClientFactory.create_search_client(
            search_type=self.data.get("search_type", ""),
            sub_search_type=self.data.get("sub_search_type", ""),
            query=self.data.get("query", ""),
            extra_configs=self.data.get("extra_configs", {})
        )
        return retrieved_results

    @global_exception_handler(3009, "Unexpected Error in Reranking Edge Execution")
    def rerank(
        self
    ):
        reranker = RerankerFactory.get_reranker(
            reranker_type=self.data.get("reranker", ""),
            model_name=self.data.get("model", "")
        )
        result = reranker.rerank(
            query=self.data.get("query", ""),
            retrieval_chunks=self.data.get("searched_chunks", []),
            top_k=self.data.get("top_k", 5)
        )
        if not self.data.get("show_score", False):
            result = [item["text"] for item in result]
        return result

    @global_exception_handler(3010, "Unexpected Error in Query-Rewrite Edge Execution")
    def query_rewrite(
        self
    ):
        rewriter = QueryRewriter(
            self.data.get("query", ""),
            self.data.get("model", "gpt-4o-2024-08-06")
        )
        mode = self.data.get("mode", "").lower()
        rewrite_methods = {
            "multiple": lambda: rewriter.multi_query(self.data.get("num", 3)),
            "expansion": rewriter.query_expansion,
            "relaxation": rewriter.query_relaxation,
            "segmentation": rewriter.query_segmentation,
            "scoping": rewriter.query_scoping,
            "sub": rewriter.sub_question_query,
            "hyde": rewriter.hyde_query_conversion,
            "back": rewriter.step_back_prompting,
            "rrr": rewriter.rewrite_retrieve_read,
            "query2doc": rewriter.query2doc,
            "iter": lambda: rewriter.iter_retgen(self.data.get("num", 3))
        }
        rewrite_method = rewrite_methods.get(mode)
        if not rewrite_method:
            raise ValueError(f"Unknown query rewrite mode: {mode}")
        return rewrite_method()

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
    
    # Create test blocks data
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
    
    # Initialize and process the edge
    edge = EdgeNew(None, test_edge, input_blocks)
    result = edge.process()
    
    # Print the result
    print("Edge Processing Result:", result)
# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import re
import json
from typing import List, Dict, Any
from DataClass.Chunk import Chunk
from Blocks.DataSaver import DataSaver
from Blocks.DataLoader import DataLoader
from Blocks.VectorDatabase import VectorDatabaseFactory
from Edges.Rechunker import ReChunker
from Edges.Modifier import JSONModifier
from Edges.Embedder import TextEmbedding
from Edges.Chunker import ChunkingFactory
from Edges.Reranker import RerankerFactory
from Edges.Sandbox.code_v4 import CustomCode
from Edges.QueryRewriter import QueryRewriter
from Edges.Searcher import SearchClientFactory
from Edges.Generator import lite_llm_chat
from Utils.PuppyEngineExceptions import global_exception_handler


class Edge:
    def __init__(
        self,
        edge_type: str,
        data: Dict[str, Any],
    ):
        self.edge_type = edge_type
        self.data = data

    @global_exception_handler(3000, "Unexpected Error in Executing Edge")
    def process(
        self
    ) -> Any:
        edge_methods = {
            "load": self.load,
            "save": self.save,
            "modify": self.modify,
            "llm": self.llm,
            "chunk": self.chunk,
            "rechunk": self.rechunk,
            "embedding": self.embedding,
            "search": self.search,
            "rerank": self.rerank,
            "rewrite": self.query_rewrite,
            "code": self.code,
            "choose": self.choose
        }
        method = edge_methods.get(self.edge_type)
        if not method:
            raise ValueError(f"Unsupported Edge Type: {self.edge_type}!")
        
        # loop logics
        if self.data.get("looped", False):
            return self.handle_loop_mode(method)
        else:   
            return method()

    @global_exception_handler(3001, "Unexpected Error in Handling Loop")
    def handle_loop_mode(
        self,
        method: Any
    ):
        results = []
        method_data = self.data

        # Handle 'chunk' edge type
        if self.edge_type == "chunk":
            docs = method_data.get("doc", [])
            for doc in docs:
                self.data["doc"] = doc
                results.append(method())

        # Handle 'llm', 'code', and 'modify' edge types
        elif self.edge_type in {"llm", "code", "modify"}:
            plugins = method_data.get("plugins", {})
            contents = method_data.get("content", [])

            # If plugins are available
            if plugins:
                for i in range(len(next(iter(plugins.values()), []))):
                    # Update plugin data for the current iteration
                    self.data["plugins"] = {k: v[i] for k, v in plugins.items()}
                    results.append(method())

            # If contents are available
            elif contents:
                for content in contents:
                    self.data["content"] = content
                    results.append(method())

        return results

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
    ) -> str:
        """
            data: 
            {'messages': [{"role": "system", "content": "You are a helpful AI assistant that called {{3}}}"},
                        {"role": "user", "content": "What is the capital of the moon?"},
                        {"role": "user", "content": "What is the capital of the earth?"}],
            'model': 'gpt-4o', 
            'base_url': '', 
            'max_tokens': 4096, 
            'temperature': 0.7, 
            'inputs': ["1", "3"],
            'plugins': [{"1": "input one"},
                        {"2": "input two"}]
            }
        """

        raw_messages = self.data.get("messages", [])

        # Replace placeholders with actual content from inputs
        pattern = re.compile(r'\{\{(.*?)\}\}')
        plugins = self.data.get("plugins", {})
        messages = [
            {
                "role": message.get("role", ""),
                "content": pattern.sub(
                    lambda match: plugins.get(match.group(1), json.dumps(plugins.get(match.group(1), ""))) 
                    if isinstance(plugins.get(match.group(1), ""), str) 
                    else json.dumps(plugins.get(match.group(1), "")),
                    message.get("content", "")
                )
            }
            for message in raw_messages
        ]

        # Handle structured output
        structured_output = self.data.get("structured_output", False)
        if structured_output:
            response_format = {"type": "json_object"}
            messages.append({"role":"user", "content":"in json format"})
        else:
            response_format = None

        response = lite_llm_chat(
            history=self.data.get("history", None),
            messages=messages,
            model=self.data.get("model", "gpt-4o-2024-08-06"),
            base_url=self.data.get("base_url", None),
            max_tokens=self.data.get("max_tokens", 4096),
            temperature=self.data.get("temperature", 0.7),
            printing=False,
            stream=False,
            response_format=response_format,
        )
        return response if not structured_output else json.loads(response)

    @global_exception_handler(3006, "Unexpected Error in Chunk Edge Execution")
    def chunk(
        self
    ) -> List[str]:
        chunks = ChunkingFactory.create_chunking(
            chunking_mode=self.data.get("chunking_mode", ""),
            sub_mode=self.data.get("sub_chunking_mode", ""),
            doc=self.data.get("doc", ""),
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

    @global_exception_handler(3007, "Unexpected Error in Embedding Edge Execution")
    def embedding(
        self
    ) -> str:
        embedder = TextEmbedding(
            model_name=self.data.get("model", "text-embedding-ada-002")
        )
        chunks = self.data.get("chunks", [])
        chunks_contents = [
            chunk.content if isinstance(chunk, Chunk) else
            chunk["content"] if isinstance(chunk, dict) else
            chunk if isinstance(chunk, str) else
            ValueError("Invalid chunk type.")
            for chunk in chunks
        ]

        embeddings = embedder.get_embeddings(chunks_contents)

        # Store the embeddings
        vdb_configs = self.data.get("vdb_configs", {})
        db = VectorDatabaseFactory.get_database(
            db_type=vdb_configs.get("vdb_type", "pinecone")
        )
        db.connect(vdb_configs.get("collection_name", ""))
        db.save_embeddings(
            collection_name=vdb_configs.get("collection_name", ""),
            embeddings=embeddings,
            documents=chunks_contents,
            ids=vdb_configs.get("ids", []),
            create_new=vdb_configs.get("create_new", False),
        )
    
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
        arg_values = self.data.get("plugins", {})
        custom_code = CustomCode()
        result = custom_code.execute_restricted_code(code, arg_values)
        return result
    
    @global_exception_handler(3012, "Unexpected Error in Choose Edge Execution")
    def choose(
        self
    ) -> Any:
        switch_value = self.data.get("switch", "ON")
        return list(self.data.get(switch_value).keys())


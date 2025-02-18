# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import os
import threading
import concurrent.futures
from datetime import datetime
from dataclasses import dataclass
from typing import Dict, Any, Tuple
from concurrent.futures import ThreadPoolExecutor
from ModularEdges.LLMEdge import LLMFactory
from ModularEdges.CodeEdge import CoderFactory
from ModularEdges.SaveEdge import SaverFactory
from ModularEdges.LoadEdge import LoaderFactory
from ModularEdges.ChunkEdge import ChunkerFactory
from ModularEdges.SearchEdge import SearcherFactory
from ModularEdges.ModifyEdge import ModifierFactory
from ModularEdges.RerankEdge import RerankerFactory
from ModularEdges.ConditionEdge import ConditionerFactory
from ModularEdges.QueryRewriteEdge import QueryRewriterFactory
from ModularEdges.EdgeConfigParser import ConfigParserFactory
from Utils.PuppyEngineExceptions import global_exception_handler, PuppyEngineException


@dataclass
class EdgeTask:
    """Represents a single edge execution task"""
    edge_type: str
    start_time: datetime
    end_time: datetime
    status: str = "pending"
    result: Any = None
    error: Exception = None


class EdgeExecutor:
    """Handles edge execution and management"""

    def __init__(
        self,
        edge_type: str,
        edge_configs: Dict[str, Any],
        block_configs: Dict[str, Any],
        max_workers: int = None
    ):
        self.edge_type = edge_type
        self.edge_configs = edge_configs
        self.block_configs = block_configs
        self.max_workers = max_workers or min(32, (os.cpu_count() or 1) * 4)
        self.executor = ThreadPoolExecutor(max_workers=self.max_workers)
        self.lock = threading.Lock()
        self._tasks: Dict[str, EdgeTask] = {}
        self._completed_edges: Dict[str, Any] = {}
        self.edge_factories = {
            "llm": LLMFactory,
            "code": CoderFactory,
            "save": SaverFactory,
            "load": LoaderFactory,
            "chunk": ChunkerFactory,
            "search": SearcherFactory,
            "modify": ModifierFactory,
            "rerank": RerankerFactory,
            "condition": ConditionerFactory,
            "query_rewrite": QueryRewriterFactory
        }

    @global_exception_handler(3000, "Unexpected Error in Edge Execution")
    def execute(
        self,
    ) -> EdgeTask:
        """Execute an edge operation with potential loop handling"""

        try:
            parser = ConfigParserFactory.get_parser(
                self.edge_type,
                self.edge_configs,
                self.block_configs
            )
            parsed_params = parser.parse()
            init_configs = parsed_params.init_configs
            extra_configs = parsed_params.extra_configs
            is_loop = parsed_params.is_loop
            start_time = datetime.now()

            if not is_loop:
                # Single execution
                return self._execute_single(init_configs[0], extra_configs[0])

            # Loop execution
            futures = []
            for i, init_param in enumerate(init_configs):
                futures.append(
                    self.executor.submit(self._execute_single, init_param, extra_configs[i])
                )

            # Wait for all loop iterations
            results = []
            errors = []
            for future in concurrent.futures.as_completed(futures):
                try:
                    results.append(future.result())
                except Exception as e:
                    errors.append(str(e))

            if errors:
                raise ValueError("\n".join(errors))

            # Combine loop results
            combined_task = EdgeTask(
                edge_type=self.edge_type,
                start_time=start_time,
                end_time=datetime.now(),
                status="completed",
                result=[task.result for task in results]
            )
            return combined_task
            
        except Exception as e:
            return EdgeTask(
                edge_type=self.edge_type,
                start_time=start_time,
                end_time=datetime.now(),
                status="failed",
                error=e
            )

    def _execute_single(
        self,
        init_configs: Dict[str, Any],
        extra_configs: Dict[str, Any]
    ) -> Tuple[Any, str, Exception]:
        """Execute a single edge operation"""
        status = "processing"
        error = None
        result = None

        try:
            edge_factory = self.edge_factories.get(self.edge_type)
            if not edge_factory:
                raise PuppyEngineException(3001, "Invalid Edge Type", 
                                         f"Edge type {self.edge_type} not supported")

            result = edge_factory.execute(init_configs, extra_configs)
            status = "completed"
        except Exception as e:
            status = "failed"
            error = e
            raise

        return result, status, error


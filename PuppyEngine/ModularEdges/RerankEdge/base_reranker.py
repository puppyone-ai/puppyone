# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import os
from typing import List, Dict
from abc import ABC, abstractmethod


class BaseReranker(ABC):
    def __init__(
        self,
        model_name: str = None
    ):
        self.model_name = model_name

    @abstractmethod
    def rerank(
        self,
        query: str,
        retrieval_chunks: List[str],
        top_k: int = 5
    ) -> List[Dict[str, float]]:
        pass

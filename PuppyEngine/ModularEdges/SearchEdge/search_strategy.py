# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import os
import sys
from abc import ABC, abstractmethod
from typing import List, Any, Tuple, Optional


class SearchStrategy(ABC):
    """Abstract base class for search strategies."""

    def __init__(
        self,
        query: str,
        extra_configs: dict = None,
    ):
        self.query = query
        self.extra_configs = extra_configs

    @abstractmethod
    def search(
        self,
        **kwargs
    ) -> List[Any]:
        pass


class BaseRetriever(SearchStrategy):
    """Abstract base class for retrievers, containing shared logic."""

    def __init__(
        self,
        query: str,
        extra_configs: dict = None,
        documents: List[str] = None,
        top_k: int = 10,
        threshold: Optional[float] = None
    ):
        super().__init__(query, extra_configs)
        self.documents = documents
        self.top_k = top_k
        self.threshold = threshold

    @abstractmethod
    def search(
        self
    ) -> List[Tuple[str, float]]:
        pass


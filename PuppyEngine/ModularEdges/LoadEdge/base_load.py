# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from abc import ABC, abstractmethod
from typing import Any, Dict
from Utils.PuppyEngineExceptions import PuppyEngineException


class LoadStrategy(ABC):
    """Base strategy class for loading data"""
    
    def __init__(
        self,
        content: Any,
        extra_configs: Dict = None
    ):
        self.content = content
        self.extra_configs = extra_configs or {}

    def validate_content(
        self
    ):
        """Validate that content is not empty"""
        if not self.content:
            raise PuppyEngineException(1100, f"Empty {self.__class__.__name__} Content")

    @abstractmethod
    def load(self) -> Any:
        """Load data using the strategy"""
        pass

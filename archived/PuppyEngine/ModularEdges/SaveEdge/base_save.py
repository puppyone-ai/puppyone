# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from typing import Any
from abc import ABC, abstractmethod


class SaveStrategy(ABC):
    """Base strategy class for saving data"""
    
    @abstractmethod
    def save(
        self,
        data: Any,
        filename: str,
        **kwargs
    ) -> str:
        """Abstract method to save data"""
        pass 

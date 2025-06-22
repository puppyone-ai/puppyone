# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from typing import Dict, Any
from abc import ABC, abstractmethod


class EdgeFactoryBase(ABC):
    @abstractmethod
    def execute(
        self,
        init_configs: Dict[str, Any] = None,
        extra_configs: Dict[str, Any] = None
    ) -> Any:
        pass


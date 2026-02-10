# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from abc import ABC, abstractmethod
from typing import Any, Dict


class ModifyStrategy(ABC):
    def __init__(
        self,
        content: Any,
        extra_configs: Dict[str, Any]
    ):
        self.content = content
        self.extra_configs = extra_configs

    @abstractmethod
    def modify(self) -> Any:
        pass

import os
import pkgutil
import inspect
import importlib
from dataclasses import dataclass
from abc import ABC, abstractmethod
from typing import Any, List, Dict, Type, Optional, Union


@dataclass
class EdgeConfig:
    """Base configuration class for edges"""
    edge_type: str
    data: Dict[str, Any]

    def get(
        self,
        key: str,
        default: Any = None
    ) -> Any:
        """Safely get a value from the data dictionary"""
        return self.data.get(key, default)


class EdgeInfo(ABC):
    """Base class for all edge types"""

    @classmethod
    @abstractmethod
    def edge_type(
        cls
    ) -> str:
        """Unique identifier for the edge type"""
        pass

    @classmethod
    def version(
        cls
    ) -> str:
        """edge version"""
        return "1.0.0"

    @classmethod
    def description(
        cls
    ) -> str:
        """edge description"""
        return "Base edge type"

    @abstractmethod
    def process(
        self,
        config: EdgeConfig
    ) -> Any:
        """Process the edge operation"""
        pass

    def validate_config(
        self,
        config: EdgeConfig
    ) -> bool:
        """Validate the configuration"""
        return True


class EdgeInfoRegistry:
    """Registry for edge"""

    _edges: Dict[str, Type[EdgeInfo]] = {}
    _edge_instances: Dict[str, EdgeInfo] = {}

    @classmethod
    def register(
        cls,
        edge_class: Type[EdgeInfo]
    ) -> None:
        """Register a new edge type"""
        if not edge_class.edge_type:
            raise ValueError(f"Edge type {edge_class.__name__} must define edge_type")

        # Check for version conflicts
        existing_edge = cls._edges.get(edge_class.edge_type)
        if existing_edge and existing_edge.version > edge_class.version:
            return

        cls._edges[edge_class.edge_type] = edge_class

    @classmethod
    def get_edge(
        cls,
        edge_type: str
    ) -> EdgeInfo:
        """Get or create a edge instance by edge type"""
        if edge_type not in cls._edge_instances:
            if edge_type not in cls._edges:
                raise ValueError(f"Unknown edge type: {edge_type}")
            cls._edge_instances[edge_type] = cls._edges[edge_type]()
        return cls._edge_instances[edge_type]

    @classmethod
    def auto_discover_edges(
        cls
    ) -> None:
        """Automatically discover and register all edge types"""
        # Get the current directory
        current_dir = os.path.dirname(os.path.abspath(__file__))
        edges_dir = os.path.join(current_dir, "edges")

        # Ensure edges directory exists
        if not os.path.exists(edges_dir):
            os.makedirs(edges_dir)
  
        # Import all modules from the edges directory
        for _, name, _ in pkgutil.iter_modules([edges_dir]):
            try:
                module = importlib.import_module(f"PuppyEngine.Edges.EdgeTypes.{name}")
                for _, obj in inspect.getmembers(module):
                    if (inspect.isclass(obj) and 
                        issubclass(obj, EdgeInfo) and 
                        obj != EdgeInfo):
                        cls.register(obj)
            except Exception as e:
                print(f"Error loading edge {name}: {str(e)}")

    @classmethod
    def list_edges(
        cls
    ) -> List[Dict[str, str]]:
        """List all registered edges with their versions and descriptions"""
        return [
            {
                "type": edge.edge_type,
                "version": edge.version,
                "description": edge.description
            }
            for edge in cls._edges.values()
        ]

    @classmethod
    def get_edge_info(
        cls,
        edge_type: str
    ) -> Optional[Dict[str, str]]:
        """Get information about a specific edge"""
        edge_class = cls._edges.get(edge_type)
        if edge_class:
            return {
                "type": edge_class.edge_type,
                "version": edge_class.version,
                "description": edge_class.description
            }
        return None

    @classmethod
    def clear_registry(
        cls
    ) -> None:
        """Clear all registered edges"""
        cls._edges.clear()
        cls._edge_instances.clear()


class EdgeManager:
    """Manager class for handling edge type operations"""

    def __init__(
        self
    ):
        self.registry = EdgeInfoRegistry()

    def initialize(
        self
    ):
        """Initialize the edge system"""
        self.registry.auto_discover_edges()

    def process_edge(
        self,
        edge_type: str,
        data: Dict[str, Any]
    ) -> Any:
        """Process an edge operation"""
        config = EdgeConfig(edge_type=edge_type, data=data)
        edge = self.registry.get_edge(edge_type)

        # Validate configuration
        if not edge.validate_config(config):
            raise ValueError(f"Invalid configuration for edge type: {edge_type}")

        # Process and return the result
        return edge.process(config)

    def get_edge_info(
        self,
        edge_type: str = None
    ) -> Union[List[Dict[str, str]], Dict[str, str]]:
        """Get information about edges"""
        if edge_type:
            return self.registry.get_edge_info(edge_type)
        return self.registry.list_edges()

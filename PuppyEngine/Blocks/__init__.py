"""
Blocks Package

This package contains all block implementations for PuppyEngine.
"""

# New block architecture - only import what we need for the refactored system
from .BaseBlock import BaseBlock
from .GenericBlock import GenericBlock
from .BlockFactory import BlockFactory

__all__ = [
    'BaseBlock',
    'GenericBlock',
    'BlockFactory'
]

# Legacy blocks can be imported directly if needed:
# from Blocks.Database import DatabaseClient, DatabaseFactory
# from Blocks.DataLoader import DataLoader
# from Blocks.DataSaver import DataSaver 
# etc.
Blocks Package

This package contains all block implementations for PuppyEngine.
"""

# New block architecture - only import what we need for the refactored system
from .BaseBlock import BaseBlock
from .GenericBlock import GenericBlock
from .BlockFactory import BlockFactory

__all__ = [
    'BaseBlock',
    'GenericBlock',
    'BlockFactory'
]

# Legacy blocks can be imported directly if needed:
# from Blocks.Database import DatabaseClient, DatabaseFactory
# from Blocks.DataLoader import DataLoader
# from Blocks.DataSaver import DataSaver 
# etc.
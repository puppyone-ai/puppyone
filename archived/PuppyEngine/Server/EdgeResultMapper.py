"""
Edge Result Mapper

This module handles the mapping of edge execution results to output blocks,
encapsulating the logic for different edge types and their result structures.
"""

from typing import Dict, Any, Set
from Utils.logger import log_info


class EdgeResultMapper:
    """
    Maps edge execution results to output blocks
    
    This class encapsulates the logic for handling different edge types
    and their varying result structures, reducing coupling in the main
    execution flow.
    """
    
    def __init__(self, edges: Dict[str, Any], edge_to_outputs_mapping: Dict[str, Set[str]]):
        """
        Initialize the mapper with edge definitions and output mappings
        
        Args:
            edges: Dictionary of edge definitions
            edge_to_outputs_mapping: Mapping from edge IDs to output block IDs
        """
        self.edges = edges
        self.edge_to_outputs_mapping = edge_to_outputs_mapping
    
    def map_edge_result_to_blocks(self, edge_id: str, edge_result: Any) -> Dict[str, Any]:
        """
        Map edge execution result to output blocks
        
        Args:
            edge_id: ID of the executed edge
            edge_result: Result returned by edge execution
            
        Returns:
            Dict mapping block IDs to their content
        """
        results = {}
        
        # Get output block IDs for this edge
        output_block_ids = self.edge_to_outputs_mapping.get(edge_id, set())
        
        # Get edge type
        edge_type = self.edges.get(edge_id, {}).get("type")
        
        # Handle different edge types
        if edge_type == "ifelse" and isinstance(edge_result, dict):
            # For ifelse edges, result is already a dict of block_id -> content
            results = self._handle_ifelse_result(edge_result, output_block_ids)
        else:
            # For other edges, assign result to all output blocks
            results = self._handle_standard_result(edge_result, output_block_ids)
        
        # Log result mapping
        for block_id in results:
            log_info(f"Block {block_id} updated with result type: {type(edge_result)}")
        
        return results
    
    def _handle_ifelse_result(self, edge_result: Dict[str, Any], output_block_ids: Set[str]) -> Dict[str, Any]:
        """
        Handle ifelse edge results
        
        Args:
            edge_result: Dictionary result from ifelse edge
            output_block_ids: Set of expected output block IDs
            
        Returns:
            Dict mapping block IDs to their content
        """
        results = {}
        for block_id, content in edge_result.items():
            if block_id in output_block_ids:
                results[block_id] = content
        return results
    
    def _handle_standard_result(self, edge_result: Any, output_block_ids: Set[str]) -> Dict[str, Any]:
        """
        Handle standard edge results (assign to all output blocks)
        
        Args:
            edge_result: Result from edge execution
            output_block_ids: Set of expected output block IDs
            
        Returns:
            Dict mapping block IDs to their content
        """
        results = {}
        for block_id in output_block_ids:
            results[block_id] = edge_result
        return results
    
    def get_edge_type(self, edge_id: str) -> str:
        """
        Get the type of an edge
        
        Args:
            edge_id: ID of the edge
            
        Returns:
            Edge type string
        """
        return self.edges.get(edge_id, {}).get("type", "unknown")

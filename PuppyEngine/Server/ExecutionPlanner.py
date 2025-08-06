"""
Execution Planner

This module contains pure graph computation logic extracted from WorkFlow.
It manages the DAG state and determines executable batches without any I/O operations.
"""

from typing import Dict, Set, List, Any, Tuple
from Utils.logger import log_info, log_debug, log_warning
from Blocks.BaseBlock import BaseBlock


class ExecutionPlanner:
    """
    Pure graph computation engine for workflow execution
    
    This class manages:
    - DAG structure and dependencies
    - Block and edge states
    - Parallel batch determination
    - Execution order planning
    
    It does NOT handle:
    - Actual edge execution
    - I/O operations
    - Storage interactions
    """
    
    def __init__(self, blocks: Dict[str, BaseBlock], edges: Dict[str, Any]):
        """
        Initialize the execution planner
        
        Args:
            blocks: Dictionary of block_id -> BaseBlock instances
            edges: Dictionary of edge configurations
        """
        self.blocks = blocks
        self.edges = edges
        
        # Build dependency mappings
        self.edge_to_inputs_mapping = {}
        self.edge_to_outputs_mapping = {}
        self._build_dependency_mappings()
        
        # Initialize states
        self.block_states = {bid: "pending" for bid in blocks}
        self.edge_states = {eid: "pending" for eid in edges}
        
        # Mark initial blocks as processed
        self._mark_initial_blocks()
        
        log_info(f"ExecutionPlanner initialized with {len(blocks)} blocks and {len(edges)} edges")
    
    def _build_dependency_mappings(self):
        """Build input/output mappings for edges"""
        for edge_id, edge_info in self.edges.items():
            edge_data = edge_info.get("data", {})
            
            # Extract input blocks
            inputs = edge_data.get("inputs", {})
            self.edge_to_inputs_mapping[edge_id] = set(inputs.keys())
            
            # Extract output blocks
            outputs = edge_data.get("outputs", {})
            self.edge_to_outputs_mapping[edge_id] = set(outputs.keys())
            
            log_debug(f"Edge {edge_id}: inputs={inputs.keys()}, outputs={outputs.keys()}")
    
    def _mark_initial_blocks(self):
        """Mark blocks with initial content as processed"""
        for block_id, block in self.blocks.items():
            if block.get_content() is not None:
                self.block_states[block_id] = "processed"
                log_debug(f"Marked block {block_id} as initially processed")
    
    def get_all_prefetch_candidates(self) -> List[str]:
        """
        Get all blocks that have external data and need prefetching
        
        Returns:
            List of block IDs that should be prefetched
        """
        candidates = []
        for block_id, block in self.blocks.items():
            if block.has_external_data() and not block.is_resolved:
                candidates.append(block_id)
        
        log_info(f"Found {len(candidates)} blocks for prefetching")
        return candidates
    
    def get_next_executable_batch(self) -> Set[str]:
        """
        Find the next batch of edges that can be executed in parallel
        
        Returns:
            Set of edge IDs that can be executed
        """
        processed_blocks = set(
            bid for bid, state in self.block_states.items() 
            if state == "processed"
        )
        
        # Find all edges whose input blocks are all processed
        ready_edges = {
            eid for eid, state in self.edge_states.items()
            if state == "pending"
            and all(bid in processed_blocks 
                   for bid in self.edge_to_inputs_mapping.get(eid, set()))
        }
        
        if ready_edges:
            log_info(f"Found {len(ready_edges)} edges ready for execution: {ready_edges}")
        else:
            log_debug("No edges ready for execution")
        
        return ready_edges
    
    def get_inputs_for_batch(self, edge_batch: Set[str]) -> Set[str]:
        """
        Get all input block IDs required for a batch of edges
        
        Args:
            edge_batch: Set of edge IDs
            
        Returns:
            Set of input block IDs
        """
        input_blocks = set()
        for edge_id in edge_batch:
            input_blocks.update(self.edge_to_inputs_mapping.get(edge_id, set()))
        
        return input_blocks
    
    def get_outputs_for_batch(self, edge_batch: Set[str]) -> Set[str]:
        """
        Get all output block IDs that will be produced by a batch of edges
        
        Args:
            edge_batch: Set of edge IDs
            
        Returns:
            Set of output block IDs
        """
        output_blocks = set()
        for edge_id in edge_batch:
            output_blocks.update(self.edge_to_outputs_mapping.get(edge_id, set()))
        
        return output_blocks
    
    def mark_edges_processing(self, edge_ids: Set[str]):
        """Mark edges as processing"""
        for edge_id in edge_ids:
            if edge_id in self.edge_states:
                self.edge_states[edge_id] = "processing"
    
    def mark_edges_completed(self, edge_ids: Set[str]):
        """Mark edges as completed"""
        for edge_id in edge_ids:
            if edge_id in self.edge_states:
                self.edge_states[edge_id] = "completed"
    
    def mark_blocks_processed(self, block_ids: Set[str]):
        """Mark blocks as processed"""
        for block_id in block_ids:
            if block_id in self.block_states:
                self.block_states[block_id] = "processed"
    
    def is_complete(self) -> bool:
        """
        Check if all edges have been completed
        
        Returns:
            True if all edges are completed
        """
        return all(state == "completed" for state in self.edge_states.values())
    
    def get_progress(self) -> Dict[str, Any]:
        """
        Get execution progress statistics
        
        Returns:
            Dictionary with progress information
        """
        total_edges = len(self.edge_states)
        completed_edges = sum(1 for state in self.edge_states.values() if state == "completed")
        processing_edges = sum(1 for state in self.edge_states.values() if state == "processing")
        pending_edges = sum(1 for state in self.edge_states.values() if state == "pending")
        
        total_blocks = len(self.block_states)
        processed_blocks = sum(1 for state in self.block_states.values() if state == "processed")
        
        return {
            "edges": {
                "total": total_edges,
                "completed": completed_edges,
                "processing": processing_edges,
                "pending": pending_edges
            },
            "blocks": {
                "total": total_blocks,
                "processed": processed_blocks,
                "pending": total_blocks - processed_blocks
            },
            "completion_percentage": (completed_edges / total_edges * 100) if total_edges > 0 else 0
        }
    
    def validate_dag(self) -> Tuple[bool, List[str]]:
        """
        Validate that the workflow forms a valid DAG
        
        Returns:
            Tuple of (is_valid, list_of_errors)
        """
        errors = []
        
        # Check for missing input blocks
        for edge_id, input_blocks in self.edge_to_inputs_mapping.items():
            for block_id in input_blocks:
                if block_id not in self.blocks:
                    errors.append(f"Edge {edge_id} references missing input block {block_id}")
        
        # Check for missing output blocks
        for edge_id, output_blocks in self.edge_to_outputs_mapping.items():
            for block_id in output_blocks:
                if block_id not in self.blocks:
                    errors.append(f"Edge {edge_id} references missing output block {block_id}")
        
        # Check for cycles (simplified - could be enhanced)
        # For now, just ensure no block is both input and output of the same edge
        for edge_id in self.edges:
            inputs = self.edge_to_inputs_mapping.get(edge_id, set())
            outputs = self.edge_to_outputs_mapping.get(edge_id, set())
            overlap = inputs.intersection(outputs)
            if overlap:
                errors.append(f"Edge {edge_id} has blocks that are both input and output: {overlap}")
        
        is_valid = len(errors) == 0
        if not is_valid:
            log_warning(f"DAG validation failed with {len(errors)} errors")
        
        return is_valid, errors
Execution Planner

This module contains pure graph computation logic extracted from WorkFlow.
It manages the DAG state and determines executable batches without any I/O operations.
"""

from typing import Dict, Set, List, Any, Tuple
from Utils.logger import log_info, log_debug, log_warning
from Blocks.BaseBlock import BaseBlock


class ExecutionPlanner:
    """
    Pure graph computation engine for workflow execution
    
    This class manages:
    - DAG structure and dependencies
    - Block and edge states
    - Parallel batch determination
    - Execution order planning
    
    It does NOT handle:
    - Actual edge execution
    - I/O operations
    - Storage interactions
    """
    
    def __init__(self, blocks: Dict[str, BaseBlock], edges: Dict[str, Any]):
        """
        Initialize the execution planner
        
        Args:
            blocks: Dictionary of block_id -> BaseBlock instances
            edges: Dictionary of edge configurations
        """
        self.blocks = blocks
        self.edges = edges
        
        # Build dependency mappings
        self.edge_to_inputs_mapping = {}
        self.edge_to_outputs_mapping = {}
        self._build_dependency_mappings()
        
        # Initialize states
        self.block_states = {bid: "pending" for bid in blocks}
        self.edge_states = {eid: "pending" for eid in edges}
        
        # Mark initial blocks as processed
        self._mark_initial_blocks()
        
        log_info(f"ExecutionPlanner initialized with {len(blocks)} blocks and {len(edges)} edges")
    
    def _build_dependency_mappings(self):
        """Build input/output mappings for edges"""
        for edge_id, edge_info in self.edges.items():
            edge_data = edge_info.get("data", {})
            
            # Extract input blocks
            inputs = edge_data.get("inputs", {})
            self.edge_to_inputs_mapping[edge_id] = set(inputs.keys())
            
            # Extract output blocks
            outputs = edge_data.get("outputs", {})
            self.edge_to_outputs_mapping[edge_id] = set(outputs.keys())
            
            log_debug(f"Edge {edge_id}: inputs={inputs.keys()}, outputs={outputs.keys()}")
    
    def _mark_initial_blocks(self):
        """Mark blocks with initial content as processed"""
        for block_id, block in self.blocks.items():
            if block.get_content() is not None:
                self.block_states[block_id] = "processed"
                log_debug(f"Marked block {block_id} as initially processed")
    
    def get_all_prefetch_candidates(self) -> List[str]:
        """
        Get all blocks that have external data and need prefetching
        
        Returns:
            List of block IDs that should be prefetched
        """
        candidates = []
        for block_id, block in self.blocks.items():
            if block.has_external_data() and not block.is_resolved:
                candidates.append(block_id)
        
        log_info(f"Found {len(candidates)} blocks for prefetching")
        return candidates
    
    def get_next_executable_batch(self) -> Set[str]:
        """
        Find the next batch of edges that can be executed in parallel
        
        Returns:
            Set of edge IDs that can be executed
        """
        processed_blocks = set(
            bid for bid, state in self.block_states.items() 
            if state == "processed"
        )
        
        # Find all edges whose input blocks are all processed
        ready_edges = {
            eid for eid, state in self.edge_states.items()
            if state == "pending"
            and all(bid in processed_blocks 
                   for bid in self.edge_to_inputs_mapping.get(eid, set()))
        }
        
        if ready_edges:
            log_info(f"Found {len(ready_edges)} edges ready for execution: {ready_edges}")
        else:
            log_debug("No edges ready for execution")
        
        return ready_edges
    
    def get_inputs_for_batch(self, edge_batch: Set[str]) -> Set[str]:
        """
        Get all input block IDs required for a batch of edges
        
        Args:
            edge_batch: Set of edge IDs
            
        Returns:
            Set of input block IDs
        """
        input_blocks = set()
        for edge_id in edge_batch:
            input_blocks.update(self.edge_to_inputs_mapping.get(edge_id, set()))
        
        return input_blocks
    
    def get_outputs_for_batch(self, edge_batch: Set[str]) -> Set[str]:
        """
        Get all output block IDs that will be produced by a batch of edges
        
        Args:
            edge_batch: Set of edge IDs
            
        Returns:
            Set of output block IDs
        """
        output_blocks = set()
        for edge_id in edge_batch:
            output_blocks.update(self.edge_to_outputs_mapping.get(edge_id, set()))
        
        return output_blocks
    
    def mark_edges_processing(self, edge_ids: Set[str]):
        """Mark edges as processing"""
        for edge_id in edge_ids:
            if edge_id in self.edge_states:
                self.edge_states[edge_id] = "processing"
    
    def mark_edges_completed(self, edge_ids: Set[str]):
        """Mark edges as completed"""
        for edge_id in edge_ids:
            if edge_id in self.edge_states:
                self.edge_states[edge_id] = "completed"
    
    def mark_blocks_processed(self, block_ids: Set[str]):
        """Mark blocks as processed"""
        for block_id in block_ids:
            if block_id in self.block_states:
                self.block_states[block_id] = "processed"
    
    def is_complete(self) -> bool:
        """
        Check if all edges have been completed
        
        Returns:
            True if all edges are completed
        """
        return all(state == "completed" for state in self.edge_states.values())
    
    def get_progress(self) -> Dict[str, Any]:
        """
        Get execution progress statistics
        
        Returns:
            Dictionary with progress information
        """
        total_edges = len(self.edge_states)
        completed_edges = sum(1 for state in self.edge_states.values() if state == "completed")
        processing_edges = sum(1 for state in self.edge_states.values() if state == "processing")
        pending_edges = sum(1 for state in self.edge_states.values() if state == "pending")
        
        total_blocks = len(self.block_states)
        processed_blocks = sum(1 for state in self.block_states.values() if state == "processed")
        
        return {
            "edges": {
                "total": total_edges,
                "completed": completed_edges,
                "processing": processing_edges,
                "pending": pending_edges
            },
            "blocks": {
                "total": total_blocks,
                "processed": processed_blocks,
                "pending": total_blocks - processed_blocks
            },
            "completion_percentage": (completed_edges / total_edges * 100) if total_edges > 0 else 0
        }
    
    def validate_dag(self) -> Tuple[bool, List[str]]:
        """
        Validate that the workflow forms a valid DAG
        
        Returns:
            Tuple of (is_valid, list_of_errors)
        """
        errors = []
        
        # Check for missing input blocks
        for edge_id, input_blocks in self.edge_to_inputs_mapping.items():
            for block_id in input_blocks:
                if block_id not in self.blocks:
                    errors.append(f"Edge {edge_id} references missing input block {block_id}")
        
        # Check for missing output blocks
        for edge_id, output_blocks in self.edge_to_outputs_mapping.items():
            for block_id in output_blocks:
                if block_id not in self.blocks:
                    errors.append(f"Edge {edge_id} references missing output block {block_id}")
        
        # Check for cycles (simplified - could be enhanced)
        # For now, just ensure no block is both input and output of the same edge
        for edge_id in self.edges:
            inputs = self.edge_to_inputs_mapping.get(edge_id, set())
            outputs = self.edge_to_outputs_mapping.get(edge_id, set())
            overlap = inputs.intersection(outputs)
            if overlap:
                errors.append(f"Edge {edge_id} has blocks that are both input and output: {overlap}")
        
        is_valid = len(errors) == 0
        if not is_valid:
            log_warning(f"DAG validation failed with {len(errors)} errors")
        
        return is_valid, errors
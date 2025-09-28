"""
Event Factory

This module provides centralized event creation for workflow execution,
ensuring consistent event structure and reducing duplication across the system.
"""

from typing import Dict, Any, List, Set, Optional
from datetime import datetime
import os


class EventFactory:
    """
    Factory class for creating standardized workflow execution events
    
    This class centralizes event creation to ensure consistency and
    reduce duplication of event structure definitions.
    """
    
    @staticmethod
    def create_task_started_event(env_id: str, start_time: datetime, total_blocks: int, total_edges: int) -> Dict[str, Any]:
        """Create TASK_STARTED event"""
        # Broadcast storage threshold to align FE/BE chunking decisions
        try:
            storage_threshold_bytes = int(os.getenv("STORAGE_CHUNK_SIZE", "1024"))
        except Exception:
            storage_threshold_bytes = 1024
        return {
            "event_type": "TASK_STARTED",
            "env_id": env_id,
            "timestamp": start_time.isoformat(),
            "total_blocks": total_blocks,
            "total_edges": total_edges,
            "storage_threshold_bytes": storage_threshold_bytes,
        }
    
    @staticmethod
    def create_task_completed_event(env_id: str, start_time: datetime, blocks_processed: int, edges_completed: int) -> Dict[str, Any]:
        """Create TASK_COMPLETED event"""
        current_time = datetime.utcnow()
        return {
            "event_type": "TASK_COMPLETED",
            "env_id": env_id,
            "timestamp": current_time.isoformat(),
            "duration": (current_time - start_time).total_seconds(),
            "total_blocks_processed": blocks_processed,
            "total_edges_completed": edges_completed
        }
    
    @staticmethod
    def create_task_failed_event(env_id: str, error: Exception) -> Dict[str, Any]:
        """Create TASK_FAILED event"""
        import traceback
        return {
            "event_type": "TASK_FAILED",
            "env_id": env_id,
            "error_message": str(error),
            "error_type": type(error).__name__,
            "traceback": traceback.format_exc(),
            "timestamp": datetime.utcnow().isoformat()
        }
    
    @staticmethod
    def create_progress_update_event(env_id: str, progress: Dict[str, Any]) -> Dict[str, Any]:
        """Create PROGRESS_UPDATE event"""
        return {
            "event_type": "PROGRESS_UPDATE",
            "env_id": env_id,
            "progress": progress,
            "timestamp": datetime.utcnow().isoformat()
        }
    
    @staticmethod
    def create_edge_started_event(edge_id: str, edge_type: str) -> Dict[str, Any]:
        """Create EDGE_STARTED event"""
        return {
            "event_type": "EDGE_STARTED",
            "edge_id": edge_id,
            "edge_type": edge_type,
            "timestamp": datetime.utcnow().isoformat()
        }
    
    @staticmethod
    def create_edge_completed_event(edge_id: str, output_blocks: List[str]) -> Dict[str, Any]:
        """Create EDGE_COMPLETED event"""
        return {
            "event_type": "EDGE_COMPLETED",
            "edge_id": edge_id,
            "output_blocks": output_blocks,
            "timestamp": datetime.utcnow().isoformat()
        }
    
    @staticmethod
    def create_edge_error_event(edge_id: str, error: Exception) -> Dict[str, Any]:
        """Create EDGE_ERROR event"""
        return {
            "event_type": "EDGE_ERROR",
            "edge_id": edge_id,
            "error_message": str(error),
            "error_type": type(error).__name__,
            "timestamp": datetime.utcnow().isoformat()
        }
    
    @staticmethod
    def create_block_updated_event_internal(block_id: str, content: Any, semantic_type: str = None) -> Dict[str, Any]:
        """Create BLOCK_UPDATED event for internal storage"""
        # Use explicit semantic type if provided, otherwise infer from content
        if semantic_type:
            content_type = semantic_type
        else:
            # Fallback to runtime inference for backward compatibility
            try:
                if isinstance(content, (list, dict)):
                    content_type = "structured"
                else:
                    content_type = "text"
            except Exception:
                content_type = "text"

        return {
            "event_type": "BLOCK_UPDATED",
            "block_id": block_id,
            "storage_class": "internal",
            "type": content_type,
            "content": content,
            "timestamp": datetime.utcnow().isoformat()
        }
    
    @staticmethod
    def create_block_updated_event_external(block_id: str, external_metadata: Dict[str, Any]) -> Dict[str, Any]:
        """Create BLOCK_UPDATED event for external storage"""
        return {
            "event_type": "BLOCK_UPDATED",
            "block_id": block_id,
            "storage_class": "external",
            "external_metadata": external_metadata,
            "timestamp": datetime.utcnow().isoformat()
        }
    
    @staticmethod
    def create_batch_completed_event(edge_ids: Set[str], output_blocks: List[str]) -> Dict[str, Any]:
        """Create BATCH_COMPLETED event"""
        return {
            "event_type": "BATCH_COMPLETED",
            "edge_ids": list(edge_ids),
            "output_blocks": output_blocks,
            "timestamp": datetime.utcnow().isoformat()
        }
    
    @staticmethod
    def create_v1_compatibility_event(results: Dict[str, Any]) -> Dict[str, Any]:
        """Create v1 compatibility event for backward compatibility"""
        return {
            "data": results,
            "is_complete": False,
            "yield_count": len(results)
        }

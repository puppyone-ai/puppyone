"""
Hybrid Storage Policy

This module provides a unified storage strategy decision system that determines
whether content should be stored internally or externally based on configurable thresholds.

CRITICAL CONSISTENCY REQUIREMENT:
The storage threshold MUST match across all three write operations:
1. Template Instantiation: CloudTemplateLoader.STORAGE_THRESHOLD (1MB)
2. Frontend Runtime: dynamicStorageStrategy.CONTENT_LENGTH_THRESHOLD (1MB)
3. Backend Computation: HybridStoragePolicy.threshold (1MB)

Design Rationale:
- Threshold = Part Size (1MB) to avoid creating external storage for single-part content
- 1MB is production-grade standard (AWS S3: 5MB, Azure: 4MB, GCP: 8MB)
- Content <1MB: inline storage (efficient, no network overhead)
- Content >=1MB: external storage with partitioning

See: docs/architecture/STORAGE_CONSISTENCY_BEST_PRACTICES.md
"""

import os
import json
from typing import Any, Dict


class HybridStoragePolicy:
    """
    Unified storage policy that determines storage strategy based on content size
    
    This class provides a single source of truth for storage decisions,
    eliminating duplicate logic across the codebase.
    """
    
    def __init__(self, threshold: int = None):
        """
        Initialize storage policy with configurable threshold
        
        Args:
            threshold: Size threshold in characters. If None, reads from environment
                      Default: 1MB = 1,048,576 bytes (aligned with frontend and template instantiation)
        """
        STORAGE_THRESHOLD_MB = 1024 * 1024  # 1MB = 1,048,576 bytes
        self.threshold = threshold or int(os.getenv("STORAGE_THRESHOLD", str(STORAGE_THRESHOLD_MB)))
    
    def should_use_external_storage(self, content: Any, force_external: bool = False) -> bool:
        """
        Determine if external storage should be used for the given content
        
        Args:
            content: The content to evaluate
            force_external: If True, forces external storage regardless of size
            
        Returns:
            bool: True if external storage should be used
        """
        if force_external:
            return True
        
        if content is None:
            return False
        
        content_size = self.calculate_content_size(content)
        return content_size >= self.threshold
    
    def calculate_content_size(self, content: Any) -> int:
        """
        Calculate the approximate size of content in characters
        
        This method provides consistent content size calculation across the system.
        
        Args:
            content: The content to measure
            
        Returns:
            int: Approximate size in characters
        """
        if content is None:
            return 0
        
        if isinstance(content, str):
            return len(content)
        elif isinstance(content, (list, dict)):
            # For structured data, convert to JSON string to measure length
            try:
                return len(json.dumps(content, ensure_ascii=False))
            except Exception:
                return 0
        elif isinstance(content, bytes):
            return len(content)
        else:
            # For other types, try to convert to string
            try:
                return len(str(content))
            except Exception:
                return 0
    
    def get_storage_metadata(self, content: Any, force_external: bool = False) -> Dict[str, Any]:
        """
        Get storage metadata for the given content
        
        Args:
            content: The content to evaluate
            force_external: If True, forces external storage regardless of size
            
        Returns:
            Dict containing storage strategy and metadata
        """
        use_external = self.should_use_external_storage(content, force_external)
        content_size = self.calculate_content_size(content)
        
        return {
            "use_external_storage": use_external,
            "storage_class": "external" if use_external else "internal",
            "content_size": content_size,
            "threshold": self.threshold
        }

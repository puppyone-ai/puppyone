"""
Storage Threshold Consistency Tests

Purpose: Verify that storage thresholds are aligned across all three write operations
to prevent inconsistent storage_class decisions

Critical Requirement:
- Template Instantiation (CloudTemplateLoader)
- Frontend Runtime (dynamicStorageStrategy)
- Backend Computation (HybridStoragePolicy)

All three MUST use the same 1MB threshold.
"""

import unittest
import os
from Server.HybridStoragePolicy import HybridStoragePolicy


class TestStorageThresholdConsistency(unittest.TestCase):
    """Verify storage threshold consistency across the system"""
    
    EXPECTED_THRESHOLD = 1024 * 1024  # 1MB = 1,048,576 bytes
    OLD_INCORRECT_THRESHOLD = 1024  # 1KB (historical bug)
    
    def test_backend_threshold_matches_expected(self):
        """Backend HybridStoragePolicy should use 1MB threshold"""
        policy = HybridStoragePolicy()
        self.assertEqual(
            policy.threshold, 
            self.EXPECTED_THRESHOLD,
            f"Backend threshold should be 1MB (1,048,576), got {policy.threshold}"
        )
    
    def test_backend_threshold_not_old_1kb_value(self):
        """Verify backend is not using the old incorrect 1KB threshold"""
        policy = HybridStoragePolicy()
        self.assertNotEqual(
            policy.threshold,
            self.OLD_INCORRECT_THRESHOLD,
            "Backend threshold should NOT be 1KB (historical bug)"
        )
    
    def test_storage_decisions_at_boundaries(self):
        """Test storage decisions at critical size boundaries"""
        policy = HybridStoragePolicy()
        
        test_cases = [
            (100, False, "100 bytes (tiny)"),
            (1024, False, "1KB (small)"),
            (10 * 1024, False, "10KB (typical short text)"),
            (100 * 1024, False, "100KB (medium text)"),
            (500 * 1024, False, "500KB (long text)"),
            (1024 * 1024 - 1, False, "1MB - 1 byte (boundary)"),
            (1024 * 1024, True, "1MB (exact boundary)"),
            (1024 * 1024 + 1, True, "1MB + 1 byte (just over)"),
            (2 * 1024 * 1024, True, "2MB (large)"),
            (10 * 1024 * 1024, True, "10MB (very large)"),
        ]
        
        for size, should_use_external, desc in test_cases:
            with self.subTest(desc=desc):
                content = "x" * size
                result = policy.should_use_external_storage(content)
                self.assertEqual(
                    result, should_use_external,
                    f"{desc}: expected {'external' if should_use_external else 'internal'}, "
                    f"got {'external' if result else 'internal'}"
                )
    
    def test_real_world_llm_output_scenarios(self):
        """Test realistic LLM output size scenarios"""
        policy = HybridStoragePolicy()
        
        # Typical GPT-4 output: 2-5KB
        typical_gpt4_output = "x" * (3 * 1024)  # 3KB
        self.assertFalse(
            policy.should_use_external_storage(typical_gpt4_output),
            "Typical GPT-4 output (3KB) should use internal storage"
        )
        
        # Long-form content: ~50KB
        long_form_content = "x" * (50 * 1024)  # 50KB
        self.assertFalse(
            policy.should_use_external_storage(long_form_content),
            "Long-form content (50KB) should use internal storage"
        )
        
        # Large structured data: 2MB
        large_structured_data = "x" * (2 * 1024 * 1024)  # 2MB
        self.assertTrue(
            policy.should_use_external_storage(large_structured_data),
            "Large structured data (2MB) should use external storage"
        )
    
    def test_protection_against_1kb_regression(self):
        """Ensure 10KB content is NOT externalized (would happen with 1KB threshold bug)"""
        policy = HybridStoragePolicy()
        ten_kb_content = "x" * (10 * 1024)
        
        # With correct 1MB threshold: should be internal
        result = policy.should_use_external_storage(ten_kb_content)
        self.assertFalse(
            result,
            "10KB content should use internal storage with 1MB threshold"
        )
        
        # Verify we're not using the buggy 1KB threshold
        self.assertGreater(
            policy.threshold,
            10 * 1024,
            "Threshold should be greater than 10KB to avoid unnecessary externalization"
        )
    
    def test_structured_content_size_calculation(self):
        """Test that structured content (dict/list) is measured correctly"""
        policy = HybridStoragePolicy()
        
        # Small dict (should be internal)
        small_dict = {"key": "value"}
        small_size = policy.calculate_content_size(small_dict)
        self.assertLess(small_size, policy.threshold)
        self.assertFalse(policy.should_use_external_storage(small_dict))
        
        # Large list (should be external if serialized size > 1MB)
        # Create a list that serializes to >1MB (need more data to exceed 1MB threshold)
        large_list = [{"id": i, "data": "x" * 1500} for i in range(1000)]
        large_size = policy.calculate_content_size(large_list)
        self.assertGreater(large_size, policy.threshold,
                          f"Large list size {large_size} should be > {policy.threshold}")
        self.assertTrue(policy.should_use_external_storage(large_list))
    
    def test_environment_variable_override(self):
        """Test that STORAGE_THRESHOLD env var can override default"""
        # Save original env var
        original_env = os.environ.get('STORAGE_THRESHOLD')
        
        try:
            # Test with custom threshold
            custom_threshold = 500 * 1024  # 500KB
            os.environ['STORAGE_THRESHOLD'] = str(custom_threshold)
            
            policy = HybridStoragePolicy()
            self.assertEqual(
                policy.threshold,
                custom_threshold,
                "Policy should respect STORAGE_THRESHOLD env var"
            )
        finally:
            # Restore original env var
            if original_env is None:
                os.environ.pop('STORAGE_THRESHOLD', None)
            else:
                os.environ['STORAGE_THRESHOLD'] = original_env


class TestStorageMetadataCalculation(unittest.TestCase):
    """Test storage metadata generation"""
    
    def test_metadata_structure_for_internal_storage(self):
        """Verify metadata structure for internal storage"""
        policy = HybridStoragePolicy()
        small_content = "x" * 1024  # 1KB
        
        metadata = policy.get_storage_metadata(small_content)
        
        self.assertFalse(metadata['use_external_storage'])
        self.assertEqual(metadata['storage_class'], 'internal')
        self.assertEqual(metadata['content_size'], 1024)
        self.assertEqual(metadata['threshold'], 1024 * 1024)
    
    def test_metadata_structure_for_external_storage(self):
        """Verify metadata structure for external storage"""
        policy = HybridStoragePolicy()
        large_content = "x" * (2 * 1024 * 1024)  # 2MB
        
        metadata = policy.get_storage_metadata(large_content)
        
        self.assertTrue(metadata['use_external_storage'])
        self.assertEqual(metadata['storage_class'], 'external')
        self.assertEqual(metadata['content_size'], 2 * 1024 * 1024)
        self.assertEqual(metadata['threshold'], 1024 * 1024)


if __name__ == '__main__':
    # Run with verbose output
    unittest.main(verbosity=2)


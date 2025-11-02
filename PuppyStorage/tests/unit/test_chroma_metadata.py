"""
Unit tests for ChromaDB metadata flattening

Tests the flatten_metadata_for_chroma() function and its integration
with store_vectors() to ensure ChromaDB compatibility.

ChromaDB Constraint: metadata values must be str, int, float, bool, or None.
Nested structures (dict, list) must be serialized to JSON strings.
"""

import pytest
import json
from unittest.mock import Mock, patch, MagicMock


@pytest.mark.unit
def test_flatten_metadata_primitives():
    """Test that primitive types are passed through unchanged"""
    from vector.vdb.chroma import flatten_metadata_for_chroma
    
    metadata = {
        "string": "hello",
        "integer": 42,
        "float": 3.14,
        "boolean": True,
        "none": None,
    }
    
    result = flatten_metadata_for_chroma(metadata)
    
    assert result["string"] == "hello"
    assert result["integer"] == 42
    assert result["float"] == 3.14
    assert result["boolean"] is True
    assert result["none"] is None


@pytest.mark.unit
def test_flatten_metadata_nested_dict():
    """Test that nested dicts are serialized to JSON strings"""
    from vector.vdb.chroma import flatten_metadata_for_chroma
    
    metadata = {
        "id": 0,
        "retrieval_content": {
            "question": "Where are you?",
            "answer": "PuppyAgent is based in Singapore"
        }
    }
    
    result = flatten_metadata_for_chroma(metadata)
    
    assert result["id"] == 0
    assert isinstance(result["retrieval_content"], str)
    
    # Verify it can be deserialized back
    parsed = json.loads(result["retrieval_content"])
    assert parsed["question"] == "Where are you?"
    assert parsed["answer"] == "PuppyAgent is based in Singapore"


@pytest.mark.unit
def test_flatten_metadata_nested_list():
    """Test that nested lists are serialized to JSON strings"""
    from vector.vdb.chroma import flatten_metadata_for_chroma
    
    metadata = {
        "tags": ["python", "ai", "machine-learning"],
        "scores": [0.9, 0.8, 0.7]
    }
    
    result = flatten_metadata_for_chroma(metadata)
    
    assert isinstance(result["tags"], str)
    assert isinstance(result["scores"], str)
    
    # Verify deserialization
    tags = json.loads(result["tags"])
    scores = json.loads(result["scores"])
    assert tags == ["python", "ai", "machine-learning"]
    assert scores == [0.9, 0.8, 0.7]


@pytest.mark.unit
def test_flatten_metadata_complex_nested():
    """Test deeply nested structures"""
    from vector.vdb.chroma import flatten_metadata_for_chroma
    
    metadata = {
        "simple": "value",
        "complex": {
            "level1": {
                "level2": {
                    "level3": "deep value"
                }
            },
            "array": [1, 2, {"nested": "object"}]
        }
    }
    
    result = flatten_metadata_for_chroma(metadata)
    
    assert result["simple"] == "value"
    assert isinstance(result["complex"], str)
    
    # Verify complex structure is preserved in JSON
    parsed = json.loads(result["complex"])
    assert parsed["level1"]["level2"]["level3"] == "deep value"
    assert parsed["array"][2]["nested"] == "object"


@pytest.mark.unit
def test_flatten_metadata_empty():
    """Test empty metadata"""
    from vector.vdb.chroma import flatten_metadata_for_chroma
    
    result = flatten_metadata_for_chroma({})
    assert result == {}


@pytest.mark.unit
def test_flatten_metadata_mixed_types():
    """Test realistic metadata with mixed primitive and nested types"""
    from vector.vdb.chroma import flatten_metadata_for_chroma
    
    metadata = {
        "id": 123,
        "timestamp": "2024-01-01T00:00:00Z",
        "score": 0.95,
        "is_active": True,
        "user_data": {
            "name": "John Doe",
            "age": 30
        },
        "tags": ["important", "verified"],
        "null_field": None
    }
    
    result = flatten_metadata_for_chroma(metadata)
    
    # Primitives unchanged
    assert result["id"] == 123
    assert result["timestamp"] == "2024-01-01T00:00:00Z"
    assert result["score"] == 0.95
    assert result["is_active"] is True
    assert result["null_field"] is None
    
    # Nested structures serialized
    assert isinstance(result["user_data"], str)
    assert isinstance(result["tags"], str)
    
    # Verify deserialization
    user_data = json.loads(result["user_data"])
    assert user_data["name"] == "John Doe"
    tags = json.loads(result["tags"])
    assert tags == ["important", "verified"]


@pytest.mark.unit
def test_flatten_metadata_unicode():
    """Test that unicode characters are preserved"""
    from vector.vdb.chroma import flatten_metadata_for_chroma
    
    metadata = {
        "chinese": "你好世界",
        "emoji": "🐶",
        "nested": {
            "japanese": "こんにちは",
            "arabic": "مرحبا"
        }
    }
    
    result = flatten_metadata_for_chroma(metadata)
    
    assert result["chinese"] == "你好世界"
    assert result["emoji"] == "🐶"
    
    nested = json.loads(result["nested"])
    assert nested["japanese"] == "こんにちは"
    assert nested["arabic"] == "مرحبا"


@pytest.mark.unit
def test_flatten_metadata_special_values():
    """Test edge cases like empty strings, zero, false"""
    from vector.vdb.chroma import flatten_metadata_for_chroma
    
    metadata = {
        "empty_string": "",
        "zero": 0,
        "false": False,
        "negative": -42,
        "empty_dict": {},
        "empty_list": []
    }
    
    result = flatten_metadata_for_chroma(metadata)
    
    assert result["empty_string"] == ""
    assert result["zero"] == 0
    assert result["false"] is False
    assert result["negative"] == -42
    
    # Empty collections should be serialized to JSON
    assert result["empty_dict"] == "{}"
    assert result["empty_list"] == "[]"


@pytest.mark.unit
def test_chroma_store_vectors_with_nested_metadata():
    """Integration test: store_vectors with nested metadata"""
    from vector.vdb.chroma import ChromaVectorDatabase
    
    # Mock the ChromaDB client
    with patch('vector.vdb.chroma.chromadb.PersistentClient') as MockClient:
        mock_client = Mock()
        mock_collection = Mock()
        
        # Setup mock
        MockClient.return_value = mock_client
        mock_client.get_or_create_collection.return_value = mock_collection
        
        # Create database instance
        db = ChromaVectorDatabase()
        
        # Test data with nested metadata
        vectors = [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]
        contents = ["content1", "content2"]
        metadata = [
            {
                "id": 0,
                "retrieval_content": {
                    "question": "What is AI?",
                    "answer": "Artificial Intelligence"
                }
            },
            {
                "id": 1,
                "retrieval_content": {
                    "question": "What is ML?",
                    "answer": "Machine Learning"
                }
            }
        ]
        
        # Call store_vectors
        db.store_vectors(
            vectors=vectors,
            contents=contents,
            metadata=metadata,
            collection_name="test_collection"
        )
        
        # Verify collection.add was called
        mock_collection.add.assert_called_once()
        
        # Extract the actual metadata passed to ChromaDB
        call_args = mock_collection.add.call_args
        stored_metadata = call_args[1]['metadatas']
        
        # Verify metadata was flattened
        assert len(stored_metadata) == 2
        
        # First entry
        assert stored_metadata[0]["id"] == 0
        assert isinstance(stored_metadata[0]["retrieval_content"], str)
        parsed_0 = json.loads(stored_metadata[0]["retrieval_content"])
        assert parsed_0["question"] == "What is AI?"
        
        # Second entry
        assert stored_metadata[1]["id"] == 1
        assert isinstance(stored_metadata[1]["retrieval_content"], str)
        parsed_1 = json.loads(stored_metadata[1]["retrieval_content"])
        assert parsed_1["question"] == "What is ML?"


@pytest.mark.unit
def test_chroma_store_vectors_with_primitive_metadata():
    """Test that primitive metadata still works correctly"""
    from vector.vdb.chroma import ChromaVectorDatabase
    
    # Reset singleton to ensure clean state
    ChromaVectorDatabase._client = None
    
    with patch('vector.vdb.chroma.chromadb.PersistentClient') as MockClient:
        mock_client = Mock()
        mock_collection = Mock()
        
        MockClient.return_value = mock_client
        mock_client.get_or_create_collection.return_value = mock_collection
        
        db = ChromaVectorDatabase()
        
        # Simple metadata without nesting
        vectors = [[0.1, 0.2]]
        contents = ["test content"]
        metadata = [{"id": 42, "name": "test", "score": 0.95}]
        
        db.store_vectors(
            vectors=vectors,
            contents=contents,
            metadata=metadata,
            collection_name="test_collection"
        )
        
        # Verify metadata is passed through unchanged
        call_args = mock_collection.add.call_args
        stored_metadata = call_args[1]['metadatas']
        
        assert stored_metadata[0]["id"] == 42
        assert stored_metadata[0]["name"] == "test"
        assert stored_metadata[0]["score"] == 0.95


@pytest.mark.unit
def test_chroma_store_vectors_without_metadata():
    """Test store_vectors with no metadata (should auto-generate)"""
    from vector.vdb.chroma import ChromaVectorDatabase
    
    # Reset singleton to ensure clean state
    ChromaVectorDatabase._client = None
    
    with patch('vector.vdb.chroma.chromadb.PersistentClient') as MockClient:
        mock_client = Mock()
        mock_collection = Mock()
        
        MockClient.return_value = mock_client
        mock_client.get_or_create_collection.return_value = mock_collection
        
        db = ChromaVectorDatabase()
        
        vectors = [[0.1, 0.2]]
        contents = ["test content"]
        
        db.store_vectors(
            vectors=vectors,
            contents=contents,
            metadata=None,
            collection_name="test_collection"
        )
        
        # Verify metadata was auto-generated
        call_args = mock_collection.add.call_args
        stored_metadata = call_args[1]['metadatas']
        
        assert len(stored_metadata) == 1
        assert "content" in stored_metadata[0]
        assert stored_metadata[0]["content"] == "test content"


@pytest.mark.unit
def test_flatten_metadata_custom_objects():
    """Test that custom objects are converted to strings"""
    from vector.vdb.chroma import flatten_metadata_for_chroma
    
    class CustomObject:
        def __str__(self):
            return "CustomObject(value=42)"
    
    metadata = {
        "custom": CustomObject(),
        "normal": "string"
    }
    
    result = flatten_metadata_for_chroma(metadata)
    
    assert result["custom"] == "CustomObject(value=42)"
    assert result["normal"] == "string"


@pytest.mark.unit  
def test_flatten_metadata_preserves_content_field():
    """Test that content field (added by store_vectors) is preserved"""
    from vector.vdb.chroma import flatten_metadata_for_chroma
    
    metadata = {
        "id": 1,
        "content": "This is the content text",
        "nested": {"key": "value"}
    }
    
    result = flatten_metadata_for_chroma(metadata)
    
    # Content should be preserved as string
    assert result["content"] == "This is the content text"
    assert result["id"] == 1
    assert isinstance(result["nested"], str)


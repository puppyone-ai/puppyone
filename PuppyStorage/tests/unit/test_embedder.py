"""
Unit tests for Embedder module (Ollama and OpenAI providers only)
"""

import pytest
import os
from unittest.mock import Mock, patch, MagicMock


@pytest.mark.unit
def test_text_embedder_create_ollama():
    """Test TextEmbedder.create() with Ollama model"""
    from vector.embedder import TextEmbedder, ModelRegistry
    
    # Register a test model using class method
    ModelRegistry.register_models("ollama", ["llama3"])
    
    # Mock network requests before provider instantiation
    with patch('requests.get') as mock_get:
        # Mock health check in OllamaProvider.__init__
        mock_get.return_value.status_code = 200
        mock_get.return_value.raise_for_status = Mock()
        
        # Create with Ollama model (will use mocked health check)
        embedder = TextEmbedder.create("llama3")
        assert embedder is not None
        
        # Mock the actual embedding call
        with patch('requests.post') as mock_post:
            mock_post.return_value.json.return_value = {'embeddings': [0.1, 0.2, 0.3]}
            mock_post.return_value.raise_for_status = Mock()
            
            result = embedder.embed(["test"])
            assert len(result) == 1
            assert result[0] == [0.1, 0.2, 0.3]


@pytest.mark.unit
def test_text_embedder_create_openai():
    """Test TextEmbedder.create() with OpenAI model"""
    from vector.embedder import TextEmbedder, ModelRegistry
    
    # Register a test model using class method
    ModelRegistry.register_models("openai", ["text-embedding-3-small"])
    
    # Mock OpenAI API key and client
    with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}):
        with patch('vector.embedder.OpenAI') as MockOpenAIClient:
            # Mock the OpenAI client and embeddings API
            mock_client = Mock()
            mock_embeddings = Mock()
            mock_response = Mock()
            mock_response.data = [Mock(embedding=[0.4, 0.5, 0.6])]
            mock_embeddings.create.return_value = mock_response
            mock_client.embeddings = mock_embeddings
            MockOpenAIClient.return_value = mock_client
            
            # Create with OpenAI model
            embedder = TextEmbedder.create("text-embedding-3-small", provider="openai")
            assert embedder is not None
            
            # Test embedding
            result = embedder.embed(["test"])
            assert len(result) == 1
            assert result[0] == [0.4, 0.5, 0.6]


@pytest.mark.unit
def test_ollama_provider_embed():
    """Test OllamaProvider.embed() with mocked HTTP response"""
    from vector.embedder import OllamaProvider
    
    with patch('requests.get') as mock_get, \
         patch('requests.post') as mock_post:
        # Mock health check
        mock_get.return_value.status_code = 200
        mock_get.return_value.raise_for_status = Mock()
        
        # Mock successful embedding response (Ollama returns "embeddings" key)
        mock_response = Mock()
        mock_response.json.return_value = {'embeddings': [0.1, 0.2, 0.3]}
        mock_response.raise_for_status = Mock()
        mock_post.return_value = mock_response
        
        provider = OllamaProvider(model_name="llama3", endpoint="http://localhost:11434")
        result = provider.embed(["test text"])
        
        assert len(result) == 1
        assert result[0] == [0.1, 0.2, 0.3]
        mock_post.assert_called_once()


@pytest.mark.unit
def test_ollama_provider_batch_embed():
    """Test OllamaProvider with multiple texts"""
    from vector.embedder import OllamaProvider
    
    with patch('requests.get') as mock_get, \
         patch('requests.post') as mock_post:
        # Mock health check
        mock_get.return_value.status_code = 200
        mock_get.return_value.raise_for_status = Mock()
        
        # Mock responses for batch (Ollama returns "embeddings" key)
        mock_response = Mock()
        mock_response.json.side_effect = [
            {'embeddings': [0.1, 0.2, 0.3]},
            {'embeddings': [0.4, 0.5, 0.6]}
        ]
        mock_response.raise_for_status = Mock()
        mock_post.return_value = mock_response
        
        provider = OllamaProvider(model_name="llama3")
        result = provider.embed(["text1", "text2"])
        
        assert len(result) == 2
        assert result[0] == [0.1, 0.2, 0.3]
        assert result[1] == [0.4, 0.5, 0.6]


@pytest.mark.unit
def test_ollama_provider_error_handling():
    """Test OllamaProvider error handling"""
    from vector.embedder import OllamaProvider
    
    with patch('requests.get') as mock_get, \
         patch('requests.post') as mock_post:
        # Mock health check success
        mock_get.return_value.status_code = 200
        mock_get.return_value.raise_for_status = Mock()
        
        # Mock HTTP error on embedding
        mock_post.side_effect = Exception("Connection failed")
        
        provider = OllamaProvider(model_name="llama3")
        
        with pytest.raises(Exception):
            provider.embed(["test"])


@pytest.mark.unit
def test_openai_provider_embed():
    """Test OpenAIProvider.embed() with mocked OpenAI client"""
    from vector.embedder import OpenAIProvider
    
    with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}):
        with patch('vector.embedder.OpenAI') as MockOpenAIClient:
            # Mock OpenAI client
            mock_client = Mock()
            mock_embedding = Mock()
            mock_embedding.embedding = [0.7, 0.8, 0.9]
            mock_client.embeddings.create.return_value = Mock(data=[mock_embedding])
            MockOpenAIClient.return_value = mock_client
            
            provider = OpenAIProvider(model_name="text-embedding-3-small")
            result = provider.embed(["test text"])
            
            assert len(result) == 1
            assert result[0] == [0.7, 0.8, 0.9]


@pytest.mark.unit
def test_openai_provider_batch_embed():
    """Test OpenAIProvider with multiple texts"""
    from vector.embedder import OpenAIProvider
    
    with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}):
        with patch('vector.embedder.OpenAI') as MockOpenAIClient:
            # Mock batch embeddings
            mock_client = Mock()
            mock_emb1 = Mock()
            mock_emb1.embedding = [0.1, 0.2, 0.3]
            mock_emb2 = Mock()
            mock_emb2.embedding = [0.4, 0.5, 0.6]
            mock_client.embeddings.create.return_value = Mock(data=[mock_emb1, mock_emb2])
            MockOpenAIClient.return_value = mock_client
            
            provider = OpenAIProvider(model_name="text-embedding-3-small")
            result = provider.embed(["text1", "text2"])
            
            assert len(result) == 2
            assert result[0] == [0.1, 0.2, 0.3]
            assert result[1] == [0.4, 0.5, 0.6]


@pytest.mark.unit
def test_model_registry_singleton():
    """Test ModelRegistry is a singleton"""
    from vector.embedder import ModelRegistry
    
    registry1 = ModelRegistry()
    registry2 = ModelRegistry()
    
    assert registry1 is registry2


@pytest.mark.unit
def test_model_registry_register_provider():
    """Test registering a provider in ModelRegistry"""
    from vector.embedder import ModelRegistry
    
    # Mock provider
    class MockProvider:
        pass
    
    # Register using class method
    ModelRegistry.register_provider("mock_provider", MockProvider)
    assert "mock_provider" in ModelRegistry._providers


@pytest.mark.unit
def test_text_embedder_with_endpoint():
    """Test TextEmbedder.create() with custom endpoint"""
    from vector.embedder import TextEmbedder, ModelRegistry
    
    # Register a test model using class method
    ModelRegistry.register_models("ollama", ["llama3"])
    
    # Mock health check for custom endpoint
    with patch('requests.get') as mock_get:
        mock_get.return_value.status_code = 200
        mock_get.return_value.raise_for_status = Mock()
        
        embedder = TextEmbedder.create("llama3", endpoint="http://custom:11434")
        
        # Verify health check was called with custom endpoint
        mock_get.assert_called_once()
        call_url = mock_get.call_args[0][0]
        assert "http://custom:11434" in call_url


@pytest.mark.unit
def test_text_embedder_empty_input():
    """Test TextEmbedder with empty input"""
    from vector.embedder import TextEmbedder, ModelRegistry
    
    # Register a test model using class method
    ModelRegistry.register_models("ollama", ["llama3"])
    
    # Mock health check
    with patch('requests.get') as mock_get:
        mock_get.return_value.status_code = 200
        mock_get.return_value.raise_for_status = Mock()
        
        embedder = TextEmbedder.create("llama3")
        
        # Empty input should return empty result without calling API
        result = embedder.embed([])
        assert result == []


@pytest.mark.unit
def test_embedder_dimension_consistency():
    """Test that embeddings have consistent dimensions"""
    from vector.embedder import OllamaProvider
    
    with patch('requests.get') as mock_get, \
         patch('requests.post') as mock_post:
        # Mock health check
        mock_get.return_value.status_code = 200
        mock_get.return_value.raise_for_status = Mock()
        
        # Mock responses with same dimension (Ollama returns "embeddings" key)
        mock_response = Mock()
        mock_response.json.side_effect = [
            {'embeddings': [0.1, 0.2, 0.3]},
            {'embeddings': [0.4, 0.5, 0.6]},
            {'embeddings': [0.7, 0.8, 0.9]}
        ]
        mock_response.raise_for_status = Mock()
        mock_post.return_value = mock_response
        
        provider = OllamaProvider(model_name="llama3")
        result = provider.embed(["text1", "text2", "text3"])
        
        # Check all embeddings have same dimension
        assert len(result) == 3
        assert all(len(emb) == 3 for emb in result)


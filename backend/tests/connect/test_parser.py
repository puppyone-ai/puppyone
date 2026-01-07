"""
Tests for URL parser with Firecrawl integration
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from src.connect.parser import UrlParser
from src.exceptions import BusinessException


@pytest.fixture
def parser():
    """Create a URL parser instance"""
    return UrlParser(user_id="test_user")


@pytest.fixture
def mock_firecrawl_response():
    """Mock Firecrawl scrape response"""
    return {
        "markdown": "# Test Title\n\nThis is test content.\n\n## Section 1\n\nSection content here.",
        "html": "<html><body><h1>Test Title</h1><p>This is test content.</p></body></html>",
        "metadata": {
            "title": "Test Page Title",
            "description": "Test description",
            "sourceURL": "https://example.com",
            "statusCode": 200,
        },
    }


@pytest.mark.asyncio
class TestParserWithFirecrawl:
    """Test parser with Firecrawl integration"""

    async def test_parse_html_with_firecrawl_success(
        self, parser, mock_firecrawl_response
    ):
        """Test successful HTML parsing with Firecrawl"""
        # Mock Firecrawl client
        parser.firecrawl_client.is_available = MagicMock(return_value=True)
        parser.firecrawl_client.scrape_url = AsyncMock(
            return_value=mock_firecrawl_response
        )

        # Mock httpx response
        mock_response = MagicMock()
        mock_response.content = b"<html>test</html>"
        mock_response.headers = {"content-type": "text/html"}
        mock_response.raise_for_status = MagicMock()

        with patch.object(parser.client, "get", return_value=mock_response):
            result = await parser.parse("https://example.com/test")

            # Verify Firecrawl was called
            parser.firecrawl_client.scrape_url.assert_called_once()

            # Verify result structure
            assert "data" in result
            assert "source_type" in result
            assert "title" in result
            assert result["title"] == "Test Page Title"
            assert isinstance(result["data"], list)
            assert len(result["data"]) > 0

    async def test_parse_html_firecrawl_unavailable_fallback(self, parser):
        """Test fallback to BeautifulSoup when Firecrawl is unavailable"""
        # Mock Firecrawl as unavailable
        parser.firecrawl_client.is_available = MagicMock(return_value=False)

        # Mock httpx response with HTML
        html_content = """
        <html>
            <head><title>Test Page</title></head>
            <body>
                <table>
                    <tr><th>Name</th><th>Value</th></tr>
                    <tr><td>Item 1</td><td>100</td></tr>
                </table>
            </body>
        </html>
        """
        mock_response = MagicMock()
        mock_response.content = html_content.encode()
        mock_response.text = html_content
        mock_response.headers = {"content-type": "text/html"}
        mock_response.raise_for_status = MagicMock()

        with patch.object(parser.client, "get", return_value=mock_response):
            result = await parser.parse("https://example.com/test")

            # Verify result (should use BeautifulSoup parsing)
            assert "data" in result
            assert "source_type" in result
            assert isinstance(result["data"], list)

    async def test_parse_html_firecrawl_fails_fallback(
        self, parser, mock_firecrawl_response
    ):
        """Test fallback to BeautifulSoup when Firecrawl fails"""
        # Mock Firecrawl client to fail
        parser.firecrawl_client.is_available = MagicMock(return_value=True)
        parser.firecrawl_client.scrape_url = AsyncMock(
            side_effect=Exception("Firecrawl API error")
        )

        # Mock httpx response with HTML
        html_content = """
        <html>
            <head><title>Fallback Page</title></head>
            <body><p>This is fallback content.</p></body>
        </html>
        """
        mock_response = MagicMock()
        mock_response.content = html_content.encode()
        mock_response.text = html_content
        mock_response.headers = {"content-type": "text/html"}
        mock_response.raise_for_status = MagicMock()

        with patch.object(parser.client, "get", return_value=mock_response):
            result = await parser.parse("https://example.com/test")

            # Verify result (should use BeautifulSoup as fallback)
            assert "data" in result
            assert "source_type" in result
            assert result["title"] == "Fallback Page"

    async def test_parse_json_bypasses_firecrawl(self, parser):
        """Test that JSON content bypasses Firecrawl"""
        # Mock Firecrawl (should not be called for JSON)
        parser.firecrawl_client.is_available = MagicMock(return_value=True)
        parser.firecrawl_client.scrape_url = AsyncMock()

        # Mock httpx response with JSON
        json_content = '{"data": [{"id": 1, "name": "Test"}]}'
        mock_response = MagicMock()
        mock_response.content = json_content.encode()
        mock_response.text = json_content
        mock_response.headers = {"content-type": "application/json"}
        mock_response.raise_for_status = MagicMock()

        with patch.object(parser.client, "get", return_value=mock_response):
            result = await parser.parse("https://api.example.com/data")

            # Verify Firecrawl was NOT called for JSON
            parser.firecrawl_client.scrape_url.assert_not_called()

            # Verify JSON was parsed correctly
            assert "data" in result
            assert isinstance(result["data"], list)

    async def test_parse_with_provider_bypasses_firecrawl(self, parser):
        """Test that provider handling bypasses Firecrawl"""
        # Create mock provider
        mock_provider = MagicMock()
        mock_provider.can_handle = AsyncMock(return_value=True)
        mock_provider.fetch_data = AsyncMock(
            return_value=MagicMock(
                data=[{"test": "data"}],
                source_type="test_provider",
                title="Provider Title",
                description="",
                fields=[],
                structure_info={},
            )
        )
        parser.register_provider(mock_provider)

        # Mock Firecrawl (should not be called when provider handles)
        parser.firecrawl_client.is_available = MagicMock(return_value=True)
        parser.firecrawl_client.scrape_url = AsyncMock()

        result = await parser.parse("https://example.com/test")

        # Verify provider was used
        mock_provider.fetch_data.assert_called_once()

        # Verify Firecrawl was NOT called
        parser.firecrawl_client.scrape_url.assert_not_called()

        # Verify result
        assert "data" in result
        assert result["source_type"] == "test_provider"

    async def test_parse_firecrawl_empty_markdown(self, parser):
        """Test handling of empty markdown from Firecrawl"""
        # Mock Firecrawl with empty markdown
        parser.firecrawl_client.is_available = MagicMock(return_value=True)
        parser.firecrawl_client.scrape_url = AsyncMock(
            return_value={"markdown": "", "metadata": {}}
        )

        # Mock httpx response
        html_content = "<html><body><p>Fallback content</p></body></html>"
        mock_response = MagicMock()
        mock_response.content = html_content.encode()
        mock_response.text = html_content
        mock_response.headers = {"content-type": "text/html"}
        mock_response.raise_for_status = MagicMock()

        with patch.object(parser.client, "get", return_value=mock_response):
            result = await parser.parse("https://example.com/test")

            # Should fall back to BeautifulSoup when markdown is empty
            assert "data" in result
            assert isinstance(result["data"], list)

    async def test_firecrawl_client_close(self, parser):
        """Test that Firecrawl client is closed properly"""
        parser.firecrawl_client.close = AsyncMock()

        await parser.close()

        # Verify Firecrawl client close was called
        parser.firecrawl_client.close.assert_called_once()


@pytest.mark.asyncio
class TestFirecrawlClient:
    """Test FirecrawlClient wrapper"""

    async def test_firecrawl_client_unavailable_without_api_key(self):
        """Test that client is unavailable without API key"""
        from src.connect.firecrawl_client import FirecrawlClient

        with patch.dict("os.environ", {}, clear=True):
            client = FirecrawlClient()
            assert not client.is_available()

    async def test_firecrawl_client_available_with_api_key(self):
        """Test that client is available with API key"""
        from src.connect.firecrawl_client import FirecrawlClient

        with patch.dict("os.environ", {"FIRECRAWL_API_KEY": "test-key"}):
            client = FirecrawlClient()
            assert client.is_available()

    async def test_firecrawl_scrape_returns_none_when_unavailable(self):
        """Test that scrape returns None when unavailable"""
        from src.connect.firecrawl_client import FirecrawlClient

        with patch.dict("os.environ", {}, clear=True):
            client = FirecrawlClient()
            result = await client.scrape_url("https://example.com")
            assert result is None

    async def test_firecrawl_scrape_handles_import_error(self):
        """Test that scrape handles ImportError gracefully"""
        from src.connect.firecrawl_client import FirecrawlClient

        with patch.dict("os.environ", {"FIRECRAWL_API_KEY": "test-key"}):
            client = FirecrawlClient()

            # Mock import error
            with patch("builtins.__import__", side_effect=ImportError("No module")):
                result = await client.scrape_url("https://example.com")
                assert result is None


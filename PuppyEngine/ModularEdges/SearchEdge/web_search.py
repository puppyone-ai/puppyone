# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import os
import sys
import requests
from typing import List
from duckduckgo_search import DDGS
from bs4 import BeautifulSoup
from readability import Document
from concurrent.futures import ThreadPoolExecutor, as_completed
from Utils.puppy_exception import global_exception_handler
from ModularEdges.SearchEdge.search_strategy import SearchStrategy


class WebSearchStrategy(SearchStrategy):
    """Web Search using Google & DuckDuckGo."""

    @global_exception_handler(3503, "Error Processing Web Content")
    def _fetch_and_parse(self, item: dict) -> dict | None:
        """Fetch URL content and parse it to extract the main content and title."""
        url = item.get("link")
        if not url:
            return None

        try:
            # More comprehensive headers to appear like a real browser
            headers = {
                'User-Agent': os.environ.get(
                    "SEARCH_USER_AGENT", 
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                ),
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Cache-Control': 'max-age=0'
            }
            
            # Make request with better configuration
            response = requests.get(
                url, 
                headers=headers,
                timeout=30,  # Increased timeout
                allow_redirects=True,
                verify=True  # Explicit SSL verification
            )
            
            response.raise_for_status()

            # Check if we got content
            if not response.content:
                return None

            # Smart encoding detection and handling
            text_content = None
            
            # Method 1: Use response.encoding if available
            if response.encoding and response.encoding.lower() != 'iso-8859-1':
                try:
                    text_content = response.text
                except (UnicodeDecodeError, LookupError):
                    text_content = None
            
            # Method 2: Try common encodings
            if text_content is None:
                for encoding in ['utf-8', 'latin-1', 'cp1252', 'iso-8859-1']:
                    try:
                        text_content = response.content.decode(encoding, errors='strict')
                        break
                    except (UnicodeDecodeError, LookupError):
                        continue
            
            # Method 3: Last resort - ignore errors
            if text_content is None:
                text_content = response.content.decode('utf-8', errors='ignore')
            
            # Basic content validation
            if len(text_content.strip()) < 100:
                return None
                
            # Check for obvious encoding issues (too many replacement characters)
            replacement_ratio = text_content.count('�') / max(len(text_content), 1)
            if replacement_ratio > 0.1:  # More than 10% replacement characters
                return None

            # Try to extract readable content using text instead of bytes
            doc = Document(text_content)
            
            # Use readability's title and summary for better quality
            title = doc.title()
            summary_html = doc.summary()
            
            if not summary_html or len(summary_html.strip()) < 50:
                return None
            
            # Parse HTML to get clean text with explicit parser
            soup = BeautifulSoup(summary_html, 'html.parser')
            content = soup.get_text(separator=' ', strip=True)
            
            # Final content validation and cleaning
            if len(content.strip()) < 50:  # Minimum content length
                return None
            
            # Check for garbled content (high ratio of non-printable or weird chars)
            printable_chars = sum(1 for c in content if c.isprintable() or c.isspace())
            printable_ratio = printable_chars / max(len(content), 1)
            if printable_ratio < 0.8:  # Less than 80% printable characters
                return None
            
            item['title'] = title or item.get('title', 'No title')
            item['content'] = content
            
            return item
            
        except Exception:
            # Silently filter out failed items
            return None

    def search(
        self,
    ) -> List[dict]:
        """
        Perform a search using the Google or DuckDuckGo API.

        :return: A list of dictionaries.
        """

        sub_search_type = self.extra_configs.get("sub_search_type", "google")
        top_k = self.extra_configs.get("top_k", 10)
        if sub_search_type == "google":
            return self.google_search(top_k=top_k)
        elif sub_search_type == "ddg":
            ddg_search_type = self.extra_configs.get("ddg_search_type", "text")
            ddg_extra_configs = self.extra_configs.get("ddg_extra_configs", {})
            return self.duckduckgo_search(
                top_k=top_k,
                ddg_search_type=ddg_search_type,
                ddg_extra_configs=ddg_extra_configs
            )
        raise ValueError(f"Unsupported Web Search Type: {sub_search_type}!")

    @global_exception_handler(3501, "Error Searching Using Google Search")
    def google_search(
        self,
        top_k: int = 10
    ) -> List[dict]:
        """
        Perform a search using the Google Custom Search API with batch fetching.
        """
        # Google API limits: num ∈ [1,10], max 100 total results
        max_per_request = 10
        max_total_results = 100
        
        # Calculate how many batches we need
        target_raw_results = min(top_k * 2, max_total_results)  # Get 2x target for filtering
        batches_needed = (target_raw_results + max_per_request - 1) // max_per_request
        
        all_items = []
        current_start = 1
        
        for batch_num in range(batches_needed):
            # Calculate results needed for this batch
            remaining_needed = target_raw_results - len(all_items)
            if remaining_needed <= 0:
                break
                
            batch_size = min(max_per_request, remaining_needed)
            
            # Make API request for this batch
            url = "https://www.googleapis.com/customsearch/v1"
            params = {
                "q": self.query,
                "key": os.environ.get("GCP_API_KEY"),
                "cx": os.environ.get("CSE_ID"),
                "num": batch_size,
                "start": current_start
            }

            api_response = requests.get(url, params=params)
            api_response.raise_for_status()
            
            response_json = api_response.json()
            batch_items = response_json.get("items", [])
            
            if not batch_items:
                # No more results available
                break
                
            all_items.extend(batch_items)
            current_start += batch_size
            
            # Stop if we have enough or hit API limits
            if len(all_items) >= target_raw_results or current_start > max_total_results:
                break

        if not all_items:
            return []

        # Process all items with concurrent content fetching
        results = []
        with ThreadPoolExecutor(max_workers=min(len(all_items), 10)) as executor:
            future_to_item = {executor.submit(self._fetch_and_parse, item): item for item in all_items}
            for future in as_completed(future_to_item):
                result = future.result()
                if result:
                    results.append(result)
                    # Stop when we have enough high-quality results
                    if len(results) >= top_k:
                        break
        
        return results[:top_k]

    @global_exception_handler(3502, "Error Searching Using DuckDuckGo Search")
    def duckduckgo_search(
        self,
        top_k: int = 10,
        ddg_search_type: str = "text",
        ddg_extra_configs: dict = {}
    ) -> List[dict]:
        """
        Perform a search using the DuckDuckGo API.
        
        Supported Search Types:
        - text
        - answers
        - images
        - videos
        - news
        - suggestions
        - translate
        - maps
        """

        # Use if-elif instead of match for Python < 3.10 compatibility
        if ddg_search_type == "text":
            results = DDGS().text(self.query, max_results=top_k)
        elif ddg_search_type == "answers":
            results = DDGS().answers(self.query)
        elif ddg_search_type == "images":
            results = DDGS().images(self.query, max_results=top_k)
        elif ddg_search_type == "videos":
            results = DDGS().videos(self.query, max_results=top_k)
        elif ddg_search_type == "news":
            results = DDGS().news(self.query, max_results=top_k)
        elif ddg_search_type == "suggestions":
            results = DDGS().suggestions(self.query)
        elif ddg_search_type == "translate":
            results = DDGS().translate(self.query, **ddg_extra_configs)
        elif ddg_search_type == "maps":
            results = DDGS().maps(self.query, **ddg_extra_configs)
        else:
            raise ValueError(f"Unsupported Duck Duck Go Search Type: {ddg_search_type}")

        return results


if __name__ == "__main__":
    from dotenv import load_dotenv
    from Utils.puppy_exception import PuppyException
    load_dotenv()

    # Check environment variables first
    print("--- Environment Variables Check ---")
    gcp_key = os.environ.get("GCP_API_KEY")
    cse_id = os.environ.get("CSE_ID")
    print(f"GCP_API_KEY: {'✓ Set' if gcp_key else '✗ Missing'}")
    print(f"CSE_ID: {'✓ Set' if cse_id else '✗ Missing'}")
    
    if gcp_key:
        print(f"GCP_API_KEY length: {len(gcp_key)} characters")
        print(f"GCP_API_KEY starts with: {gcp_key[:10]}...")
    if cse_id:
        print(f"CSE_ID: {cse_id}")

    print("\n--- Testing Google Search with Debug Info ---")
    query = "What is the impact of climate change?"
    
    try:
        print(f"🔍 Query: {query}")
        web_search = WebSearchStrategy(query, extra_configs={"sub_search_type": "google", "top_k": 5})
        results = web_search.search()
        
        print(f"\n📊 Results Summary:")
        print(f"   Total results: {len(results)}")
        
        if results:
            for i, result in enumerate(results):
                print(f"\n   Result {i+1}:")
                print(f"     Title: {result.get('title', 'No title')[:100]}...")
                print(f"     URL: {result.get('link', 'No URL')}")
                content_len = len(result.get('content', ''))
                print(f"     Content Length: {content_len} chars")
                if content_len > 0:
                    preview = result.get('content', '')[:100]
                    print(f"     Preview: {preview}...")
        else:
            print("   ❌ No results returned")
            
    except PuppyException as e:
        print(f"❌ PuppyException occurred:")
        print(f"   Error Code: {e.error_code}")
        print(f"   Error Message: {e.error_message}")
        if e.cause:
            print(f"   Cause: {e.cause}")
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        import traceback
        print(f"   Traceback: {traceback.format_exc()}")

    print("\n--- Testing DuckDuckGo Search ---")
    try:
        extra_configs = {
            "ddg_search_type": "text",
            "top_k": 5,
            "sub_search_type": "ddg"
        }
        web_search_ddg = WebSearchStrategy(query, extra_configs)
        ddg_results = web_search_ddg.search()
        print(f"DuckDuckGo Results: {len(ddg_results)} found")
        
        if ddg_results:
            for i, result in enumerate(ddg_results[:3]):  # Show first 3
                print(f"   DDG Result {i+1}: {result.get('title', 'No title')[:80]}...")
                
    except Exception as e:
        print(f"❌ DuckDuckGo error: {e}")

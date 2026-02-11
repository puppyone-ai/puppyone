# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv
from ModularEdges.DeepResearcherEdge import DeepResearcherFactory


def test_deep_researcher():
    """Test the DeepResearcherEdge with a sample query."""
    
    # Load environment variables
    load_dotenv()
    
    # Test configuration
    init_configs = {
        "query": "What are the latest developments in renewable energy technology?"
    }
    
    extra_configs = {
        "model": "openai/gpt-5",
        "temperature": 0.1,
        "max_tokens": 10000,
        "max_iterations": 3,
        
        # Vector search configuration (optional - for searching your own documents)
        "vector_search_configs": {
            "data_source": [
                {
                    "index_item": {
                        "collection_configs": {
                            "collection_name": "renewable_energy",
                            "model": "text-embedding-ada-002",
                            "vdb_type": "pgvector",
                            "user_id": "test_user",
                            "set_name": "energy_docs",
                            "enabled": False
                        }
                    }
                }
            ],
            "top_k": 5,
            "threshold": 0.7
        },
        
        # Google search configuration
        "google_search_configs": {
            "max_results": 5,
            "filter_unreachable_pages": True,
            "disable_content_filtering": False
        },
        
        # Perplexity search configuration
        "perplexity_search_configs": {
            "model": "gpt-4o-mini"
        }
    }
    
    try:
        print("Starting DeepResearch")
        print(f"Query: {init_configs['query']}")
        print("-" * 50)
        
        result = DeepResearcherFactory.execute(init_configs, extra_configs)
        
        print("\nDeep Research Result:")
        print("=" * 50)
        print(result)
        print("=" * 50)
        
    except Exception as e:
        print(f"Error during deep research: {str(e)}")


def test_query():
    
    load_dotenv()
    
    init_configs = {
        "query": "What is the current temperature in Mohe, China? today is 2025-08-25. Use the tools you have"
    }
    
    extra_configs = {
        "model": "openai/gpt-5",
        "temperature": 0.1,
        "max_tokens": 5000,
        "max_iterations": 2,
        
        # Only web search tools
        "google_search_configs": {
            "max_results": 3
        },
        
        "perplexity_search_configs": {
            "model": "gpt-4o"
        }
    }
    
    try:
        print("Starting Simple Deep Research...")
        print(f"Query: {init_configs['query']}")
        print("-" * 50)
        
        result = DeepResearcherFactory.execute(init_configs, extra_configs)
        
        print("\nSimple Deep Research Result:")
        print("=" * 50)
        print(result)
        print("=" * 50)
        
    except Exception as e:
        print(f"Error during simple deep research: {str(e)}")


if __name__ == "__main__":
    print("Testing DeepResearcherEdge...")
    # print("=" * 60)
    
    # test_deep_researcher()
    
    # print("\n" + "=" * 60)
    
    # # Test 2: Simple query
    test_query() 
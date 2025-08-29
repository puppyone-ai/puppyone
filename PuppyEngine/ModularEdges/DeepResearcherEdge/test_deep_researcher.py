# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv
from ModularEdges.DeepResearcherEdge import DeepResearcherFactory

def test_query():
    
    load_dotenv()
    
    init_configs = {
        "query": "What is the current temperature in Mohe, China? today is 2025-08-25. Use the perplexity search tool"
    }
    
    extra_configs = {
        "model": "gpt-4o-2024-08-06",
        "temperature": 0.1,
        "max_tokens": 5000,
        "max_iterations": 2,
        
        # Only web search tools
        "google_search_configs": {
            "max_results": 3,
            "enabled": True
        },
        
        "perplexity_search_configs": {
            "model": "perplexity/sonar",
            "enabled": True
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
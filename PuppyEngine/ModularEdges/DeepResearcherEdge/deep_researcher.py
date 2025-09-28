# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import re
import json
import logging
from datetime import datetime
from typing import List, Dict, Any, Optional
from ModularEdges.EdgeFactoryBase import EdgeFactoryBase
from ModularEdges.LLMEdge.llm_chat import ChatService
from ModularEdges.SearchEdge.searcher import SearcherFactory
from Utils.puppy_exception import global_exception_handler, PuppyException

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class DeepResearcherEdge(EdgeFactoryBase):
    """
    DeepResearcherEdge implements an agentic research system that can use multiple tools
    to gather information and provide comprehensive answers to queries.
    
    Tools available:
    - vector_search: Search across multiple vector databases
    - google_search: Web search using Google
    - perplexity_search: Search using Perplexity API
    """

    def __init__(self):
        self.tool_call_pattern = r'API CALL: (\w+)\s*(.*?)(?=\n|$)'
        self.max_iterations = 5
        self.tool_results_history = []
        self.llm_interaction_log = []

    @global_exception_handler(3800, "Error Executing Deep Researcher Edge")
    def execute(
        self,
        init_configs: Dict[str, Any] = None,
        extra_configs: Dict[str, Any] = None
    ) -> str:
        """
        Execute the deep research process using an agentic approach.
        
        Args:
            init_configs: Contains the query and model configuration
            extra_configs: Contains tool configurations and settings
            
        Returns:
            str: The final comprehensive answer
        """
        if not init_configs:
            raise PuppyException(3801, "Missing init_configs")
        
        query = init_configs.get("query")
        if not query:
            raise PuppyException(3802, "Missing query in init_configs")
        
        # Get configurations
        model = extra_configs.get("model", "openai/gpt-5")
        temperature = extra_configs.get("temperature", 0.1)
        max_tokens = extra_configs.get("max_tokens", 10000)
        max_iterations = extra_configs.get("max_iterations", self.max_iterations)
        
        # Log the start of execution
        logger.info(f"🚀 [DeepResearcher] Starting research: '{query}' (model: {model}, iterations: {max_iterations})")
        
        # Initialize conversation history
        conversation_history = []
        
        # Create the initial system prompt
        system_prompt = self._create_system_prompt(extra_configs)
        conversation_history.append({"role": "system", "content": system_prompt})
        
        conversation_history.append({"role": "user", "content": query})
        
        iteration = 0
        while iteration < max_iterations:
            iteration += 1
            logger.info(f"🔄 [DeepResearcher] Iteration {iteration}/{max_iterations}")
            
            # Get LLM response
            llm_response = self._get_llm_response(
                conversation_history, model, temperature, max_tokens, iteration
            )
            
            # Check if response contains tool calls
            tool_calls = self._extract_tool_calls(llm_response)
            
            if not tool_calls:
                # No tool calls found, return the final answer
                logger.info(f"✅ [DeepResearcher] No tool calls found, returning final answer")
                return llm_response
            
            # Execute tool calls
            tool_results = []
            for i, (tool_name, tool_args) in enumerate(tool_calls):
                logger.info(f"🔧 [DeepResearcher] Executing {tool_name}: {tool_args}")
                
                try:
                    result = self._execute_tool(tool_name, tool_args, query, extra_configs)
                    tool_results.append({
                        "tool": tool_name,
                        "args": tool_args,
                        "result": result
                    })
                    logger.info(f"✅ [DeepResearcher] {tool_name} completed")
                except Exception as e:
                    error_msg = f"Error executing {tool_name}: {str(e)}"
                    tool_results.append({
                        "tool": tool_name,
                        "args": tool_args,
                        "result": error_msg
                    })
                    logger.error(f"❌ [DeepResearcher] {tool_name} failed: {str(e)}")
            
            # Add tool results to history
            self.tool_results_history.extend(tool_results)
            
            # Create context from tool results
            context = self._create_context_from_results(tool_results)
            
            # Create the follow-up prompt with tool results
            follow_up_prompt = f"Tool execution results:\n{context}\n\nPlease continue with your research or provide the final answer."
            
            # Add assistant response and context to conversation
            conversation_history.append({"role": "assistant", "content": llm_response})
            conversation_history.append({
                "role": "user", 
                "content": follow_up_prompt
            })
            
                    # Log tool execution results to interaction log
            self._log_tool_execution_to_interaction_log(iteration, tool_results, context, follow_up_prompt)
        
        # If we've reached max iterations, get final response
        logger.info(f"🏁 [DeepResearcher] Reached max iterations, getting final response")
        final_response = self._get_llm_response(
            conversation_history, model, temperature, max_tokens, "final"
        )
        
        # Log the complete interaction history
        self._log_complete_interaction_history()
        
        # Log interaction summary
        summary = self.get_interaction_summary()
        logger.info("📊 [DeepResearcher] Interaction Summary:")
        logger.info(f"📊 [DeepResearcher]   Total interactions: {summary.get('total_interactions', 0)}")
        logger.info(f"📊 [DeepResearcher]   Prompts: {summary.get('prompts_count', 0)}")
        logger.info(f"📊 [DeepResearcher]   Responses: {summary.get('responses_count', 0)}")
        logger.info(f"�� [DeepResearcher]   Tool Executions: {summary.get('tool_executions_count', 0)}")
        logger.info(f"📊 [DeepResearcher]   Total Tools Executed: {summary.get('total_tools_executed', 0)}")
        logger.info(f"📊 [DeepResearcher]   Tool Types Used: {summary.get('tool_types_used', [])}")
        logger.info(f"📊 [DeepResearcher]   Iterations: {summary.get('iterations', [])}")
        logger.info(f"📊 [DeepResearcher]   Models used: {summary.get('models_used', [])}")
        logger.info(f"📊 [DeepResearcher]   Total response length: {summary.get('total_response_length', 0)} characters")
        logger.info(f"📊 [DeepResearcher]   Average response length: {summary.get('average_response_length', 0):.1f} characters")
        
        return final_response

    def _create_system_prompt(self, extra_configs: Dict[str, Any]) -> str:
        """Create the system prompt for the LLM."""
        # Check if any vector databases are enabled
        vector_configs = extra_configs.get("vector_search_configs", {})
        data_sources = vector_configs.get("data_source", [])
        
        # Filter enabled vector databases
        enabled_vector_dbs = []
        if data_sources:
            for source in data_sources:
                index_item = source.get("index_item", {})
                collection_configs = index_item.get("collection_configs", {})
                if collection_configs.get("enabled", True):  # Default to True if not specified
                    enabled_vector_dbs.append(collection_configs.get("collection_name", "unknown"))
        
        # Build available tools list
        available_tools = []
        tool_descriptions = []
        
        # Add vector search if any databases are enabled
        if enabled_vector_dbs:
            available_tools.append("1. VECTOR_SEARCH")
            tool_descriptions.append("VECTOR_SEARCH - Search across multiple vector databases for relevant documents")
        
        # Always add web search tools
        available_tools.append("2. GOOGLE_SEARCH")
        tool_descriptions.append("GOOGLE_SEARCH - Search the web using Google for current information")
        
        available_tools.append("3. PERPLEXITY_SEARCH")
        tool_descriptions.append("PERPLEXITY_SEARCH - Search using Perplexity API for detailed answers")
        
        # Create the system prompt
        system_prompt = f"""You are an intelligent research assistant with access to multiple tools. Your goal is to provide comprehensive and accurate answers to user queries.

Available Tools:
{chr(10).join(tool_descriptions)}

Instructions:
- Analyze the user's query carefully
- If you need more information to provide a complete answer, use the available tools
- To call a tool, use the format: API CALL: TOOL_NAME [arguments]
- Examples:
  API CALL: GOOGLE_SEARCH "latest climate change data 2024"
  API CALL: PERPLEXITY_SEARCH "quantum computing applications"
"""
        
        # Add vector search example only if available
        if enabled_vector_dbs:
            system_prompt += '  API CALL: VECTOR_SEARCH "machine learning algorithms"\n'
        
        system_prompt += """- After receiving tool results, analyze them and either:
  a) Call more tools if you need additional information
  b) Provide a comprehensive final answer based on all gathered information

- Always provide well-structured, accurate, and comprehensive answers
- Cite sources when possible
"""
        
        return system_prompt

    def _get_llm_response(
        self, 
        messages: List[Dict[str, str]], 
        model: str, 
        temperature: float, 
        max_tokens: int,
        iteration: Any
    ) -> str:
        """Get response from LLM using ChatService with comprehensive logging."""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        # Log the prompt being sent
        logger.info(f"📤 [DeepResearcher] Sending prompt to LLM (Iteration: {iteration})")
        
        # Store interaction data
        interaction_data = {
            "timestamp": timestamp,
            "iteration": str(iteration),
            "type": "prompt",
            "model": model,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "messages": messages.copy()
        }
        self.llm_interaction_log.append(interaction_data)
        
        # Get API key and base URL from environment variables
        api_key = os.environ.get("OPENROUTER_API_KEY")
        base_url = os.environ.get("OPENROUTER_BASE_URL")
        
        # Log API key status (masked for security)
        if api_key:
            masked_key = f"{api_key[:8]}{'*' * (len(api_key) - 12)}{api_key[-4:]}" if len(api_key) > 12 else "***"
            logger.info(f"🔑 [DeepResearcher] Using API key: {masked_key}")
        else:
            logger.warning(f"⚠️ [DeepResearcher] No OPENROUTER_API_KEY found in environment variables")
        
        if base_url:
            logger.info(f"🌐 [DeepResearcher] Using base URL: {base_url}")
        else:
            logger.warning(f"⚠️ [DeepResearcher] No OPENROUTER_BASE_URL found in environment variables")
        
        # Get response from LLM with API credentials
        chat_service = ChatService(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            printing=False,
            api_key=api_key,           # 添加 API 密钥
            base_url=base_url,         # 添加 base URL
            is_openrouter=True         # 明确指定使用 OpenRouter
        )
        response = chat_service.chat_completion()
        
        # Log the response received
        response_timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        logger.info(f"📥 [DeepResearcher] Received response ({len(response)} chars)")
        
        # Store response data
        response_data = {
            "timestamp": response_timestamp,
            "iteration": str(iteration),
            "type": "response",
            "model": model,
            "response": response,
            "response_length": len(response)
        }
        self.llm_interaction_log.append(response_data)
        
        return response



    def _log_complete_interaction_history(self):
        """Log the complete interaction history in a structured format."""
        # Save interaction log to file
        self._save_interaction_log_to_file()

    def _save_interaction_log_to_file(self):
        """Save the interaction log to a JSON file for debugging and analysis."""
        try:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"deep_researcher_interaction_log_{timestamp}.json"
            
            # Create a clean version of the log for JSON serialization
            clean_log = []
            for interaction in self.llm_interaction_log:
                clean_interaction = interaction.copy()
                
                # Remove the messages from the JSON to keep file size manageable
                # but keep other metadata
                if "messages" in clean_interaction:
                    clean_interaction["message_count"] = len(clean_interaction["messages"])
                    del clean_interaction["messages"]
                
                # Handle tool execution data
                if clean_interaction.get("type") == "tool_execution":
                    tool_results = clean_interaction.get("tool_results", [])
                    clean_tool_results = []
                    for tool_result in tool_results:
                        clean_tool_result = {
                            "tool": tool_result.get("tool"),
                            "args": tool_result.get("args"),
                            "result_length": len(tool_result.get("result", "")),
                            "result_preview": tool_result.get("result", "")[:200] + "..." if len(tool_result.get("result", "")) > 200 else tool_result.get("result", "")
                        }
                        clean_tool_results.append(clean_tool_result)
                    clean_interaction["tool_results"] = clean_tool_results
                    clean_interaction["context_length"] = len(clean_interaction.get("context", ""))
                    clean_interaction["follow_up_prompt_length"] = len(clean_interaction.get("follow_up_prompt", ""))
                    # Remove full context and follow-up prompt to keep file size manageable
                    del clean_interaction["context"]
                    del clean_interaction["follow_up_prompt"]
                
                clean_log.append(clean_interaction)
            
            # Save to file
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(clean_log, f, indent=2, ensure_ascii=False)
            
            logger.info(f"💾 [DeepResearcher] Interaction log saved to: {filename}")
            
        except Exception as e:
            logger.error(f"❌ [DeepResearcher] Failed to save interaction log: {str(e)}")

    def get_interaction_log(self) -> List[Dict[str, Any]]:
        """Get the complete interaction log."""
        return self.llm_interaction_log.copy()

    def get_interaction_summary(self) -> Dict[str, Any]:
        """Get a summary of the interaction log."""
        if not self.llm_interaction_log:
            return {"message": "No interactions recorded"}
        
        total_interactions = len(self.llm_interaction_log)
        prompts = [i for i in self.llm_interaction_log if i.get("type") == "prompt"]
        responses = [i for i in self.llm_interaction_log if i.get("type") == "response"]
        tool_executions = [i for i in self.llm_interaction_log if i.get("type") == "tool_execution"]
        
        # Calculate tool execution statistics
        total_tools_executed = 0
        tool_types_used = set()
        for tool_exec in tool_executions:
            tool_results = tool_exec.get("tool_results", [])
            total_tools_executed += len(tool_results)
            for result in tool_results:
                tool_types_used.add(result.get("tool", "unknown"))
        
        summary = {
            "total_interactions": total_interactions,
            "prompts_count": len(prompts),
            "responses_count": len(responses),
            "tool_executions_count": len(tool_executions),
            "total_tools_executed": total_tools_executed,
            "tool_types_used": list(tool_types_used),
            "iterations": list(set([i.get("iteration", "unknown") for i in self.llm_interaction_log])),
            "models_used": list(set([i.get("model", "unknown") for i in prompts])),
            "total_response_length": sum([i.get("response_length", 0) for i in responses]),
            "average_response_length": sum([i.get("response_length", 0) for i in responses]) / len(responses) if responses else 0,
            "first_interaction": self.llm_interaction_log[0].get("timestamp") if self.llm_interaction_log else None,
            "last_interaction": self.llm_interaction_log[-1].get("timestamp") if self.llm_interaction_log else None
        }
        
        return summary

    def _extract_tool_calls(self, response: str) -> List[tuple]:
        """Extract tool calls from LLM response."""
        tool_calls = []
        matches = re.findall(self.tool_call_pattern, response, re.MULTILINE)
        
        for match in matches:
            tool_name = match[0].upper()
            tool_args = match[1].strip()
            
            # Remove surrounding quotes if they exist
            if tool_args.startswith('"') and tool_args.endswith('"'):
                tool_args = tool_args[1:-1]
            elif tool_args.startswith("'") and tool_args.endswith("'"):
                tool_args = tool_args[1:-1]
            
            tool_calls.append((tool_name, tool_args))
        
        return tool_calls

    def _execute_tool(
        self, 
        tool_name: str, 
        tool_args: str, 
        original_query: str, 
        extra_configs: Dict[str, Any]
    ) -> str:
        """Execute a specific tool based on the tool name."""
        if tool_name == "VECTOR_SEARCH":
            return self._execute_vector_search(tool_args, extra_configs)
        elif tool_name == "GOOGLE_SEARCH":
            return self._execute_google_search(tool_args, extra_configs)
        elif tool_name == "PERPLEXITY_SEARCH":
            return self._execute_perplexity_search(tool_args, extra_configs)
        else:
            return f"Unknown tool: {tool_name}"

    def _execute_vector_search(self, query: str, extra_configs: Dict[str, Any]) -> str:
        """Execute vector search across multiple enabled databases."""
        try:
            # Extract vector search configurations
            vector_configs = extra_configs.get("vector_search_configs", {})
            data_sources = vector_configs.get("data_source", [])
            
            if not data_sources:
                return "No vector databases are configured."
            
            # Filter enabled vector databases
            enabled_sources = []
            for source in data_sources:
                index_item = source.get("index_item", {})
                collection_configs = index_item.get("collection_configs", {})
                if collection_configs.get("enabled", True):  # Default to True if not specified
                    enabled_sources.append(source)
            
            if not enabled_sources:
                return "No vector databases are currently enabled."
            
            # Get common search settings for all databases
            top_k = vector_configs.get("top_k", 5)
            threshold = vector_configs.get("threshold", 0.7)
            
            # Search each enabled database
            all_results = []
            for i, source in enumerate(enabled_sources):
                collection_name = source.get("index_item", {}).get("collection_configs", {}).get("collection_name", f"database_{i}")
                
                try:
                    # Create config for this specific database using common settings
                    single_db_config = {
                        "vector_search_configs": {
                            "data_source": [source],
                            "top_k": top_k,
                            "threshold": threshold
                        }
                    }
                    
                    # Execute search for this database
                    result = SearcherFactory.execute(
                        init_configs={"query": query, "search_type": "vector"},
                        extra_configs=single_db_config
                    )
                    
                    if result:
                        # Add database identifier to results
                        if isinstance(result, list):
                            for item in result:
                                if isinstance(item, dict):
                                    item["source_database"] = collection_name
                                else:
                                    item = {"content": str(item), "source_database": collection_name}
                        else:
                            result = {"content": str(result), "source_database": collection_name}
                        
                        all_results.append({
                            "database": collection_name,
                            "results": result
                        })
                        

                        
                except Exception as e:
                    logger.error(f"❌ [DeepResearcher] Error searching database {collection_name}: {str(e)}")
                    all_results.append({
                        "database": collection_name,
                        "results": f"Error searching database: {str(e)}"
                    })
            
            # Combine all results
            if not all_results:
                return "No results found from any vector database."
            
            # Format combined results
            combined_results = []
            for db_result in all_results:
                database_name = db_result["database"]
                results = db_result["results"]
                
                combined_results.append(f"--- Results from {database_name} ---")
                
                if isinstance(results, list):
                    for j, item in enumerate(results):
                        if isinstance(item, dict):
                            content = item.get("content", str(item))
                        else:
                            content = str(item)
                        combined_results.append(f"{j+1}. {content}")
                else:
                    combined_results.append(str(results))
                
                combined_results.append("")  # Empty line for separation
            
            final_result = "\n".join(combined_results)
            return final_result
            
        except Exception as e:
            error_msg = f"Vector search error: {str(e)}"
            logger.error(f"❌ [DeepResearcher] {error_msg}")
            return error_msg

    def _execute_google_search(self, query: str, extra_configs: Dict[str, Any]) -> str:
        """Execute Google search using WebSearchStrategy."""
        try:
            from ModularEdges.SearchEdge.web_search import WebSearchStrategy
            
            # Get Google search configurations from extra_configs
            google_search_configs = extra_configs.get("google_search_configs", {})
            
            # Use configurable search type, default to google_v2 if not specified
            sub_search_type = google_search_configs.get("sub_search_type", "google_v2")
            
            # Use configurable top_k, default to 3 if not specified
            top_k = google_search_configs.get("top_k", 3)
            
            google_configs = {
                "sub_search_type": sub_search_type,
                "top_k": top_k,
                "firecrawl_config": {
                    "formats": ["markdown"],
                    "is_only_main_content": True,
                    "wait_for": 60
                }
            }
            
            # Merge any additional Google configs from extra_configs
            if "firecrawl_config" in google_search_configs:
                google_configs["firecrawl_config"].update(google_search_configs["firecrawl_config"])

            logger.info(f"🔍 [DeepResearcher] Google search (top_k: {top_k})")
            
            # Create WebSearchStrategy instance directly
            web_searcher = WebSearchStrategy(
                query=query,
                extra_configs=google_configs
            )
            
            # Execute the search
            result = web_searcher.search()
            
            if isinstance(result, list):
                # Format the results nicely
                formatted_results = []
                for i, item in enumerate(result, 1):
                    title = item.get("title", "No title")
                    link = item.get("link", "No link")
                    content = item.get("content", "No content")
                    formatted_results.append(f"{i}. {title}\n   URL: {link}\n   Content: {content}\n")
                return "\n".join(formatted_results)
            else:
                return str(result)
        except Exception as e:
            logger.error(f"❌ [DeepResearcher] Google search error: {str(e)}")
            return f"Google search error: {str(e)}"

    def _execute_perplexity_search(self, query: str, extra_configs: Dict[str, Any]) -> str:
        """Execute Perplexity search."""
        try:
            perplexity_configs = extra_configs.get("perplexity_search_configs", {})
            perplexity_configs["sub_search_type"] = "perplexity"
            
            result = SearcherFactory.execute(
                init_configs={"query": query, "search_type": "qa"},
                extra_configs=perplexity_configs
            )
            
            if isinstance(result, list):
                return "\n".join([str(item) for item in result])
            else:
                return str(result)
        except Exception as e:
            return f"Perplexity search error: {str(e)}"

    def _create_context_from_results(self, tool_results: List[Dict[str, Any]]) -> str:
        """Create context string from tool execution results."""
        context_parts = []
        
        for result in tool_results:
            tool_name = result["tool"]
            tool_args = result["args"]
            tool_result = result["result"]
            
            context_parts.append(f"Tool: {tool_name}")
            context_parts.append(f"Arguments: {tool_args}")
            context_parts.append(f"Result: {tool_result}")
            context_parts.append("-" * 50)
        
        return "\n".join(context_parts)

    def _log_tool_execution_to_interaction_log(self, iteration: int, tool_results: List[Dict[str, Any]], context: str, follow_up_prompt: str):
        """Log tool execution results to the interaction log."""
        tool_execution_data = {
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "iteration": str(iteration),
            "type": "tool_execution",
            "tool_results": tool_results,
            "context": context,
            "follow_up_prompt": follow_up_prompt
        }
        self.llm_interaction_log.append(tool_execution_data)


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    
    # Example usage
    deep_researcher = DeepResearcherEdge()
    
    init_configs = {
        "query": "What are the latest developments in quantum computing?"
    }
    
    extra_configs = {
        "model": "gpt-4o-2024-08-06",
        "temperature": 0.1,
        "max_tokens": 10000,
        "max_iterations": 3,
        "vector_search_configs": {
            "data_source": [
                {
                    "index_item": {
                        "collection_configs": {
                            "collection_name": "research_papers",
                            "model": "text-embedding-ada-002",
                            "vdb_type": "pgvector",
                            "user_id": "research_user",
                            "set_name": "academic_papers",
                            "description": "Academic research papers and scientific publications",
                            "enabled": True  
                        }
                    }
                },
                {
                    "index_item": {
                        "collection_configs": {
                            "collection_name": "news_articles",
                            "model": "text-embedding-ada-002",
                            "vdb_type": "chroma",
                            "user_id": "research_user",
                            "set_name": "current_news",
                            "description": "Recent news articles and current events",
                            "enabled": True  
                        }
                    }
                },
                {
                    "index_item": {
                        "collection_configs": {
                            "collection_name": "technical_docs",
                            "model": "text-embedding-ada-002",
                            "vdb_type": "pinecone",
                            "user_id": "research_user",
                            "set_name": "technical_documentation",
                            "description": "Technical documentation and manuals",
                            "enabled": False 
                        }
                    }
                }
            ],
            "top_k": 5,
            "threshold": 0.7
        },
        "google_search_configs": {
            "enabled": True,
            "top_k": 5,  # Configurable number of results
            "filter_unreachable_pages": True,
            "firecrawl_config": {
                "formats": ["markdown"],
                "is_only_main_content": True,
                "wait_for": 60
            }
        },
        "perplexity_search_configs": {
            "enabled": True,
            "model": "perplexity/sonar"
        }
    }
    
    print("🚀 Starting Deep Research with comprehensive logging...")
    result = deep_researcher.execute(init_configs, extra_configs)
    
    print("\n" + "="*80)
    print("📋 FINAL RESULT:")
    print("="*80)
    print(result)
    
    print("\n" + "="*80)
    print("📊 INTERACTION SUMMARY:")
    print("="*80)
    summary = deep_researcher.get_interaction_summary()
    for key, value in summary.items():
        print(f"  {key}: {value}")
    
    print("\n" + "="*80)
    print("💾 INTERACTION LOG ACCESS:")
    print("="*80)
    print("You can access the complete interaction log using:")
    print("  interaction_log = deep_researcher.get_interaction_log()")
    print("  summary = deep_researcher.get_interaction_summary()")
    print("The interaction log has also been saved to a JSON file for analysis.") 
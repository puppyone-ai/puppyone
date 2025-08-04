import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import logging
from typing import Any, Dict, List
from ModularEdges.SearchEdge.search_strategy import SearchStrategy
from ModularEdges.SearchEdge.vector_search import VectorRetrievalStrategy
from ModularEdges.SearchEdge.web_search import WebSearchStrategy
from ModularEdges.SearchEdge.qa_search import LLMQASearchStrategy
from ModularEdges.LLMEdge.llm_edge import remote_llm_chat
from Utils.puppy_exception import global_exception_handler

# Configure logging for deep research
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class DeepResearchStrategy(SearchStrategy):
    """Deep Research Edge: Iterative, multi-source research and reasoning pipeline."""

    def __init__(self, query: str, extra_configs: dict = None):
        super().__init__(query, extra_configs)
        self.max_rounds = extra_configs.get("max_rounds", 3)
        self.llm_model = extra_configs.get("llm_model", "gpt-4o")
        self.vector_config = extra_configs.get("vector_config", {})
        self.web_config = extra_configs.get("web_config", {})
        self.perplexity_config = extra_configs.get("perplexity_config", {})
        
        logger.info(f"🔍 [DeepResearch] Initialized: '{query}' (rounds: {self.max_rounds}, model: {self.llm_model})")

    @global_exception_handler(3901, "Error Executing Deep Research Edge")
    def search(self) -> Dict[str, Any]:
        logger.info(f"🚀 [DeepResearch] Starting execution")
        
        query = self.query
        round_count = 0
        accumulated_context = []
        answer = None
        
        while round_count < self.max_rounds:
            round_count += 1
            logger.info(f"🔄 [DeepResearch] Round {round_count}/{self.max_rounds}: '{query}'")
            
            # 1. Rewrite for vector search
            try:
                vector_prompt = self._rewrite_with_llm(query, "vector")
            except Exception as e:
                logger.error(f"❌ [DeepResearch] Vector rewrite failed: {e}")
                vector_prompt = query
            
            # Execute vector search (optional)
            try:
                # Check if vector search is configured and enabled
                data_sources = self.vector_config.get("data_source", [])
                vector_enabled = self.vector_config.get("enabled", True)  # Default to True for backward compatibility
                
                if not vector_enabled or not data_sources:
                    vector_results = []
                else:
                    vector_results = VectorRetrievalStrategy(
                        query=vector_prompt,
                        extra_configs=self.vector_config,
                        documents=self.vector_config.get("documents"),
                        top_k=self.vector_config.get("top_k", 5),
                        threshold=self.vector_config.get("threshold", 0.5)
                    ).search()
                    logger.info(f"✅ [DeepResearch] Vector: {len(vector_results)} results")
            except Exception as e:
                logger.error(f"❌ [DeepResearch] Vector search failed: {e}")
                vector_results = []

            # 2. Rewrite for Google search
            google_prompt = self._rewrite_with_llm(query, "google")
            
            # Execute Google search
            try:
                web_config = self.web_config.copy()
                web_config["sub_search_type"] = "google"
                web_config["top_k"] = self.web_config.get("top_k", 5)
                # Temporarily disable content filtering for deep research
                web_config["disable_content_filtering"] = True
                web_config["disable_quality_filtering"] = True
                web_results = WebSearchStrategy(google_prompt, web_config).search()
                logger.info(f"✅ [DeepResearch] Google: {len(web_results)} results")
            except Exception as e:
                logger.error(f"❌ [DeepResearch] Google search failed: {e}")
                web_results = []

            # 3. Rewrite for Perplexity 
            # perplexity_prompt = self._rewrite_with_llm(query, "perplexity")
            
            # Execute Perplexity search 
            # try:
            #     perplexity_results = LLMQASearchStrategy(perplexity_prompt, self.perplexity_config).search()
            #     logger.info(f"✅ [DeepResearch] Perplexity: {len(perplexity_results)} results")
            # except Exception as e:
            #     logger.error(f"❌ [DeepResearch] Perplexity search failed: {e}")
            #     perplexity_results = []
            
            perplexity_results = []
            logger.info(f"⚠️ [DeepResearch] Perplexity search temporarily disabled")

            # Gather current round results
            current_round_context = self._gather_context(vector_results, web_results, perplexity_results)
            logger.info(f"📊 [DeepResearch] Current round context: {len(current_round_context)} sources")
            
            # Accumulate context from all rounds
            accumulated_context.extend(current_round_context)
            logger.info(f"📊 [DeepResearch] Accumulated context: {len(accumulated_context)} total sources")

            # Ask LLM if context is enough
            force_answer = (round_count == self.max_rounds)
            
            try:
                llm_response = self._llm_check_context(query, accumulated_context, force_answer=force_answer)
                
                if llm_response.get("type") == "answer":
                    answer = llm_response["content"]
                    logger.info(f"✅ [DeepResearch] Answer generated")
                    break
                elif llm_response.get("type") == "query":
                    query = llm_response["content"]
                    logger.info(f"🔄 [DeepResearch] Refining query")
                    round_count += 1
                else:
                    # Fallback: force answer if unknown
                    answer = llm_response.get("content", "No answer generated.")
                    logger.warning(f"⚠️ [DeepResearch] Unknown response type")
                    break
            except Exception as e:
                logger.error(f"❌ [DeepResearch] LLM evaluation failed: {e}")
                answer = f"Error during LLM evaluation: {str(e)}"
                break
        
        logger.info(f"🏁 [DeepResearch] Completed ({round_count} rounds)")
        
        result = {
            "answer": answer, 
            "context": accumulated_context, 
            "rounds": round_count,
            "original_query": self.query,
            "final_query": query
        }
        
        logger.info(f"🏁 [DeepResearch] Returning result: {result}")
        return result

    def _rewrite_with_llm(self, query: str, target: str) -> str:
        """Rewrite query using hardcoded prompts with LLM chat."""
        logger.info(f"📝 [DeepResearch] Rewriting query for {target} using LLM")
        
        # Define hardcoded prompts for different search targets
        if target == "vector":
            system_prompt = """You are a semantic search optimization expert. Your task is to rewrite the given query to be more effective for vector/semantic search.

Consider the following when rewriting:
1. Use more descriptive and contextual terms
2. Include synonyms and related concepts
3. Make the query more comprehensive to capture relevant semantic matches
4. Consider what type of documents would contain the answer
5. Include both broad and specific terms

Example:
Original: "machine learning"
Rewritten: "artificial intelligence machine learning algorithms neural networks deep learning"

Return only the rewritten query, nothing else."""
            
        elif target == "google":
            system_prompt = """You are a search query optimization expert. Your task is to rewrite the given query to be more effective for Google search.

Consider the following when rewriting:
1. Add relevant keywords that Google users typically search for
2. Include specific terms that might appear in authoritative sources
3. Make the query more specific and actionable
4. Consider what type of content would best answer this query
5. Include current year or time-sensitive terms if relevant

Example:
Original: "climate change effects"
Rewritten: "climate change effects 2024 global warming impact environment"

Return only the rewritten query, nothing else."""
            
        elif target == "perplexity":
            system_prompt = """You are a research query optimization expert. Your task is to rewrite the given query to be more effective for Perplexity AI search.

Consider the following when rewriting:
1. Make the query more specific and research-oriented
2. Include academic or technical terms that would appear in research papers
3. Add context that helps Perplexity understand the depth of information needed
4. Consider what type of sources would provide the best answer
5. Include terms that indicate you want comprehensive, well-researched information

Example:
Original: "AI in healthcare"
Rewritten: "artificial intelligence applications in healthcare 2024 medical technology innovations research studies"

Return only the rewritten query, nothing else."""
            
        else:
            # Fallback for unknown targets
            system_prompt = """You are a search query optimization expert. Rewrite the given query to be more effective for web search.

Make the query more specific, include relevant keywords, and consider what type of content would best answer the question.

Return only the rewritten query, nothing else."""
        
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": query}
        ]
        
        try:
            # Convert model string to dict format expected by remote_llm_chat
            model_config = {self.llm_model: {}}
            
            response = remote_llm_chat(
                messages=messages,
                model=model_config,
                temperature=0.3,
                max_tokens=512,
                printing=False,
                stream=False
            )
            
            rewritten_query = response.strip()
            logger.info(f"📝 [DeepResearch] Query rewritten for {target}: '{rewritten_query}'")
            return rewritten_query
            
        except Exception as e:
            logger.error(f"❌ [DeepResearch] Failed to rewrite query for {target}: {e}")
            # Fallback to simple rewrite
            if target == "vector":
                rewritten = f"{query} semantic search"
            elif target == "google":
                rewritten = f"{query} 2024"
            elif target == "perplexity":
                rewritten = f"{query} research comprehensive"
            else:
                rewritten = query
            
            logger.info(f"📝 [DeepResearch] Using fallback rewrite for {target}: '{rewritten}'")
            return rewritten

    def _gather_context(self, vector_results, web_results, perplexity_results) -> List[Any]:
        logger.info(f"📊 [DeepResearch] Gathering context from all sources")
        context = []
        
        if vector_results:
            logger.info(f"📊 [DeepResearch] Adding {len(vector_results)} vector results")
            context.append({"vector": vector_results})
        
        if web_results:
            logger.info(f"📊 [DeepResearch] Adding {len(web_results)} web results")
            context.append({"google": web_results})
        
        if perplexity_results:
            logger.info(f"📊 [DeepResearch] Adding {len(perplexity_results)} perplexity results")
            context.append({"perplexity": perplexity_results})
        
        logger.info(f"📊 [DeepResearch] Total context sources: {len(context)}")
        return context

    def _llm_check_context(self, original_query: str, context: List[Any], force_answer: bool = False) -> Dict[str, str]:
        logger.info(f"🤖 [DeepResearch] Checking context sufficiency with LLM")
        logger.info(f"🤖 [DeepResearch] Force answer: {force_answer}")
        
        system_prompt = """You are a research assistant. Given the following context, evaluate if you can provide a comprehensive answer to the user's question.

IMPORTANT: You must respond in exactly one of these two formats:

1. If you have sufficient information to answer the question thoroughly, respond with:
   "answer: [your comprehensive answer]"

2. If you need more specific information or the context is insufficient, respond with:
   "query: [a refined, more specific search query]"

Consider the following when evaluating:
1. Does the context directly address the question?
2. Is the information current and relevant?
3. Are there gaps that need to be filled?
4. Would additional searches help provide a better answer?

Be specific in your refined queries if you need more information.

CRITICAL: Your response must start with either "answer:" or "query:" followed by your content."""

        user_prompt = f"""Original question: {original_query}

Context from searches:
{context}

{'You must provide an answer now (final round).' if force_answer else 'Evaluate if this context is sufficient to answer the question.'}

Please respond with either:
- "answer: [your answer]" if you can provide a comprehensive answer
- "query: [refined search query]" if you need more information"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
        
        logger.info(f"🤖 [DeepResearch] Sending prompt to LLM (model: {self.llm_model})")
        logger.debug(f"🤖 [DeepResearch] Messages: {messages}")
        
        try:
            # Convert model string to dict format expected by remote_llm_chat
            model_config = {self.llm_model: {}}
            
            response = remote_llm_chat(
                messages=messages,
                model=model_config,
                temperature=0.3,
                max_tokens=1024,
                printing=False,
                stream=False
            )
            
            logger.info(f"🤖 [DeepResearch] LLM response received: {response[:200]}...")
            
            # Parse the response
            response_lower = response.lower().strip()
            logger.info(f"🤖 [DeepResearch] Raw response: {response}")
            
            # Check for answer format
            if force_answer or response_lower.startswith("answer:"):
                answer_content = response.replace("answer:", "").strip()
                logger.info(f"🤖 [DeepResearch] Parsed as answer: {answer_content[:100]}...")
                return {"type": "answer", "content": answer_content}
            elif response_lower.startswith("query:"):
                query_content = response.replace("query:", "").strip()
                logger.info(f"🤖 [DeepResearch] Parsed as refined query: {query_content}")
                return {"type": "query", "content": query_content}
            # Check for variations in format
            elif "answer:" in response_lower:
                # Find the answer part after "answer:"
                answer_start = response_lower.find("answer:")
                answer_content = response[answer_start + 7:].strip()
                logger.info(f"🤖 [DeepResearch] Parsed as answer (found in text): {answer_content[:100]}...")
                return {"type": "answer", "content": answer_content}
            elif "query:" in response_lower:
                # Find the query part after "query:"
                query_start = response_lower.find("query:")
                query_content = response[query_start + 6:].strip()
                logger.info(f"🤖 [DeepResearch] Parsed as refined query (found in text): {query_content}")
                return {"type": "query", "content": query_content}
            else:
                logger.warning(f"⚠️ [DeepResearch] Could not parse response format, treating as answer")
                logger.warning(f"⚠️ [DeepResearch] Response was: {response}")
                return {"type": "answer", "content": response.strip()}
                
        except Exception as e:
            logger.error(f"❌ [DeepResearch] LLM call failed: {e}")
            return {"type": "answer", "content": f"Error during LLM evaluation: {str(e)}"} 
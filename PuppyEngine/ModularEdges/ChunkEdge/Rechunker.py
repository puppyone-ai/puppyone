# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import os
import uuid
from typing import List, Dict, Optional
from ModularEdges.LLMEdge.generate import lite_llm_chat
from ModularEdges.ChunkEdge.base_chunk import BaseChunk
from Utils.PuppyEngineExceptions import global_exception_handler


class ReChunker(BaseChunk):
    def __init__(
        self,
        documents: str
    ):
        super().__init__(documents)
        self.chunks = {}
        self.id_truncate_limit = 5
        self.generate_new_metadata = True

    def _call_llm_api(
        self,
        prompt: list,
        model: str = "gpt-4o"
    ) -> str:
        response = lite_llm_chat(
            messages=prompt,
            model=model,
            temperature=0.7,
            max_tokens=4096,
            printing=True,
            stream=True
        )
        return response

    @global_exception_handler(3111, "Error Adding Propositions")
    def add_propositions(
        self,
        propositions: List[str]
    ):
        for proposition in propositions:
            if not self.chunks:
                self._create_new_chunk(proposition)
            else:
                chunk_id = self._find_relevant_chunk(proposition)
                if chunk_id:
                    self._add_proposition_to_chunk(chunk_id, proposition)
                else:
                    self._create_new_chunk(proposition)

    def _add_proposition_to_chunk(
        self,
        chunk_id: str,
        proposition: str
    ):
        self.chunks[chunk_id]["propositions"].append(proposition)
        if self.generate_new_metadata:
            self.chunks[chunk_id]["summary"] = self._generate_summary(self.chunks[chunk_id])
            self.chunks[chunk_id]["title"] = self._generate_title(self.chunks[chunk_id])

    def _generate_summary(
        self,
        chunk: Dict
    ) -> str:
        sys_prompt = """
You are the steward of a group of chunks which represent groups of sentences that talk about a similar topic
A new proposition was just added to one of your chunks, you should generate a very brief 1-sentence summary which will inform viewers what a chunk group is about.

A good summary will say what the chunk is about, and give any clarifying instructions on what to add to the chunk.

You will be given a group of propositions which are in the chunk and the chunks current summary.

Your summaries should anticipate generalization. If you get a proposition about apples, generalize it to food.
Or month, generalize it to "date and times".

Example:
Input: Proposition: Greg likes to eat pizza
Output: This chunk contains information about the types of food Greg likes to eat.

Only respond with the chunk new summary, nothing else.
"""
        user_prompt = f"Chunk's propositions:\n{'; '.join(chunk['propositions'])}\n\nCurrent chunk summary:\n{chunk['summary']}"
        prompt = [
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": user_prompt}
        ]
        return self._call_llm_api(prompt)

    def _generate_title(
        self,
        chunk: Dict
    ) -> str:
        sys_prompt = """
You are the steward of a group of chunks which represent groups of sentences that talk about a similar topic
A new proposition was just added to one of your chunks, you should generate a very brief updated chunk title which will inform viewers what a chunk group is about.

A good title will say what the chunk is about.

You will be given a group of propositions which are in the chunk, chunk summary and the chunk title.

Your title should anticipate generalization. If you get a proposition about apples, generalize it to food.
Or month, generalize it to "date and times".

Example:
Input: Summary: This chunk is about dates and times that the author talks about
Output: Date & Times

Only respond with the new chunk title, nothing else.
"""
        user_prompt = f"Chunk's propositions:\n{'; '.join(chunk['propositions'])}\n\nCurrent chunk summary:\n{chunk['summary']}\n\nCurrent chunk title:\n{chunk['title']}"
        prompt = [
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": user_prompt}
        ]
        return self._call_llm_api(prompt)

    def _create_new_chunk(
        self,
        proposition: str
    ):
        new_chunk_id = str(uuid.uuid4())[:self.id_truncate_limit]
        new_chunk_summary = ""
        new_chunk_title = ""

        # Construct the new chunk
        self.chunks[new_chunk_id] = {
            "chunk_id": new_chunk_id,
            "propositions": [proposition],
            "title": new_chunk_title,
            "summary": new_chunk_summary,
            "chunk_index": len(self.chunks)
        }

        # Generate the summary and title of the chunk
        self.chunks[new_chunk_id]["summary"] = self._generate_summary(self.chunks[new_chunk_id])
        self.chunks[new_chunk_id]["title"] = self._generate_title(self.chunks[new_chunk_id])

    def _find_relevant_chunk(
        self,
        proposition: str
    ) -> Optional[str]:
        sys_prompt = """
Determine whether or not the "Proposition" should belong to any of the existing chunks.

A proposition should belong to a chunk of their meaning, direction, or intention are similar.
The goal is to group similar propositions and chunks.

If you think a proposition should be joined with a chunk, return the chunk id.
If you do not think an item should be joined with an existing chunk, just return "No chunks"

Example:
Input:
    - Proposition: "Greg really likes hamburgers"
    - Current Chunks:
        - Chunk ID: 2n4l3d
        - Chunk Name: Places in San Francisco
        - Chunk Summary: Overview of the things to do with San Francisco Places

        - Chunk ID: 93833k
        - Chunk Name: Food Greg likes
        - Chunk Summary: Lists of the food and dishes that Greg likes
Output: 93833k
"""
        user_prompt = f"""
Current Chunks:
--Start of current chunks--
{self._get_chunk_overview()}
--End of current chunks--
Determine if the following statement should belong to one of the chunks outlined:
{proposition}

Output:
        """
        prompt = [
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": user_prompt}
        ]
        response = self._call_llm_api(prompt)
        if response != "No chunks":
            return response.split(":")[1].strip() if ":" in response else response
        return None

    def _get_chunk_overview(
        self
    ) -> str:
        return "; ".join([f"ID: {chunk['chunk_id']}, Title: {chunk['title']}, Summary: {chunk['summary']}"
                          for chunk in self.chunks.values()])

    @global_exception_handler(3112, "Error Getting Chunks")
    def chunk(
        self,
        as_list: bool = False
    ) -> List[str]:
        if as_list:
            return [" ".join(chunk['propositions']) for chunk in self.chunks.values()]
        return self.chunks


if __name__ == "__main__":
    # Load environment variables
    from dotenv import load_dotenv
    load_dotenv()

    propositions = [
        "The month is October.",
        "The year is 2023.",
        "One of the most important things that I didn't understand about the world as a child was the degree to which the returns for performance are superlinear.",
        "Teachers and coaches implicitly told us that the returns were linear.",
        "I heard a thousand times that 'You get out what you put in'.",
    ]
    ac = ReChunker(propositions)
    ac.add_propositions(propositions)
    print(ac.chunk(as_list=True))

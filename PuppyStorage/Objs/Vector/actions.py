# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import uuid
from typing import List, Dict, Any
from DataClass.Chunk import Chunk
from Objs.Vector.Embedder import TextEmbedder
from Objs.Vector.Vdb.vector_db_factory import VectorDatabaseFactory
from Utils.PuppyEngineExceptions import global_exception_handler


if __name__ == "__main__":
    import os
    import sys
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from dotenv import load_dotenv
    load_dotenv()

    query = "What did the fox do?"
    documents = [
        "The quick brown fox jumps over the lazy dog.",
        "A fast brown animal jumps over a sleepy canine.",
        "The sky is blue and the sun is bright.",
        "Blue skies and bright sunshine are beautiful.",
        "The dog is sleeping under the tree."
    ]
    create_new = True
    metadatas = [
        {"id": str(i), "extra": "metadata"}
        for i in range(len(documents))
    ]
    user_id = "test_user"
    vdb_type = "pinecone"
    model = "text-embedding-ada-002"

    collection_name = embedding(
        chunks=documents,
        model=model,
        vdb_type=vdb_type,
        create_new=create_new,
        metadatas=metadatas,
        user_id=user_id
    )
    print(f"Collection Name: {collection_name}")

    search_results = embedding_search(
        query=query,
        collection_name=collection_name,
        vdb_type=vdb_type,
        top_k=3,
        threshold=0.2,
        model=model
    )
    print("Search Results:", search_results)

    delete_collection(vdb_type=vdb_type, collection_name=collection_name)
    print("Index deleted successfully.")

# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import uuid
from typing import List, Dict, Any
from DataClass.Chunk import Chunk
from Objs.Vector.Embedder import TextEmbedding
from Objs.Vector.Vdb.vector_db_factory import VectorDatabaseFactory
from Utils.PuppyEngineExceptions import global_exception_handler


@global_exception_handler(3007, "Unexpected Error in Embedding Edge Execution")
def embedding(
    chunks: List[str],
    model: str,
    vdb_type: str,
    create_new: bool,
    metadatas: List[Dict[str, Any]],
) -> Dict[str, Any]:
    embedder = TextEmbedding(model_name=model)
    chunks_contents = [
        chunk.content if isinstance(chunk, Chunk) else
        chunk["content"] if isinstance(chunk, dict) else
        chunk if isinstance(chunk, str) else
        ValueError("Invalid chunk type.")
        for chunk in chunks
    ]

    # Embed the chunks
    embeddings = embedder.embed(chunks_contents)

    # Store the embeddings

    collection_name = str(uuid.uuid4())

    vdb = VectorDatabaseFactory.get_database(db_type=vdb_type)
    vdb.register_collection(collection_name)

    vdb.store_vectors(
        collection_name=collection_name,
        embeddings=embeddings,
        documents=chunks_contents,
        create_new=create_new,
        metadatas=metadatas
    )

    return collection_name

@global_exception_handler(3013, "Unexpected Error in Deleting Embedding from Vector Database")
def delete_collection(
    vdb_type: str,
    collection_name: str,
) -> None:
    db = VectorDatabaseFactory.get_database(db_type=vdb_type)
    db.register_collection(collection_name)
    db.delete_index(collection_name)

@global_exception_handler(3014, "Unexpected Error in Searching Embeddings from Vector Database")
def embedding_search(
    query: str,
    collection_name: str,
    vdb_type: str = "pgvector",
    top_k: int = 5,
    threshold: float = None,
    model: str = "text-embedding-ada-002",
    **kwargs
) -> List[Dict[str, Any]]:
    embedder = TextEmbedding(model_name=model)
    query_embedding = embedder.embed([query])[0]

    db = VectorDatabaseFactory.get_database(db_type=vdb_type)
    db.register_collection(collection_name=collection_name)
    matched_results = db.search_embeddings(
        collection_name=collection_name,
        query_embedding=query_embedding,
        top_k=top_k,
        **kwargs
    )

    if threshold:
        matched_results = [
            match for match in matched_results
            if match["score"] >= threshold
        ]

    return matched_results


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

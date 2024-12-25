# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import uuid
from typing import List, Dict, Any
from DataClass.Chunk import Chunk
from Scripts.Embedder import TextEmbedding
from Scripts.VectorDatabase import VectorDatabaseFactory
from Utils.PuppyEngineExceptions import global_exception_handler


@global_exception_handler(3007, "Unexpected Error in Embedding Edge Execution")
def embedding(
    chunks: List[str],
    model_name: str,
    vdb_configs: Dict[str, Any],
    metadata: Dict[str, Any],
    user_id: str
) -> Dict[str, Any]:
    embedder = TextEmbedding(model_name=model_name)
    chunks_contents = [
        chunk.content if isinstance(chunk, Chunk) else
        chunk["content"] if isinstance(chunk, dict) else
        chunk if isinstance(chunk, str) else
        ValueError("Invalid chunk type.")
        for chunk in chunks
    ]

    embeddings = embedder.get_embeddings(chunks_contents)

    # Store the embeddings
    db = VectorDatabaseFactory.get_database(
        db_type=vdb_configs.get("vdb_type", "pgvector")
    )
    db.connect(vdb_configs.get("collection_name", ""))

    collection_name = user_id + "_" + str(uuid.uuid4())
    db.save_embeddings(
        collection_name=collection_name,
        embeddings=embeddings,
        documents=chunks_contents,
        ids=metadata.get("ids", []),
        create_new=vdb_configs.get("create_new", False),
    )

    return collection_name

@global_exception_handler(3013, "Unexpected Error in Deleting Embedding from Vector Database")
def delete_index(
    vdb_configs: Dict[str, Any],
    collection_name: str,
) :
    db = VectorDatabaseFactory.get_database(
        db_type=vdb_configs.get("vdb_type", "pgvector")
    )
    db.connect(collection_name)
    db.delete_index(collection_name)


import os
import vecs
from utils.logger import log_info, log_error
from utils.config import config


def delete_all_postgres_collections():
    # Connect to the database
    database_uri = config.get("SUPABASE_URL")
    v = vecs.create_client(database_uri)

    # Retrieve all collections
    collections = v.list_collections()
    log_info(f"Found {len(collections)} collections to delete.")

    # Delete each collection
    for collection in collections:
        # Ensure collection is a string
        collection_name = collection.name
        v.delete_collection(collection_name)
        log_info(f"Deleted collection: {collection_name}")


if __name__ == "__main__":
    delete_all_postgres_collections()

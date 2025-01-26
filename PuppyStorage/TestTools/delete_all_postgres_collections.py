import os
import vecs
import logging
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO)


def delete_all_postgres_collections():
    # Connect to the database
    database_uri = os.environ.get("SUPABASE_URL")
    v = vecs.create_client(database_uri)

    # Retrieve all collections
    collections = v.list_collections()
    logging.info(f"Found {len(collections)} collections to delete.")

    # Delete each collection
    for collection in collections:
        # Ensure collection is a string
        collection_name = collection.name
        v.delete_collection(collection_name)
        logging.info(f"Deleted collection: {collection_name}")


if __name__ == "__main__":
    delete_all_postgres_collections()

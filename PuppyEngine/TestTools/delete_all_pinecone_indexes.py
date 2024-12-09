from pinecone import Pinecone

pc = Pinecone(api_key="80983012-cb24-4126-aa07-60fdc7d18ea4")

indexes = pc.list_indexes().names()

# Check if there are any indexes to delete
if indexes:
    print(f"Found indexes: {indexes}")
    # Loop through each index and delete it
    for index_name in indexes:
        print(f"Deleting index: {index_name}")
        pc.delete_index(index_name)
    print("All indexes have been deleted.")
else:
    print("No indexes found.")

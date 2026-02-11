from pinecone import Pinecone

# Initialize Pinecone client using the new API style
client = Pinecone(api_key="80983012-cb24-4126-aa07-60fdc7d18ea4")

# Connect to the Pinecone index
index_name = client.list_indexes().names()[0]
index = client.Index(index_name)

# Define the range of IDs to retrieve metadata for
ids = [str(i) for i in range(11)]  # IDs from 0 to 10

# Fetch metadata for the given IDs
response = index.fetch(ids=ids)

# Extract and print metadata
metadata = {id_: response['vectors'][id_]['metadata'] for id_ in response['vectors'] if 'metadata' in response['vectors'][id_]}
print("Metadata for IDs 0 to 10:")
for id_, data in metadata.items():
    print(f"ID: {id_}, Metadata: {data}")

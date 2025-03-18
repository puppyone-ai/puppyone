from abc import ABC, abstractmethod

class EntitySpace(Space):
    db = CloudFlareR2()

    @property
    def db(self):
        return self.db.get_or_create_bucket(name=self.model_name)

    @abstractmethod
    def search(self):
        return self.db.search(query=query, metadata=metadata)

    @abstractmethod
    def store(self):
        return self.db.store(entity=entity)



class LantentSpace(Space):

    model_name: str

    def __init__(self):
        self.model_name = model_name # model of latent space
        self.embedder = Embedder(model_name=self.model_name) # projector from entity space to latent space
        self.dimension = self.embedder.dimension # dimension of latent space

        
        #local memory
        sely.entity = [
            {
                "id": "xyz987",
                "value": "10th, Downing Twon Street", 
                "type": "text", 
                "vector": [0.1, 0.2, 0.3],
                "metadata":{
                    "document": "10th, Downing Twon Street",
                    "workspace_id": "123", 
                    "block_id": "456", 
                    "key":".address[1]" 
                    "tags":["personal", "address"],
                    }
            }
        ]

        #or database   
         
        self.vdb = PostgresVectorDatabase()
        self.gvdb = None # graph of space

    
    @property
    def db(self):
        return self.vdb.get_or_create_collection(name=self.model_name)


    @abstractmethod
    def search(self, entity:Entity):
        self.db.search(query=enti,ty.value, metadata=entity.metadata)
        self.entity_space.search(query=entity.value, metadata=entity.metadata)

    @abstractmethod
    def store(self, entity: Entity):

        self.db.upsert(
            id=entity.id or uuid.uuid4(), 
            vector=self.embedder.embed(entity.value),
            metadata=entity.metadata
        )



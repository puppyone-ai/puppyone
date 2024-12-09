## Backend Notes
### Logics
1. The server calls the `json_parser.py` to parse the json data send from the frontend and execute the edges step by step.
2. The parser first find the beginning block, and forming a new beginning block before the actual beginning block to handle multiple beginning block cases, due to the thread safety considerations in multi-threading.
3. There will be multiple threads, each handle one connected edges by the current block.
4. The program will then analyze the edge configuration dict and handle cases where the input value come from previous block's output value. 
5. Also handle the case for 'self-loop', split a list into a loop of executions for each element, by splitting the edge into several ones, copy the configurations but use different data (each list elements) to execute.
6. The chunks are in types of self-defined datatype `Chunk`, so will store the chunks by converting them into normal list of strings and the `Chunk` type is not serializable in JSON when send back to the frontend.
7. The program then converts the parsed edges into `Edge` objects and then execute the edge.
8. In the `Edges/edges.py` file, edges are defined in different methods by extracting the configurations as parameters, then initialize an class instance for the specific edge type and then execute the edge logic.
9. The executed result will be passed to the json_parser and saved into separate files.
10. The results will be updated into the block data and yield to the server.

**Note**:
One block can be connected with multiple edges, and they will be executed concurrently, that's why the yield data is a list of dicts (a list of blocks) rather than one result. 

### Testing
1. The `developer.md`, `index.md`, and `tutorial.md` files are used for testing json parser, not part of the backend, can be removed later on.
2. The `Blocks/testfiles` and `Blocks/savedfiles` folders contain files for testing `FileLoader`, not part of the backend, can be removed later on.
3. The `Results` and `FaissIndexes` folders store the result data when executing the pipeline. For tracking all the intermediate values and can be accessible from frontend code, those files are not deleted. However, can open the commanded-out codes (line 86 and 87) in the `Server/json_parer.py` to clear all the files in those folders all in once.


## TODOs
1. [x] Test the database clients connection and methods in the `Blocks/Database.py`.
2. [x] Implement the AWS Vector Database client for in the `Blocks/VectorDatabase.py`.
3. [ ] Implement the partition search based on the vector embedding ids for each vector database client.
4. [ ] Improve the LLM Prompts in the `Edges/QueryRewriter.py`.
5. [ ] Improve the chunking methods in the `Edges/Chunker.py`.


## Run Frontend
### **Install all Dependencies**
```bash
cd PuppyAgent-Engine/PuppyFlow
npm install
```

### **Run the Frontend**
```bash
npm run dev
```


## Run Backend
### **Install all Dependencies**
1. **创建虚拟环境**：
```bash
cd PuppyAgent-Engine
python -m venv myenv
```

2. **激活虚拟环境**：
- **在 Windows 上**：
```bash
myenv\Scripts\activate
```
   - **在 macOS 和 Linux 上**：
```bash
source myenv/bin/activate
```

3. **用pip安装依赖**：
```bash
pip install -r ./PuppyEngine/requirements.txt
```

### 1. **Run the JSON Parser for RAG Pipeline Testing**
```bash
python ./PuppyEngine/Server/json_parser.py
```

### 2. **Run the Server**
```bash
python ./PuppyEngine/Server/flask_server.py
```

### 3. **Run the Server Tester**
```bash
python ./PuppyEngine/Server/server_tester.py
```


## Run the backend in Docker
### 1. **Build the Docker Image**
```bash
docker build -t puppyengine-backend .
```

### 2. **Run the Docker Container**
```bash
docker run -p 8000:8000 puppyengine-backend
```

- The server is then started in `http://localhost:8000`

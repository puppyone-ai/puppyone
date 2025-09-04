"""
流式JSON处理器
支持将大型结构化数据分割成独立的JSON对象流（JSONL格式）
"""

import json
import os
from typing import Iterator, Dict, Any, List, Optional, Union
from io import StringIO
import asyncio


class StreamingJSONHandler:
    """
    处理流式JSON数据，确保每个chunk都是valid JSON
    支持两种模式：
    1. JSONL (JSON Lines): 每行一个完整的JSON对象
    2. JSON Array Streaming: 流式传输数组元素
    """
    
    def __init__(self, mode: str = "jsonl"):
        """
        Args:
            mode: "jsonl" 或 "array"
        """
        self.mode = mode
        self.buffer = StringIO()
        self.chunk_size = int(os.getenv("STORAGE_CHUNK_SIZE", "1024"))  # Configurable chunk size
        
    def split_to_jsonl(self, data: Union[List[Dict], Iterator[Dict]]) -> Iterator[bytes]:
        """
        将数据流转换为JSONL格式的chunks
        每个chunk包含完整的JSON对象，不会在对象中间断开
        
        Args:
            data: 可迭代的字典对象
            
        Yields:
            包含完整JSON行的字节块
        """
        current_chunk = StringIO()
        current_size = 0
        
        for item in data:
            # 将单个对象转换为JSON行
            json_line = json.dumps(item, ensure_ascii=False) + '\n'
            line_bytes = json_line.encode('utf-8')
            line_size = len(line_bytes)
            
            # 如果单个对象就超过chunk大小，单独作为一个chunk
            if line_size > self.chunk_size:
                if current_size > 0:
                    # 先yield当前chunk
                    yield current_chunk.getvalue().encode('utf-8')
                    current_chunk = StringIO()
                    current_size = 0
                # 单独yield这个大对象
                yield line_bytes
            else:
                # 检查是否需要开始新的chunk
                if current_size + line_size > self.chunk_size and current_size > 0:
                    yield current_chunk.getvalue().encode('utf-8')
                    current_chunk = StringIO()
                    current_size = 0
                
                # 添加到当前chunk
                current_chunk.write(json_line)
                current_size += line_size
        
        # yield最后的chunk
        if current_size > 0:
            yield current_chunk.getvalue().encode('utf-8')
    
    def split_array_streaming(self, data: List[Dict]) -> Iterator[bytes]:
        """
        流式传输JSON数组，每个chunk包含数组的一部分元素
        格式：第一个chunk: [{"item":1},
              中间chunks: {"item":2},{"item":3},
              最后chunk: {"item":4}]
        """
        total_items = len(data)
        
        for i, item in enumerate(data):
            json_str = json.dumps(item, ensure_ascii=False)
            
            if i == 0:
                # 第一个元素，包含开始的 [
                yield f'[{json_str}'.encode('utf-8')
            elif i == total_items - 1:
                # 最后一个元素，包含结束的 ]
                yield f',{json_str}]'.encode('utf-8')
            else:
                # 中间元素
                yield f',{json_str}'.encode('utf-8')
    
    def parse_jsonl_chunk(self, chunk: bytes) -> List[Dict]:
        """
        解析JSONL格式的chunk
        
        Args:
            chunk: JSONL格式的字节数据
            
        Returns:
            解析出的JSON对象列表
        """
        objects = []
        text = chunk.decode('utf-8')
        
        for line in text.strip().split('\n'):
            if line.strip():
                try:
                    obj = json.loads(line)
                    objects.append(obj)
                except json.JSONDecodeError as e:
                    print(f"Warning: Failed to parse line: {line[:50]}... Error: {e}")
        
        return objects
    
    def create_streaming_aggregator(self):
        """
        创建一个流式聚合器，用于在消费端重建完整数据
        """
        return StreamingJSONAggregator()


class StreamingJSONAggregator:
    """
    在消费端聚合流式JSON数据
    """
    
    def __init__(self):
        self.objects = []
        self.array_buffer = ""
        self.is_first_chunk = True
        self.is_complete = False
    
    def add_jsonl_chunk(self, chunk: bytes) -> List[Dict]:
        """
        添加JSONL格式的chunk并返回新解析的对象
        """
        new_objects = []
        text = chunk.decode('utf-8')
        
        for line in text.strip().split('\n'):
            if line.strip():
                try:
                    obj = json.loads(line)
                    self.objects.append(obj)
                    new_objects.append(obj)
                except json.JSONDecodeError:
                    pass
        
        return new_objects
    
    def add_array_chunk(self, chunk: bytes) -> Optional[List[Dict]]:
        """
        添加数组格式的chunk
        只有在接收到完整数组后才返回结果
        """
        text = chunk.decode('utf-8')
        self.array_buffer += text
        
        # 检查是否是完整的JSON数组
        if self.array_buffer.strip().endswith(']'):
            try:
                self.objects = json.loads(self.array_buffer)
                self.is_complete = True
                return self.objects
            except json.JSONDecodeError:
                pass
        
        return None
    
    def get_all_objects(self) -> List[Dict]:
        """获取所有已解析的对象"""
        return self.objects


class StructuredDataProducer:
    """
    结构化数据生产者示例
    """
    
    def __init__(self, storage_client):
        self.storage_client = storage_client
        self.json_handler = StreamingJSONHandler(mode="jsonl")
    
    async def stream_large_dataset(self, data_generator: Iterator[Dict], 
                                  user_id: str, block_id: str, version_id: str):
        """
        流式上传大型数据集
        
        Args:
            data_generator: 生成数据的迭代器
            user_id, block_id, version_id: 存储标识
        """
        chunk_num = 0
        
        # 使用JSONL格式分割数据
        async for chunk_data in self._async_chunk_generator(data_generator):
            chunk_num += 1
            chunk_name = f"data_chunk_{chunk_num:04d}.jsonl"
            chunk_key = f"{user_id}/{block_id}/{version_id}/{chunk_name}"
            
            # 上传chunk
            await self.storage_client.upload_chunk(chunk_key, chunk_data)
            
            # 更新manifest
            await self.storage_client.update_manifest_with_chunk(
                user_id, block_id, version_id,
                chunk_name, len(chunk_data)
            )
            
            print(f"Uploaded chunk {chunk_num}: {len(chunk_data)} bytes")
    
    async def _async_chunk_generator(self, data_generator):
        """将同步生成器转换为异步生成器"""
        for chunk in self.json_handler.split_to_jsonl(data_generator):
            yield chunk
            await asyncio.sleep(0)  # 让出控制权


class StructuredDataConsumer:
    """
    结构化数据消费者示例
    """
    
    def __init__(self, storage_client):
        self.storage_client = storage_client
        self.aggregator = StreamingJSONAggregator()
    
    async def consume_streaming_data(self, manifest_key: str, 
                                   process_callback=None):
        """
        消费流式数据
        
        Args:
            manifest_key: manifest文件的key
            process_callback: 处理新数据的回调函数
        """
        processed_chunks = set()
        
        while True:
            # 获取最新的manifest
            manifest = await self.storage_client.get_manifest(manifest_key)
            
            # 处理新的chunks
            for chunk_info in manifest.get('chunks', []):
                if chunk_info['name'] not in processed_chunks:
                    # 下载chunk
                    chunk_data = await self.storage_client.download_chunk(
                        f"{manifest_key.rsplit('/', 1)[0]}/{chunk_info['name']}"
                    )
                    
                    # 解析JSONL数据
                    new_objects = self.aggregator.add_jsonl_chunk(chunk_data)
                    
                    # 处理新数据
                    if process_callback and new_objects:
                        await process_callback(new_objects)
                    
                    processed_chunks.add(chunk_info['name'])
                    print(f"Processed {len(new_objects)} objects from {chunk_info['name']}")
            
            # 检查是否完成
            if manifest.get('status') == 'completed':
                break
            
            await asyncio.sleep(1)
        
        return self.aggregator.get_all_objects()


# 使用示例
async def example_usage():
    """
    演示如何使用流式JSON处理
    """
    
    # 模拟大型数据生成器
    def generate_large_dataset():
        """生成大量结构化数据"""
        for i in range(10000):
            yield {
                "id": i,
                "type": "record",
                "data": {
                    "name": f"Item {i}",
                    "description": f"This is a detailed description for item {i}" * 10,
                    "metadata": {
                        "created_at": "2024-01-01T00:00:00Z",
                        "tags": [f"tag{j}" for j in range(10)],
                        "properties": {f"prop{k}": f"value{k}" for k in range(20)}
                    }
                },
                "nested": {
                    "level1": {
                        "level2": {
                            "level3": {
                                "value": f"Deep nested value {i}"
                            }
                        }
                    }
                }
            }
    
    # 生产者端
    handler = StreamingJSONHandler()
    chunks = list(handler.split_to_jsonl(generate_large_dataset()))
    
    print(f"Generated {len(chunks)} chunks")
    for i, chunk in enumerate(chunks[:3]):  # 只显示前3个chunk
        print(f"\nChunk {i+1} preview:")
        print(f"Size: {len(chunk)} bytes")
        lines = chunk.decode('utf-8').strip().split('\n')
        print(f"Objects: {len(lines)}")
        if lines:
            first_obj = json.loads(lines[0])
            print(f"First object ID: {first_obj['id']}")
    
    # 消费者端
    print("\n--- Consumer Side ---")
    aggregator = StreamingJSONAggregator()
    
    for i, chunk in enumerate(chunks[:3]):
        new_objects = aggregator.add_jsonl_chunk(chunk)
        print(f"Chunk {i+1}: Parsed {len(new_objects)} new objects")
    
    print(f"\nTotal objects received: {len(aggregator.get_all_objects())}")


if __name__ == "__main__":
    asyncio.run(example_usage())
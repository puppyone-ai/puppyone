"""
JSON serialization utilities for the Engine Server
"""

import json
import re
from datetime import datetime, date

def json_serializer(obj):
    """
    Custom JSON serializer for handling objects that default json encoder cannot process.
    
    Handles:
    - datetime and date objects -> ISO format string
    - objects with isoformat() method -> calls that method
    - pandas.Timestamp objects -> ISO format string
    - any other non-serializable objects -> string representation
    
    Args:
        obj: The object to serialize
        
    Returns:
        A JSON-serializable version of the object
    """
    import pandas as pd
    
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if hasattr(obj, 'isoformat'):
        return obj.isoformat()
    if pd and hasattr(pd, 'Timestamp') and isinstance(obj, pd.Timestamp):
        return obj.isoformat()
    # Handle other types that might not be JSON serializable
    return str(obj)

def safe_json_serialize(data):
    """
    安全的JSON序列化，处理大文本内容和特殊字符
    
    Args:
        data: 要序列化的数据
        
    Returns:
        str: 安全的JSON字符串
    """
    try:
        # 深拷贝数据以避免修改原始数据
        import copy
        safe_data = copy.deepcopy(data)
        
        # 递归处理数据结构，清理内容
        safe_data = _clean_data_for_serialization(safe_data)
        
        # 使用自定义序列化器进行JSON序列化
        json_str = json.dumps(safe_data, default=json_serializer, ensure_ascii=False)
        
        # 验证生成的JSON是否有效
        json.loads(json_str)
        
        return json_str
        
    except Exception as e:
        # 如果序列化失败，返回一个安全的错误消息
        error_data = {
            "error": "JSON serialization failed",
            "message": str(e),
            "data_type": str(type(data))
        }
        return json.dumps(error_data, default=json_serializer)

def _clean_data_for_serialization(obj):
    """
    递归清理数据结构，处理字符串内容
    """
    if isinstance(obj, dict):
        cleaned = {}
        for key, value in obj.items():
            cleaned[key] = _clean_data_for_serialization(value)
        return cleaned
    elif isinstance(obj, list):
        return [_clean_data_for_serialization(item) for item in obj]
    elif isinstance(obj, str):
        return _clean_string_content(obj)
    else:
        return obj

def _clean_string_content(content):
    """
    清理字符串内容，处理特殊字符
    """
    if not isinstance(content, str):
        return content
    
    # 处理特殊字符
    # 移除或转义可能导致JSON解析问题的字符
    content = content.replace('\x00', '')  # 移除null字符
    content = content.replace('\b', '\\b')  # 转义退格符
    content = content.replace('\f', '\\f')  # 转义换页符
    content = content.replace('\r', '\\r')  # 转义回车符
    content = content.replace('\t', '\\t')  # 转义制表符
    
    # 处理Unicode控制字符
    content = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', content)
    
    return content 
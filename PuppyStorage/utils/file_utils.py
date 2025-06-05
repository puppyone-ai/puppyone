"""
文件处理工具模块
提供文件名编码、路径处理等公共功能
"""

from urllib.parse import quote


def build_content_disposition_header(filename: str) -> str:
    """
    构建符合RFC 6266标准的Content-Disposition头
    处理中文文件名编码问题，确保最大兼容性
    
    Args:
        filename: 原始文件名
        
    Returns:
        符合标准的Content-Disposition头字符串
        
    Examples:
        >>> build_content_disposition_header("document.pdf")
        'attachment; filename=document.pdf'
        
        >>> build_content_disposition_header("中文文档.pdf")
        'attachment; filename*=UTF-8\'\'%E4%B8%AD%E6%96%87%E6%96%87%E6%A1%A3.pdf'
    """
    try:
        # 尝试ASCII编码，如果成功说明是纯ASCII字符
        filename.encode('ascii')
        return f"attachment; filename={filename}"
    except UnicodeEncodeError:
        # 包含非ASCII字符，使用RFC 6266的filename*格式
        encoded_filename = quote(filename.encode('utf-8'))
        return f"attachment; filename*=UTF-8''{encoded_filename}"


def extract_filename_from_key(key: str) -> str:
    """
    从存储key中提取文件名
    
    Args:
        key: 存储key，格式为 {user_id}/{content_id}/{filename}
        
    Returns:
        提取的文件名
        
    Examples:
        >>> extract_filename_from_key("user123/abc456/document.pdf")
        'document.pdf'
    """
    import os
    return os.path.basename(key)


def validate_filename(filename: str) -> bool:
    """
    验证文件名是否有效
    
    Args:
        filename: 要验证的文件名
        
    Returns:
        文件名是否有效
    """
    if not filename or not filename.strip():
        return False
        
    # 检查是否包含非法字符
    illegal_chars = ['<', '>', ':', '"', '|', '?', '*']
    if any(char in filename for char in illegal_chars):
        return False
        
    # 检查是否为保留名称（Windows）
    reserved_names = [
        'CON', 'PRN', 'AUX', 'NUL',
        'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
        'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
    ]
    if filename.upper().split('.')[0] in reserved_names:
        return False
        
    return True 
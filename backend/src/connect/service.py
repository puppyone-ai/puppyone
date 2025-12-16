"""
Connect 服务层
负责数据导入的业务逻辑
"""

from typing import Dict, Any, Optional, List
from src.connect.parser import UrlParser
from src.connect.schemas import ParseUrlResponse, DataField
from src.connect.providers.notion_provider import NotionProvider
from src.oauth.notion_service import NotionOAuthService
from src.exceptions import BusinessException, ErrorCode
from src.utils.logger import log_info, log_error


class ConnectService:
    """Connect 服务类"""

    def __init__(self, parser: UrlParser, user_id: Optional[str] = None):
        """
        初始化 Connect 服务

        Args:
            parser: URL 解析器
            user_id: 用户ID，用于获取OAuth tokens
        """
        self.parser = parser
        self.user_id = user_id

        # 注册数据提供者
        self._register_providers()

    def _register_providers(self):
        """注册数据提供者"""
        if self.user_id:
            # 注册 Notion provider（需要用户ID）
            log_info(f"Registering NotionProvider for user_id: {self.user_id}")
            notion_service = NotionOAuthService()
            notion_provider = NotionProvider(self.user_id, notion_service)
            self.parser.register_provider(notion_provider)
            log_info(f"NotionProvider registered successfully, total providers: {len(self.parser.providers)}")
        else:
            log_warning("Cannot register NotionProvider: user_id is None")
    
    async def parse_url(self, url: str) -> ParseUrlResponse:
        """
        解析 URL 并返回数据预览
        
        Args:
            url: 要解析的 URL
            
        Returns:
            ParseUrlResponse: 解析结果
            
        Raises:
            BusinessException: 解析失败时抛出
        """
        try:
            log_info(f"Parsing URL: {url}")
            
            # 使用解析器获取数据
            result = await self.parser.parse(url)
            
            # 提取数据
            data = result.get("data", [])
            source_type = result.get("source_type", "generic")
            title = result.get("title", "")
            
            # 分析数据结构
            fields = self._analyze_fields(data)
            sample_data = data[:5] if isinstance(data, list) else []
            total_items = len(data) if isinstance(data, list) else 0
            data_structure = "list" if isinstance(data, list) else "dict"
            
            response = ParseUrlResponse(
                url=url,
                source_type=source_type,
                title=title,
                fields=fields,
                sample_data=sample_data,
                total_items=total_items,
                data_structure=data_structure,
            )
            
            log_info(f"Successfully parsed URL: {url}, found {total_items} items")
            return response
            
        except Exception as e:
            log_error(f"Failed to parse URL {url}: {e}")
            raise BusinessException(
                message=f"解析URL失败: {str(e)}",
                code=ErrorCode.BAD_REQUEST
            )
    
    def _analyze_fields(self, data: Any) -> List[DataField]:
        """
        分析数据中的字段
        
        Args:
            data: 要分析的数据
            
        Returns:
            字段列表
        """
        fields = []
        
        if isinstance(data, list) and len(data) > 0:
            # 从第一条数据中提取字段
            first_item = data[0]
            if isinstance(first_item, dict):
                for key, value in first_item.items():
                    field_type = type(value).__name__
                    fields.append(DataField(
                        name=key,
                        type=field_type,
                        sample_value=value
                    ))
        elif isinstance(data, dict):
            # 直接从字典中提取字段
            for key, value in data.items():
                field_type = type(value).__name__
                fields.append(DataField(
                    name=key,
                    type=field_type,
                    sample_value=value
                ))
        
        return fields
    
    async def fetch_full_data(self, url: str) -> Dict[str, Any]:
        """
        获取完整数据用于导入
        
        Args:
            url: 数据源 URL
            
        Returns:
            完整数据
        """
        try:
            log_info(f"Fetching full data from URL: {url}")
            result = await self.parser.parse(url)
            return result
        except Exception as e:
            log_error(f"Failed to fetch full data from {url}: {e}")
            raise BusinessException(
                message=f"获取数据失败: {str(e)}",
                code=ErrorCode.BAD_REQUEST
            )


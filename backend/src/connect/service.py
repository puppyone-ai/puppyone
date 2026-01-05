"""
Connect 服务层
负责数据导入的业务逻辑
"""

import copy
import time
from typing import Dict, Any, Optional, List, Union
from src.connect.parser import UrlParser
from src.connect.schemas import ParseUrlResponse, DataField
from src.connect.providers.notion_provider import NotionProvider
from src.oauth.notion_service import NotionOAuthService
from src.oauth.github_service import GithubOAuthService
from src.oauth.google_sheets_service import GoogleSheetsOAuthService
from src.oauth.linear_service import LinearOAuthService
from src.oauth.airtable_service import AirtableOAuthService
from src.connect.providers.github_provider import GithubProvider
from src.connect.providers.google_sheets_provider import GoogleSheetsProvider
from src.connect.providers.linear_provider import LinearProvider
from src.connect.providers.airtable_provider import AirtableProvider
from src.exceptions import BusinessException, ErrorCode
from src.utils.logger import log_info, log_error, log_warning


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
        if not self.user_id:
            log_warning("Cannot register providers: user_id is None")
            return

        log_info(f"Registering providers for user_id: {self.user_id}")

        notion_service = NotionOAuthService()
        notion_provider = NotionProvider(self.user_id, notion_service)
        self.parser.register_provider(notion_provider)
        log_info("NotionProvider registered")

        github_service = GithubOAuthService()
        github_provider = GithubProvider(self.user_id, github_service)
        self.parser.register_provider(github_provider)
        log_info("GithubProvider registered")

        google_sheets_service = GoogleSheetsOAuthService()
        google_sheets_provider = GoogleSheetsProvider(self.user_id, google_sheets_service)
        self.parser.register_provider(google_sheets_provider)
        log_info("GoogleSheetsProvider registered")

        linear_service = LinearOAuthService()
        linear_provider = LinearProvider(self.user_id, linear_service)
        self.parser.register_provider(linear_provider)
        log_info("LinearProvider registered")

        airtable_service = AirtableOAuthService()
        airtable_provider = AirtableProvider(self.user_id, airtable_service)
        self.parser.register_provider(airtable_provider)
        log_info("AirtableProvider registered")
    
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
                message=f"Failed to parse URL: {str(e)}", code=ErrorCode.BAD_REQUEST
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
                    fields.append(
                        DataField(name=key, type=field_type, sample_value=value)
                    )
        elif isinstance(data, dict):
            # 直接从字典中提取字段
            for key, value in data.items():
                field_type = type(value).__name__
                fields.append(DataField(name=key, type=field_type, sample_value=value))

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
                message=f"Failed to fetch data: {str(e)}", code=ErrorCode.BAD_REQUEST
            )

    def merge_data_at_path(
        self,
        original_data: Union[Dict[str, Any], List[Any]],
        import_data: Any,
        path: str,
        strategy: str = "smart",
    ) -> Union[Dict[str, Any], List[Any]]:
        """
        将导入数据合并到指定路径

        Args:
            original_data: 原始JSON数据
            import_data: 要导入的数据
            path: 目标路径，如 '/users/0/profile' 或空字符串表示根节点
            strategy: 合并策略 - smart/replace/merge_object/append_array

        Returns:
            合并后的JSON数据

        Raises:
            BusinessException: 合并失败时抛出
        """
        try:
            log_info(f"Merging data at path: {path} with strategy: {strategy}")

            # 深拷贝原始数据，避免修改原对象
            result = copy.deepcopy(original_data)

            # 根节点特殊处理
            if not path or path == "/":
                log_info("Merging at root level")
                return self._merge_values(result, import_data, strategy)

            # 解析路径
            parts = [p for p in path.split("/") if p]

            # 导航到父节点
            current = result
            for i, part in enumerate(parts[:-1]):
                # 尝试将part转换为整数（数组索引）
                try:
                    index = int(part)
                    if not isinstance(current, list):
                        raise BusinessException(
                            f"Path error: '{'/'.join(parts[: i + 1])}' is not an array",
                            code=ErrorCode.BAD_REQUEST,
                        )
                    if index < 0 or index >= len(current):
                        raise BusinessException(
                            f"Array index out of bounds: {index}",
                            code=ErrorCode.BAD_REQUEST,
                        )
                    current = current[index]
                except ValueError:
                    # 不是数字，作为对象的key
                    if not isinstance(current, dict):
                        raise BusinessException(
                            f"Path error: '{'/'.join(parts[: i + 1])}' is not an object",
                            code=ErrorCode.BAD_REQUEST,
                        )
                    if part not in current:
                        raise BusinessException(
                            f"Path does not exist: '{'/'.join(parts[: i + 1])}'",
                            code=ErrorCode.BAD_REQUEST,
                        )
                    current = current[part]

            # 获取最后一个key
            last_key = parts[-1]

            # 尝试将最后一个key转换为整数
            try:
                last_index = int(last_key)
                if not isinstance(current, list):
                    raise BusinessException(
                        "Path error: target is not an array", code=ErrorCode.BAD_REQUEST
                    )
                if last_index < 0 or last_index >= len(current):
                    raise BusinessException(
                        f"Array index out of bounds: {last_index}",
                        code=ErrorCode.BAD_REQUEST,
                    )
                # 合并到数组元素
                current[last_index] = self._merge_values(
                    current[last_index], import_data, strategy
                )
            except ValueError:
                # 不是数字，作为对象的key
                if not isinstance(current, dict):
                    raise BusinessException(
                        "Path error: target is not an object",
                        code=ErrorCode.BAD_REQUEST,
                    )
                # 合并到对象字段
                current_value = current.get(last_key)
                current[last_key] = self._merge_values(
                    current_value, import_data, strategy
                )

            log_info(f"Successfully merged data at path: {path}")
            return result

        except BusinessException:
            raise
        except Exception as e:
            log_error(f"Failed to merge data at path {path}: {e}")
            raise BusinessException(
                message=f"Failed to merge data: {str(e)}", code=ErrorCode.INTERNAL_ERROR
            )

    def _merge_values(
        self, current_value: Any, import_value: Any, strategy: str
    ) -> Any:
        """
        根据策略合并两个值

        Args:
            current_value: 当前值
            import_value: 要导入的值
            strategy: 合并策略

        Returns:
            合并后的值
        """
        if strategy == "replace":
            # 直接替换
            return import_value

        elif strategy == "merge_object":
            # 对象字段合并
            if isinstance(current_value, dict) and isinstance(import_value, dict):
                result = copy.deepcopy(current_value)
                result.update(import_value)
                return result
            else:
                # 如果类型不匹配，直接替换
                log_warning("merge_object: type mismatch, replacing instead")
                return import_value

        elif strategy == "append_array":
            # 数组追加
            if isinstance(current_value, list):
                result = copy.deepcopy(current_value)
                if isinstance(import_value, list):
                    result.extend(import_value)
                else:
                    result.append(import_value)
                return result
            else:
                # 如果当前不是数组，直接替换
                log_warning(
                    "append_array: current value is not array, replacing instead"
                )
                return import_value

        elif strategy == "smart":
            # 智能合并
            # 1. 如果当前值是null/None，直接替换
            if current_value is None:
                return import_value

            # 2. 如果当前值是对象且导入值也是对象，合并字段
            if isinstance(current_value, dict) and isinstance(import_value, dict):
                result = copy.deepcopy(current_value)
                result.update(import_value)
                return result

            # 3. 如果当前值是数组，追加导入值
            if isinstance(current_value, list):
                result = copy.deepcopy(current_value)
                if isinstance(import_value, list):
                    result.extend(import_value)
                else:
                    result.append(import_value)
                return result

            # 4. 其他情况（原始类型），直接替换
            return import_value

        else:
            log_warning(f"Unknown merge strategy: {strategy}, using replace")
            return import_value

    def foolproof_import(
        self, original_data: Any, import_data: Any, mode: str = "add_to_existing"
    ) -> Any:
        """
        100%成功的傻瓜式导入，处理所有边界情况

        Args:
            original_data: 原始数据（可以是任何类型）
            import_data: 要导入的数据
            mode: 导入模式
                - "add_to_existing": 添加到现有数据（推荐）
                - "replace_all": 替换全部数据
                - "keep_separate": 作为独立导入保存

        Returns:
            合并后的数据（保证成功）
        """
        try:
            log_info(f"Foolproof import with mode: {mode}")

            if mode == "replace_all":
                # 模式2: 直接替换 - 总是成功
                log_info("Mode: replace_all - replacing all data")
                return import_data

            elif mode == "add_to_existing":
                # 模式1: 添加到现有 - 智能处理所有类型
                log_info("Mode: add_to_existing - smart merging")

                if original_data is None:
                    # 情况1: 当前是null
                    log_info("Current data is null, using import data")
                    return import_data

                elif isinstance(original_data, list):
                    # 情况2: 当前是数组
                    log_info(f"Current is array ({len(original_data)} items)")
                    result = copy.deepcopy(original_data)

                    if isinstance(import_data, list):
                        # 导入数据也是数组，合并
                        log_info(
                            f"Import is also array ({len(import_data)} items), extending"
                        )
                        result.extend(import_data)
                    else:
                        # 导入数据不是数组，追加为单个元素
                        log_info("Import is not array, appending as single item")
                        result.append(import_data)

                    log_info(f"Result array has {len(result)} items")
                    return result

                elif isinstance(original_data, dict):
                    # 情况3: 当前是对象
                    log_info(f"Current is object ({len(original_data)} fields)")
                    result = copy.deepcopy(original_data)

                    if isinstance(import_data, dict):
                        # 导入数据也是对象，合并字段
                        new_fields = [k for k in import_data.keys() if k not in result]
                        updated_fields = [k for k in import_data.keys() if k in result]
                        log_info(
                            f"Import is object: {len(new_fields)} new fields, {len(updated_fields)} updated"
                        )
                        result.update(import_data)
                    else:
                        # 导入数据不是对象，作为新字段添加
                        timestamp = int(time.time() * 1000)
                        field_name = f"imported_{timestamp}"
                        log_info(f"Import is not object, adding as field: {field_name}")
                        result[field_name] = import_data

                    log_info(f"Result object has {len(result)} fields")
                    return result

                else:
                    # 情况4: 当前是原始类型 (string/number/boolean)
                    log_info(
                        f"Current is primitive type: {type(original_data).__name__}"
                    )
                    log_info("Converting to object structure")
                    return {"original": original_data, "imported": import_data}

            elif mode == "keep_separate":
                # 模式3: 独立保存 - 总是成功
                log_info("Mode: keep_separate - storing in imports section")

                # 确保数据是对象结构
                if not isinstance(original_data, dict):
                    log_info(
                        f"Current is not object ({type(original_data).__name__}), restructuring"
                    )
                    original_data = {"data": original_data}

                result = copy.deepcopy(original_data)

                # 确保有imports容器
                if "imports" not in result:
                    log_info("Creating 'imports' container")
                    result["imports"] = {}

                # 生成唯一key
                timestamp = int(time.time() * 1000)
                counter = 0
                key = f"import_{timestamp}"

                # 处理极端情况：同毫秒多次导入
                while key in result["imports"]:
                    counter += 1
                    key = f"import_{timestamp}_{counter}"
                    log_warning(f"Key collision, using: {key}")

                result["imports"][key] = import_data
                log_info(f"Stored in imports.{key}")
                return result

            else:
                log_error(f"Unknown import mode: {mode}")
                raise BusinessException(
                    message=f"Unknown import mode: {mode}", code=ErrorCode.BAD_REQUEST
                )

        except Exception as e:
            log_error(f"Foolproof import failed unexpectedly: {e}")
            raise BusinessException(
                message=f"Import failed: {str(e)}", code=ErrorCode.INTERNAL_ERROR
            )

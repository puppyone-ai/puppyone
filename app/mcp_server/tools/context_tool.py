from typing import Literal, List, Dict, Any, Optional
from app.service.project_table_service import get_project_table_service
from app.utils.logger import log_error

tool_types = Literal["create", "update", "delete", "get"]
tool_descriptions = {
    "create": "创建元素",
    "update": "更新元素",
    "delete": "删除元素",
    "get": "获取元素",
}

class ContextTool:
    """
    用户知识库管理工具类
    """
    
    def generate_tool_description(
        self, 
        project_name: str, 
        table_name: str, 
        tool_type: tool_types,
        project_description: Optional[str] = None,
        project_metadata: Optional[Dict[str, Any]] = None,
        table_description: Optional[str] = None,
        table_metadata: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        生成工具描述
        
        Args:
            project_name: 项目名称
            context_name: 知识库名称
            tool_type: 工具类型（create/update/delete/get）
            project_description: 项目描述
            project_metadata: 项目元数据
            context_description: 知识库描述
            context_metadata: 知识库元数据
        
        Returns:
            详细的工具描述字符串，用于大语言模型理解工具用途和使用方式
        """
        # 构建项目基础描述
        project_name_str = f'知识库所属项目名称："{project_name}"'
        project_description_str = ""
        project_metadata_str = ""
        if project_description:
            project_description_str = f'该项目的描述为：{project_description}'
        if project_metadata:
            project_metadata_str = f'该项目其他信息包括：{project_metadata}'
        
        # 构建表基础描述
        table_info = f'表名称："{table_name}"; '
        if table_description:
            table_info += f' 表描述：{table_description};'
        if table_metadata:
            table_info += f' 表其他信息：{table_metadata} '
        
        base_description = f"""这是一个用于管理知识库的工具。知识库本质上是一个JSON对象，以键值对（key-value）的形式存储数据。知识库的信息如下：

{project_name_str}; {project_description_str}; {project_metadata_str}

{table_info}

重要提示：知识库是一个JSON对象结构，其中：
- key（键）：字符串类型，用于唯一标识数据项
- value（值）：可以是任意JSON类型（对象、数组、字符串、数字、布尔值等）

使用流程：
1. 首次使用建议通过 get_context(schema="1") 工具获取知识库的结构。
2. 在了解现有数据结构后，才能进行创建、更新或删除操作
3. 所有操作都是基于key（键）来定位和操作数据项"""
        
        descriptions = {
            "get": f"""{base_description}

功能：获取知识库的内容，支持三种模式：
1. 获取结构信息：传入 schema="1" 时，只返回JSON结构信息，不包含实际数据值
2. JMESPath查询：传入 query 参数时，使用JMESPath语法灵活检索数据
3. 获取所有数据：不传任何参数时，返回整个知识库的完整内容，除非用户特别需要，否则尽可能使用JMESPath的查询方式。

参数说明：
- schema (str, 可选): 是否只查询JSON结构。"1"表示只查询结构，此时会忽略query参数，只返回结构信息。不传入或传入"0"表示查询数据。默认值为None（0）
- query (str, 可选): JMESPath查询字符串，用于灵活检索数据。支持精确匹配、条件过滤、数字展平和投影等语法

返回值：
- 结构模式（schema="1"）：返回只包含结构信息的JSON对象，不包含实际数据值
- 查询模式（query参数）：返回符合JMESPath查询条件的数据，可以是任意类型（dict、list、str、int、float、bool等）
- 无参数模式：返回完整的JSON对象，包含知识库中所有的键值对（key-value pairs）。如果知识库为空，将返回空的JSON对象 {{}}

重要提示：JMESPath查询是基于知识库数据进行的。知识库数据可能是JSON对象（字典）或JSON数组，需要根据实际数据结构选择合适的查询语法。

示例数据结构1（知识库数据是对象）：
{{
  "company": "FutureAI Inc.",
  "departments": [
    {{
      "name": "R&D",
      "employees": [
        {{"name": "Alice", "active": true, "skills": ["Python", "AI"]}},
        {{"name": "Bob", "active": false, "skills": ["Java"]}}
      ]
    }},
    {{
      "name": "Marketing",
      "employees": [
        {{"name": "Charlie", "active": true, "skills": ["SEO"]}}
      ]
    }}
  ]
}}

JMESPath查询语法示例（知识库数据是对象时）：
- 获取所有部门：`departments[*]` - 直接访问对象的departments字段（数组）
- 获取第一个部门的员工：`departments[0].employees[*]` - 访问数组的第一个元素
- 获取所有员工的技能：`departments[*].employees[*].skills[]` - 展平嵌套数组
- 过滤活跃员工：`departments[*].employees[?active==true]` - 在数组中使用过滤（注意：`[?...]`只能用于数组，布尔值使用true/false，不需要引号）
- 获取特定部门：`departments[?name=='R&D']` - 在departments数组中过滤（字符串比较使用单引号）
- 获取所有员工名字：`departments[*].employees[*].name` - 投影操作
- 获取公司名称：`company` - 直接访问对象的字段
- 获取嵌套对象：`departments[0].employees[0].name` - 访问嵌套路径

示例数据结构2（知识库数据是数组）：
[
  {{"company": "puppyagent", "name": "Alice", "age": 25}},
  {{"company": "FutureAI", "name": "Bob", "age": 30}},
  {{"company": "puppyagent", "name": "Charlie", "age": 28}}
]

JMESPath查询语法示例（知识库数据是数组时）：
- 过滤特定公司：`[?company=='puppyagent']` - 在数组中使用过滤语法（注意：`[?...]`用于数组过滤）
- 获取所有名字：`[*].name` - 投影操作，获取数组中所有元素的name字段
- 获取特定公司的名字：`[?company=='puppyagent'].name` - 先过滤再投影
- 获取第一个元素：`[0]` - 访问数组的第一个元素
- 获取第一个元素的名字：`[0].name` - 访问数组第一个元素的name字段

常见错误和正确示例：
- ❌ 错误：`[?company=='puppyagent'].company_info.departments[*]` - 如果知识库数据是对象，不能对对象使用`[?...]`过滤
- ✅ 正确（对象）：`company_info.departments[*]` - 直接访问对象的字段
- ✅ 正确（数组）：`[?company=='puppyagent'].company_info.departments[*]` - 如果知识库数据是数组，可以先过滤再访问
- ❌ 错误：如果知识库数据是对象，使用`[?name=='Alice']`会失败
- ✅ 正确（对象）：`departments[*].employees[?name=='Alice']` - 在对象的数组字段中过滤
- ✅ 正确（数组）：`[?name=='Alice']` - 如果知识库数据是数组，可以直接过滤

条件表达式语法（重要）：
JMESPath 不支持 `? :` 三元运算符，但可以使用 `&&` 和 `||` 操作符实现条件逻辑：
- ❌ 错误：`school_info.school_name == 'puppyagent_university' ? school_info.departments[*].teachers[*] : []` - 不支持三元运算符
- ✅ 正确：`school_info.school_name == 'puppyagent_university' && school_info.departments[*].teachers[] || ` + chr(96) + '[]' + chr(96) + r'` - 使用 && 和 || 操作符（注意：空数组字面量使用反引号包裹）
  - 条件为真时：返回 `school_info.departments[*].teachers[]`（展平后的教师数组）
  - 条件为假时：返回空数组（注意：空数组字面量需要使用反引号包裹，写法：反引号 + [] + 反引号）
- 展平嵌套数组：使用 `[]` 而不是 `[*]` 来展平嵌套数组
  - `departments[*].teachers[*]` - 返回嵌套数组：`[[teacher1, teacher2], [teacher3]]`
  - `departments[*].teachers[]` - 返回展平数组：`[teacher1, teacher2, teacher3]`
- 空数组字面量示例：在 JMESPath 查询中，如果要返回空数组，应写成：反引号 + 左方括号 + 右方括号 + 反引号（在代码中表示为 `` `[]` ``）

使用场景：
- 首次访问知识库时，或者要实现增加、修改和删除操作时，必须先调用此工具了解数据结构（可以使用 schema="1" 快速查看结构）
- 需要检索特定数据时（使用 query 参数）
- 需要查看知识库的完整内容时（不传参数）

⚠️注意：
1. 如果你发现你的JMESPath写错，你可以通过这个网址查询他的具体语法：https://jmespath.org/specification.html#examples
2. 你应该尽可能采用JMESPath的查询方式去查询，如果发现查询语法写错了，请你检查后重新构造query，而不是直接去查询所有数据。只有你修改了3-4次后语法还是不正确，才尝试去直接获取所有数据。
""",
            
            "create": f"""{base_description}

功能：在知识库中批量创建新的键值对（key-value pairs）。

参数说明：
- elements (List[Dict]): 要创建的元素数组，每个元素是一个字典，包含：
  - key (str): 字符串类型，新数据项的键名。必须是唯一的，如果已存在则创建失败
  - content (Any): 任意类型，新数据项的值内容，可以是任意JSON可序列化的类型（dict、list、str、int、float、bool等）

使用场景：
- 当用户需要向知识库添加新的数据项时
- 当需要批量创建多个键值对时
- 当需要记录新的信息、文档或条目时

注意事项：
- 必须先使用 get_context 工具获取当前知识库内容，了解现有数据结构
- key必须是字符串类型，且在当前知识库中唯一
- 如果key已存在，创建操作将失败
- content可以是任意JSON可序列化的类型（dict、list、str、int、float、bool等），根据实际需求定义结构
- 支持批量创建，可以一次创建多个键值对

示例：
假设当前知识库为空 {{}}，要创建两个数据项：
elements = [
    {{"key": "user_001", "content": {{"name": "张三", "age": 25}}}},
    {{"key": "user_002", "content": {{"name": "李四", "age": 30}}}}
]
执行后将得到：{{"user_001": {{"name": "张三", "age": 25}}, "user_002": {{"name": "李四", "age": 30}}}}

示例场景：
- 用户说"在某某项目的某某知识库中添加一个新的用户信息，key是user_001" → 使用此工具创建
- 用户说"在某某项目的某某知识库中记录这个文档，key是doc_001" → 使用此工具创建
- 用户说"在某某项目的某某知识库中保存这个配置，key是config_001" → 使用此工具创建""",
            
            "update": f"""{base_description}

功能：批量更新知识库中已存在的键值对。

参数说明：
- updates (List[Dict]): 要更新的元素数组，每个元素是一个字典，包含：
  - key (str): 字符串类型，要更新的数据项的键名。必须已存在于知识库中
  - value (Any): 任意JSON类型，新的值内容，将完全替换原有的value

使用场景：
- 当用户需要修改知识库中现有数据项的值时或者需要更正或替换已有数据时
- 当需要批量更新多个键值对时

注意事项：
- 必须先使用 get_context 工具获取当前知识库内容，确认要更新的key是否存在
- key必须已存在于知识库中，如果不存在则更新失败
- value将完全替换原有的值，不是部分更新
- 支持批量更新，可以一次更新多个键值对

示例：
假设当前知识库为：{{"user_001": {{"name": "张三", "age": 25}}}}
要更新user_001的age为26：
updates = [{{"key": "user_001", "value": {{"name": "张三", "age": 26}}}}]
执行后将得到：{{"user_001": {{"name": "张三", "age": 26}}}}

示例场景：
- 用户说"在某某项目的某某知识库中修改key为user_001的用户信息" → 使用此工具更新
- 用户说"在某某项目的某某知识库中更新key为doc_001的文档内容" → 使用此工具更新
- 用户说"在某某项目的某某知识库中把key为config_001的配置改为新值" → 使用此工具更新""",
            
            "delete": f"""{base_description}

功能：从知识库中批量删除指定的键值对。

参数说明：
- keys (List[str]): 字符串数组，包含要删除的所有key（键名）

使用场景：
- 当用户需要移除知识库中的某些数据项时
- 当需要批量删除多个键值对时
- 当需要清理不再需要的数据时

注意事项：
- 必须先使用 get_context 工具获取当前知识库内容，确认要删除的key是否存在
- keys数组中的每个key必须是字符串类型
- 如果某个key不存在，该key的删除操作将被忽略，其他key的删除操作仍会执行
- 支持批量删除，可以一次删除多个键值对
- 删除操作是不可逆的，请谨慎使用

示例：
假设当前知识库为：{{"user_001": {{"name": "张三"}}, "user_002": {{"name": "李四"}}, "user_003": {{"name": "王五"}}}}
要删除user_001和user_002：
keys = ["user_001", "user_002"]
执行后将得到：{{"user_003": {{"name": "王五"}}}}

示例场景：
- 用户说"删除key为user_001的数据" → 使用此工具删除
- 用户说"移除key为doc_001和doc_002的文档" → 使用此工具批量删除
- 用户说"清除key为config_001的配置" → 使用此工具删除"""
        }
        
        return descriptions.get(tool_type, base_description)
    
    def get_context(
        self, 
        context_info: Dict[str, Any],
        schema: Optional[str] = None,
        query: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        获取指定路径下的知识库内容（JSON对象）
        
        Args:
            context_info: 上下文信息字典，包含 context, context_id, json_pointer 等
            schema: 是否只查询JSON结构。"1"或1表示只查询结构，此时会忽略query参数，只返回结构信息。默认值为None（0）
            query: JMESPath 查询字符串，用于灵活检索数据。支持精确匹配、条件过滤、数字展平和投影等语法
        
        Returns:
            操作结果字典
        """
        try:
            project_id = context_info.get("project_id")
            table_id = context_info.get("table_id") or context_info.get("context_id")
            json_pointer = context_info.get("json_pointer", "")
            
            if not project_id or not table_id:
                return {
                    "error": "项目ID或表ID不存在",
                    "project_id": project_id,
                    "table_id": table_id
                }
            
            project_table_service = get_project_table_service()
            
            # 转换 schema 参数：将字符串转换为整数
            schema_int = None
            if schema is not None:
                try:
                    # FastMCP 会确保传入的是字符串类型，直接转换为整数
                    schema_int = int(schema)
                except (ValueError, TypeError) as e:
                    return {
                        "error": f"schema 参数无效，必须是 '1'，当前值: {schema}，错误: {str(e)}",
                    }
            
            # 如果 schema=1，只返回结构信息
            if schema_int == 1:
                success, error_message, data = project_table_service.get_table_structure(
                    project_id, table_id, json_pointer
                )
                
                if not success:
                    return {
                        "error": error_message or "获取表结构失败",
                    }
                
                return {
                    "message": "获取表结构成功",
                    "data": data,
                    "schema_only": True
                }
            
            # 如果提供了 query 参数，使用 JMESPath 查询
            if query:
                success, error_message, data = project_table_service.query_table_data_with_jmespath(
                    project_id, table_id, json_pointer, query
                )
                
                if not success:
                    return {
                        "error": error_message or "JMESPath 查询失败",
                        "query": query
                    }
                
                # 如果查询结果为 None，表示没有匹配的数据
                if data is None:
                    return {
                        "message": "查询完成，但没有找到匹配的数据",
                        "data": None,
                        "query": query
                    }
                
                return {
                    "message": "JMESPath 查询成功",
                    "data": data,
                    "query": query
                }
            
            # 默认情况：返回所有数据
            success, error_message, data = project_table_service.get_table_data(project_id, table_id, json_pointer)
            
            if not success:
                return {
                    "error": error_message or "获取表内容失败",
                }
            
            # 如果 data 是 None，返回空字典
            if data is None:
                data = {}
            
            return {
                "message": "获取表内容成功",
                "data": data,
            }
        except Exception as e:
            log_error(f"Error getting context: {e}")
            return {
                "error": f"获取表内容失败: {str(e)}"
            }
    
    def create_element(
        self, 
        elements: List[Dict[str, Any]], 
        context_info: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        批量创建元素到指定路径下
        
        Args:
            elements: 元素数组，每个元素包含 key（str）和 content（Any）
            context_info: 上下文信息字典，包含 context, context_id, json_pointer 等
        
        Returns:
            操作结果字典
        """
        try:
            project_id = context_info.get("project_id")
            table_id = context_info.get("table_id") or context_info.get("context_id")
            json_pointer = context_info.get("json_pointer", "")
            
            if not project_id or not table_id:
                return {
                    "error": "项目ID或表ID不存在",
                }
            
            # 验证元素格式
            validated_elements = []
            failed_keys = []
            
            for element in elements:
                if not isinstance(element, dict):
                    failed_keys.append({"element": element, "reason": "元素必须是字典类型"})
                    continue
                
                key = element.get("key")
                content = element.get("content")
                
                if not isinstance(key, str):
                    failed_keys.append({"key": key, "reason": "key必须是字符串类型"})
                    continue
                
                if "key" not in element or "content" not in element:
                    failed_keys.append({"element": element, "reason": "元素缺少 'key' 或 'content' 字段"})
                    continue
                
                validated_elements.append({"key": key, "content": content})
            
            if not validated_elements:
                return {
                    "error": "没有成功创建任何元素",
                    "failed": failed_keys
                }
            
            # 使用 project_table_service 在指定路径下创建数据
            project_table_service = get_project_table_service()
            success, error_message, data = project_table_service.create_table_data(
                project_id=project_id,
                table_id=table_id,
                json_pointer_path=json_pointer,
                elements=validated_elements
            )
            
            if not success:
                return {
                    "error": error_message or "创建元素失败",
                    "failed": failed_keys if failed_keys else None
                }
            
            # 提取成功创建的 keys
            created_keys = [elem["key"] for elem in validated_elements]
            
            return {
                "message": "元素创建成功",
                "created_keys": created_keys,
                "failed": failed_keys if failed_keys else None,
                "total_created": len(created_keys),
                "total_failed": len(failed_keys),
            }
        except Exception as e:
            log_error(f"Error creating elements: {e}")
            return {
                "error": f"创建元素失败: {str(e)}"
            }
    
    def update_element(
        self, 
        updates: List[Dict[str, Any]], 
        context_info: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        批量更新指定路径下的元素
        
        Args:
            updates: 更新数组，每个元素包含 key（str）和 content（Any）
            context_info: 上下文信息字典，包含 context, context_id, json_pointer 等
        
        Returns:
            操作结果字典
        """
        try:
            project_id = context_info.get("project_id")
            table_id = context_info.get("table_id") or context_info.get("context_id")
            json_pointer = context_info.get("json_pointer", "")
            
            if not project_id or not table_id:
                return {
                    "error": "项目ID或表ID不存在",
                }
            
            # 验证更新项格式
            validated_updates = []
            failed_keys = []
            
            for update_item in updates:
                if not isinstance(update_item, dict):
                    failed_keys.append({"update": update_item, "reason": "更新项必须是字典类型"})
                    continue
                
                key = update_item.get("key")
                content = update_item.get("content")
                
                if not isinstance(key, str):
                    failed_keys.append({"key": key, "reason": "key必须是字符串类型"})
                    continue
                
                if "key" not in update_item or "content" not in update_item:
                    failed_keys.append({"update": update_item, "reason": "更新项缺少 'key' 或 'content' 字段"})
                    continue
                
                validated_updates.append({"key": key, "content": content})
            
            if not validated_updates:
                return {
                    "error": "没有成功更新任何元素",
                    "failed": failed_keys
                }
            
            # 使用 project_table_service 更新指定路径的数据
            project_table_service = get_project_table_service()
            success, error_message, data = project_table_service.update_table_data(
                project_id=project_id,
                table_id=table_id,
                json_pointer_path=json_pointer,
                elements=validated_updates
            )
            
            if not success:
                return {
                    "error": error_message or "更新元素失败",
                    "failed": failed_keys if failed_keys else None
                }
            
            # 提取成功更新的 keys
            updated_keys = [update["key"] for update in validated_updates]
            
            return {
                "message": "元素更新成功",
                "updated_keys": updated_keys,
                "failed": failed_keys if failed_keys else None,
                "total_updated": len(updated_keys),
                "total_failed": len(failed_keys),
            }
        except Exception as e:
            log_error(f"Error updating elements: {e}")
            return {
                "error": f"更新元素失败: {str(e)}"
            }
    
    def delete_element(
        self, 
        keys: List[str], 
        context_info: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        批量删除指定路径下的元素
        
        Args:
            keys: 要删除的key数组
            context_info: 上下文信息字典，包含 context, context_id, json_pointer 等
        
        Returns:
            操作结果字典
        """
        try:
            project_id = context_info.get("project_id")
            table_id = context_info.get("table_id") or context_info.get("context_id")
            json_pointer = context_info.get("json_pointer", "")
            
            if not project_id or not table_id:
                return {
                    "error": "项目ID或表ID不存在",
                }
            
            # 验证 keys 格式
            validated_keys = []
            invalid_keys = []
            
            for key in keys:
                if not isinstance(key, str):
                    invalid_keys.append({"key": key, "reason": "key必须是字符串类型"})
                    continue
                validated_keys.append(key)
            
            if not validated_keys:
                return {
                    "error": "没有有效的key可以删除",
                    "invalid": invalid_keys
                }
            
            # 使用 project_table_service 删除指定路径下的数据
            project_table_service = get_project_table_service()
            success, error_message, data = project_table_service.delete_table_data(
                project_id=project_id,
                table_id=table_id,
                json_pointer_path=json_pointer,
                keys=validated_keys
            )
            
            if not success:
                return {
                    "error": error_message or "删除元素失败",
                    "invalid": invalid_keys if invalid_keys else None
                }
            
            # 提取成功删除的 keys（从返回的数据中推断）
            # 由于 delete_table_data 返回删除后的数据，我们可以通过比较来确认删除的 keys
            deleted_keys = validated_keys  # 如果成功，说明所有 keys 都被删除了
            
            return {
                "message": "元素删除成功",
                "deleted_keys": deleted_keys,
                "invalid": invalid_keys if invalid_keys else None,
                "total_deleted": len(deleted_keys),
                "total_invalid": len(invalid_keys),
            }
        except Exception as e:
            log_error(f"Error deleting elements: {e}")
            return {
                "error": f"删除元素失败: {str(e)}"
            }


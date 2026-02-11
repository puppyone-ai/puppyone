# 存储策略与事件整形重构总结

## 重构目标

解决 `Env.py` 中存储策略决策和事件整形逻辑的耦合问题，消除与 `GenericBlock.py` 中重复的逻辑，并改善代码的封装边界。

## 重构前的问题

1. **重复逻辑风险**：`Env.py` 和 `GenericBlock.py` 都包含相同的内容大小计算逻辑和存储阈值决策
2. **封装边界模糊**：`Env` 直接修改 `Block` 的持久化状态
3. **责任混乱**：编排逻辑与存储决策、事件整形混合在一起

## 重构方案

### 1. HybridStoragePolicy - 统一存储策略

**文件**: `PuppyEngine/Server/HybridStoragePolicy.py`

**功能**:
- 提供统一的存储策略决策逻辑
- 集中内容大小计算方法
- 基于可配置阈值决定使用内部还是外部存储
- 消除重复的存储决策代码

**主要方法**:
- `should_use_external_storage()`: 决定是否使用外部存储
- `calculate_content_size()`: 统一的内容大小计算
- `get_storage_metadata()`: 获取存储元数据

### 2. EventFactory - 集中事件创建

**文件**: `PuppyEngine/Server/EventFactory.py`

**功能**:
- 集中所有工作流事件的创建逻辑
- 确保事件结构的一致性
- 减少事件创建代码的重复

**主要方法**:
- `create_task_*_event()`: 任务级事件
- `create_edge_*_event()`: 边缘级事件  
- `create_block_updated_event_*()`: 块更新事件
- `create_batch_completed_event()`: 批次完成事件
- `create_v1_compatibility_event()`: v1兼容性事件

### 3. EdgeResultMapper - 边缘结果映射

**文件**: `PuppyEngine/Server/EdgeResultMapper.py`

**功能**:
- 封装不同边缘类型的结果映射逻辑
- 处理特殊边缘类型（如 ifelse）的结果结构
- 将边缘执行结果映射到输出块

**主要方法**:
- `map_edge_result_to_blocks()`: 主要映射方法
- `_handle_ifelse_result()`: 处理 ifelse 边缘
- `_handle_standard_result()`: 处理标准边缘

### 4. BlockUpdateService - 块更新服务

**文件**: `PuppyEngine/Server/BlockUpdateService.py`

**功能**:
- 封装块更新的完整流程
- 应用存储策略
- 执行持久化操作
- 生成相应事件
- 提供 v1 兼容性支持

**主要方法**:
- `update_blocks_with_results()`: 主要更新方法
- `_handle_external_storage_update()`: 处理外部存储更新
- `_handle_internal_storage_update()`: 处理内部存储更新

## 重构后的架构

### Env.py 的变化

**之前**:
```python
# 直接计算内容长度
content_length = len(content)
storage_threshold = int(os.getenv("STORAGE_CHUNK_SIZE", "1024"))
use_external_storage = content_length >= storage_threshold

# 直接修改块状态
block.storage_class = 'external'
block.is_persisted = True

# 内联创建事件
yield {
    "event_type": "BLOCK_UPDATED",
    "block_id": block_id,
    ...
}
```

**之后**:
```python
# 使用服务处理块更新
async for event in self.block_update_service.update_blocks_with_results(
    self.blocks, results, self.storage_client, self.user_info['user_id']
):
    yield event

# 使用工厂创建事件
yield EventFactory.create_task_started_event(
    self.id, self.start_time, len(self.blocks), len(self.edges)
)

# 使用映射器处理边缘结果
results = self.edge_result_mapper.map_edge_result_to_blocks(edge_id, edge_result)
```

### GenericBlock.py 的变化

**之前**:
```python
# 重复的内容大小计算
def _calculate_content_size(self, content: Any) -> int:
    if isinstance(content, str):
        return len(content)
    # ... 重复的逻辑

# 重复的阈值检查
content_size = self._calculate_content_size(content)
return content_size > self.SIZE_THRESHOLD
```

**之后**:
```python
# 使用统一的存储策略
def _evaluate_storage_need(self) -> bool:
    content = self.get_content()
    return self.storage_policy.should_use_external_storage(content)
```

## 重构收益

### 1. 消除重复逻辑
- 存储大小计算逻辑统一到 `HybridStoragePolicy`
- 存储阈值决策集中管理
- 事件创建逻辑统一到 `EventFactory`

### 2. 改善封装边界
- `Env` 不再直接修改块的持久化状态
- 存储决策归属于专门的策略类
- 块更新逻辑封装在专门的服务中

### 3. 提高可维护性
- 单一责任原则：每个类都有明确的职责
- 易于测试：各个组件可以独立测试
- 易于扩展：新的存储策略或事件类型易于添加

### 4. 保持向后兼容性
- 所有现有的事件结构保持不变
- v1 兼容性事件继续支持
- 现有的 API 接口不受影响

## 使用指南

### 添加新的存储策略
```python
# 扩展 HybridStoragePolicy 或创建新的策略类
class CustomStoragePolicy(HybridStoragePolicy):
    def should_use_external_storage(self, content: Any, force_external: bool = False) -> bool:
        # 自定义逻辑
        return super().should_use_external_storage(content, force_external)
```

### 添加新的事件类型
```python
# 在 EventFactory 中添加新方法
@staticmethod
def create_custom_event(custom_data: Any) -> Dict[str, Any]:
    return {
        "event_type": "CUSTOM_EVENT",
        "data": custom_data,
        "timestamp": datetime.utcnow().isoformat()
    }
```

### 处理新的边缘类型
```python
# 在 EdgeResultMapper 中扩展映射逻辑
def _handle_custom_edge_result(self, edge_result: Any, output_block_ids: Set[str]) -> Dict[str, Any]:
    # 自定义边缘结果处理逻辑
    pass
```

## 总结

这次重构成功地将存储策略决策、事件整形和边缘结果映射从 `Env.py` 中分离出来，创建了职责明确的服务类。重构后的代码具有更好的可维护性、可测试性和可扩展性，同时保持了完全的向后兼容性。

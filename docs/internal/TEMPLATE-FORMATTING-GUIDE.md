# 目标

在前端增加对后端新操作 apply_template 的支持，用一个“模板”结构严格约束输出结构，并把“源”结构中同路径的值拷贝过去（数组按模板长度对齐、源短补 null、源长截断）。推荐在同一条 modify 边里先执行 variable_replace 再执行 apply_template。

# 集成点概览

- 文件：PuppyFlow/app/components/workflow/edgesNode/edgeNodesNew/EditStructured.tsx
- 相关：runSingleEdgeNode 及其 JSON 构建（通常在 edgeNodeJsonBuilders.ts 或 useEdgeNodeBackEndJsonBuilder.ts）

# UI 与交互改造

## 新增模式常量与选项

- 新增 const MODIFY_APPLY_TEMPLATE = 'apply_template'
- 下拉 Mode 选项加入 apply_template，展示名可用 “apply template”
- 该模式下无需 Path 编辑器，隐藏路径编辑 UI

## 输入/输出连线

- 输入要求：两个 structured 输入  
  - “源”结构：作为 edge content  
  - “模板”结构：作为 operations[1].params.value_template  
- 输出：一个 structured 输出

## 选择模板来源

- 提供一个下拉（或使用已连接输入的 label）让用户指定哪个输入作为模板
- 可选：支持配置 variable_replace.plugins（键值对）作为第一步操作

# 前端 JSON 构建规则

- modify 边基础字段：  
  - type: "modify"  
  - data.modify_type: "edit_structured"  
  - data.content: "{{<源输入label>}}"  
  - data.extra_configs.operations: 顺序执行  
- 可选 variable_replace：  
  ```json
  {"type": "variable_replace", "params": {"plugins": { "<key>": "<value>" }}}
  ```
- 必选 apply_template：  
  ```json
  {"type": "apply_template", "params": {"value_template": "{{<模板输入label>}}"}}
  ```
- data.inputs 必须包含“源”和“模板”两个 block_id→label
- data.outputs 指定输出 block

# 关键代码片段

## 增加选项与 UI 切换（片段）

```tsx
// 1) 常量
const MODIFY_APPLY_TEMPLATE = 'apply_template';
// 2) Mode 下拉加入
<PuppyDropdown
  options={[
    MODIFY_GET_TYPE,
    MODIFY_DEL_TYPE,
    MODIFY_REPL_TYPE,
    MODIFY_GET_ALL_KEYS,
    MODIFY_GET_ALL_VAL,
    MODIFY_APPLY_TEMPLATE,    // 新增
  ]}
  onSelect={(option: string) => setExecMode(option)}
  selectedValue={execMode}
/>
// 3) 隐藏 Path 编辑器（apply_template 不需要 path）
{!(execMode === MODIFY_GET_ALL_KEYS || execMode === MODIFY_GET_ALL_VAL || execMode === MODIFY_APPLY_TEMPLATE) && (
  <TreePathEditor ... />
)}
```

## 构建 modify 边 payload（示例，落在 JSON 构建函数中）

```ts
// 假设已取到：sourceLabel, templateLabel, outputBlockId
const operations = [];
if (plugins && Object.keys(plugins).length > 0) {
  operations.push({
    type: 'variable_replace',
    params: { plugins },
  });
}
operations.push({
  type: 'apply_template',
  params: { value_template: `{{${templateLabel}}}` },
});
const modifyEdge = {
  type: 'modify',
  data: {
    modify_type: 'edit_structured',
    content: `{{${sourceLabel}}}`,
    extra_configs: { operations },
    inputs: {
      [sourceBlockId]: sourceLabel,
      [templateBlockId]: templateLabel,
    },
    outputs: {
      [outputBlockId]: getNode(outputBlockId)?.data?.label ?? 'Result',
    },
  },
};
```

## 示例 payload（最小化）

```json
{
  "type": "modify",
  "data": {
    "modify_type": "edit_structured",
    "content": "{{Source}}",
    "extra_configs": {
      "operations": [
        { "type": "variable_replace", "params": { "plugins": { "nick": "Alice" } } },
        { "type": "apply_template", "params": { "value_template": "{{Template}}" } }
      ]
    },
    "inputs": { "src_block": "Source", "tmpl_block": "Template" },
    "outputs": { "out_block": "Result" }
  }
}
```

# 校验与错误提示

- 校验连接：必须选择或检测到“源”和“模板”两个输入，且都是 structured；缺一时报错。
- 校验输出：必须选择一个 structured 输出；缺失时报错。
- 可选：在 apply_template 模式下禁用 Path 编辑器的交互并提示“模板驱动，无需路径”。
```
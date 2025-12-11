
# 更新日志

## 核心修改

1. **移除原先的User模块，User模块请直接对接Supabase。**
2. **所有接口需要在Header传入`Authorization: Bear <token>`**
3. **数据库表修改**：
   1. **DELETE**: 移除`user_temp`表。
   2. **MODIFY**: 数据库表所有`user_id`都从`int`改成`str`，适配Auth表。
   3. **MODIFY**: 
4. **MCP统一路由地址**: 添加mcp统一路由地址，不需要访问到各个mcp服务本身。

## 接口修改

1. **DELETE** 移除原先的User模块。User模块和登陆相关的信息请前端直接对接Supabase。
2. **MODIFY** Table模块修改
   1. **接口修改**：List接口从`GET /api/v1/tables/user/{user_id}`修改成`GET /api/v1/tables/`, 通过Token获取用户ID信息，并返回所有项目和对应的Table。
   2. **安全性**：通过依赖注入实现所有接口的Token鉴权和数据权限校验。
3. **MODIFY** MCP模块
   1. **安全性**：通过依赖注入实现所有接口的Token鉴权和数据权限校验。

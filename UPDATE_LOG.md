
# 更新日志

## 核心修改

1. **移除原先的User模块，User模块请直接对接Supabase。**
2. **所有接口需要在Header传入`Authorization: Bear <token>`**
3. 数据库表所有ID都从`int`改成`str`，适配Auth表。
4. 所有`user_id`相关的外键改成从`int`改成`str`，适配Auth表。

## 接口修改

1. **DELETE** 移除原先的User模块。User模块和登陆相关的信息请前端直接对接Supabase。
2. **MODIFY** Table模块修改
   1. List接口从`GET /api/v1/tables/user/{user_id}`修改成`GET /api/v1/tables/`, 通过Token获取用户ID信息，并返回所有项目和对应的Table。
3. 
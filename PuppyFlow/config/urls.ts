// 🔒 安全修复：移除客户端直接访问后端服务的URL配置
// 所有后端通信现在通过安全的API代理进行：/api/server, /api/engine, /api/storage, /api/user-system

export const SYSTEM_URLS = {
  USER_SYSTEM: {
    // Do not expose backend URL to client. Use server-side env in API routes/middleware.
    // BACKEND is intentionally removed from client bundle.
    FRONTEND: process.env.USER_SYSTEM_FRONTEND_URL || 'http://localhost:3000',
  },
  // 🔒 安全修复：移除直接后端URL暴露，所有通信通过代理
  // 客户端应使用以下API代理端点：
  // - Engine API: /api/engine/*
  // - Storage API: /api/storage/*  
  // - Server API: /api/server/*
  // - User System API: /api/user-system/*
  
  // Legacy URLs marked as deprecated - DO NOT USE in client code
  DEPRECATED_DIRECT_ACCESS: {
    // These are kept for reference only - DO NOT USE
    PUPPY_ENGINE_LEGACY: '*** DEPRECATED: Use /api/engine/* instead ***',
    PUPPY_STORAGE_LEGACY: '*** DEPRECATED: Use /api/storage/* instead ***',
    API_SERVER_LEGACY: '*** DEPRECATED: Use /api/server/* instead ***',
  },
};

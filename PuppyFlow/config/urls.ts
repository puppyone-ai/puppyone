// 🔒 安全修复：移除客户端直接访问后端服务的URL配置
// 所有后端通信现在通过安全的API代理进行：/api/server, /api/engine, /api/storage, /api/user-system

export const SYSTEM_URLS = {
  USER_SYSTEM: {
    // Do not expose backend URL to client. Use server-side env in API routes/middleware.
    // BACKEND is intentionally removed from client bundle.
    FRONTEND: process.env.USER_SYSTEM_FRONTEND_URL || 'http://localhost:3000',
  },
  
  // ⚠️ DEPRECATED: Direct backend URLs - migrate to /api/* proxies
  // These are temporarily kept for backward compatibility during migration
  PUPPY_ENGINE: {
    BASE: process.env.NEXT_PUBLIC_PUPPYENGINE_URL || 'http://localhost:8001',
  },
  PUPPY_STORAGE: {
    BASE: process.env.NEXT_PUBLIC_PUPPYSTORAGE_URL || 'http://localhost:8002',
  },
  API_SERVER: {
    BASE: process.env.NEXT_PUBLIC_API_SERVER_URL || 'http://localhost:8004',
  },
  
  // 🔒 安全修复说明：所有客户端应迁移到以下安全代理端点：
  // - Engine API: /api/engine/*
  // - Storage API: /api/storage/*  
  // - Server API: /api/server/*
  // - User System API: /api/user-system/*
};

export const SYSTEM_URLS = {
    USER_SYSTEM: {
        BACKEND: process.env.NEXT_PUBLIC_USER_SYSTEM_BACKEND_URL || "http://localhost:8000",
        FRONTEND: process.env.USER_SYSTEM_FRONTEND_URL || "http://localhost:3000"
    },
    PUPPY_ENGINE: {
        BASE: process.env.NEXT_PUBLIC_PUPPYENGINE_URL || "http://localhost:8001"
    },
    PUPPY_STORAGE: {
        BASE: process.env.NEXT_PUBLIC_PUPPYSTORAGE_URL || "http://localhost:8002"
    },
    API_SERVER: {
        BASE: process.env.NEXT_PUBLIC_API_SERVER_URL || "http://localhost:8004"
    }
} 
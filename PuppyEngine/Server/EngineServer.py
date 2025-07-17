"""
Engine Server - FastAPI Implementation with Concurrency Controls and User Authentication

Core Design Patterns:
--------------------
1. Task-Level Locking Mechanism:
   - Each task_id gets a dedicated lock to prevent concurrent processing
   - Non-blocking lock acquisition prevents deadlocks
   - Returns 409 Conflict when a task is already being processed
   - Ensures resources aren't modified by multiple requests simultaneously

2. Streaming Response Architecture:
   - Nested stream_data() generator provides separation of concerns:
     * Outer function (get_data): Request validation, parameter processing, lock management
     * Inner function (stream_data): Data generation, error handling, resource cleanup
   - Enables clean coupling between async FastAPI handlers and sync workflow processing
   - Delays execution until the response is consumed by the client

3. Resource Management:
   - Centralized cleanup in finally blocks ensures resources are released in all scenarios
   - Context managers (with workflow:) handle proper workflow cleanup
   - Hierarchical cleanup: workflow resources first, then task data, finally task locks
   - Exception handling at multiple levels prevents resource leaks

4. Concurrency Safety:
   - DataStore uses fine-grained locks for concurrent access safety
   - Task locks provide exclusive access to prevent race conditions
   - Workflow object assumes single-threaded access after task lock acquisition

5. Retry Mechanism:
   - Automatic retries for workflow retrieval handle potential timing issues
   - Short delays between retries allow for asynchronous data processing
   - Detailed diagnostic information when retries are exhausted
   - Avoids unnecessary complexity of explicit "ready" state tracking

6. Task ID Association:
   - WorkFlow instances are associated with their task_id during creation
   - Each workflow maintains its own data copy for processing independence
   - Ensures clear object boundaries and simplifies resource management
   - Prepares for future signature-based authorization mechanisms

7. Data Ownership Model:
   - Clear separation: DataStore owns task metadata, WorkFlow owns processing data
   - WorkFlow maintains its own copy of blocks and edges
   - No shared mutable state between components
   - Follows object-oriented principles of encapsulation and responsibility

8. User Authentication & Usage Tracking:
   - Each request requires user authentication via JWT token
   - Usage is checked before workflow execution
   - Run consumption is tracked per workflow execution
   - Supports both local mode (skip checks) and remote mode (call user system)

Engineering Decisions:
---------------------
1. Minimal State Design:
   - Task existence and workflow existence are the only states tracked
   - No explicit "ready" or "processing" flags to avoid state complexity
   - State transitions are implicit and tied to concrete operations
   - Follows "Occam's Razor" principle - minimum necessary complexity

2. Error Handling Strategy:
   - Clear separation between client errors (4xx) and server errors (5xx)
   - Detailed error messages with context about task state
   - Structured error responses with error codes and descriptive messages
   - Comprehensive error logging for diagnosis

3. Validation:
   - Input validation in send_data ensures data integrity
   - Workflow creation validation prevents null/invalid workflows
   - Task existence validation before processing
   - User authentication validation before any processing

4. Copy vs Reference Pattern:
   - Chose copy-based model over reference-based for future extensibility
   - Each WorkFlow maintains its own data copy allowing for independent operations
   - Simplifies future implementation of signature-based permissions
   - Easier to migrate to distributed processing in the future
   - Reduces tight coupling between system components

5. Authentication & Usage Integration:
   - Non-blocking usage checks for better performance
   - Usage consumption happens during workflow execution
   - Graceful fallback for local development mode
   - Comprehensive error reporting for usage-related issues

Future Expansion Architecture:
----------------------------
The system is designed to evolve toward more advanced patterns:

1. Signature-Based Authorization:
   - Each workflow will have a cryptographic signature for authorization
   - Signatures will define fine-grained read/write permissions on blocks
   - Block modifications verified against signature permissions
   - Support for time-limited or scoped access credentials
   - Current copy-based design prepares for this security model

2. Event Sourcing Upgrade Path:
   - Evolution to event-based architecture with command/query separation
   - Workflows will generate signed update commands
   - DataStore will validate, merge and apply updates
   - Central event bus will decouple producers and consumers
   - Support for conflict resolution and version history

3. Multi-Tenant Data Isolation:
   - Signature-based data partitioning for multi-tenant scenarios
   - Cryptographic isolation between different users' workflows
   - Central data store with logical tenant separation
   - Cross-tenant workflows with explicit permission boundaries

4. Advanced Usage Tracking:
   - Per-block usage consumption tracking
   - Different usage types for different block types
   - Usage quotas and rate limiting
   - Advanced analytics and billing integration

The copy-based model provides better encapsulation and clearer boundaries for these
future enhancements, especially for security and distributed processing features.

The server implements a straightforward synchronous workflow processor with concurrent
request handling capabilities through FastAPI's asynchronous model, enhanced with
user authentication and usage tracking capabilities.
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Get deployment type for documentation configuration
DEPLOYMENT_TYPE = os.getenv("DEPLOYMENT_TYPE", "local").lower()

# Import DataStore from separate module
from Server.DataStore import DataStore

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle manager"""
    # Application startup code
    from Utils.logger import log_info, log_error, log_warning, log_debug
    from Utils.puppy_exception import PuppyException
    from Utils.config import config, ConfigValidationError
    
    log_info("--- Engine Server starting up ---")
    
    # 1. Dynamic imports to avoid duplicate initialization
    from Server.WorkFlow import WorkFlow
    from Server.JsonValidation import JsonValidator
    from Server.auth_module import auth_module, AuthenticationError, User
    from Server.usage_module import usage_module, UsageError
    
    try:
        # 2. Configuration validation
        log_info("Configuration validation completed, starting server...")
        
        # 3. Initialize data store
        app.state.data_store = DataStore()
        log_info("DataStore initialized with background cleanup thread")
        

        
        log_info("--- Engine Server startup completed ---")
        
    except ConfigValidationError as cve:
        log_error("Configuration validation failed")
        raise cve
    except PuppyException as e:
        log_error(f"Engine Server initialization error: {str(e)}")
        raise
    except Exception as e:
        log_error(f"Unexpected error during Engine Server initialization: {str(e)}")
        raise PuppyException(6301, "Server Initialization Error", str(e))
    
    yield  # Handle requests
    
    # Application shutdown code
    log_info("--- Engine Server shutting down ---")

# Initialize FastAPI App based on deployment type
if DEPLOYMENT_TYPE == "remote":
    # Production environment: disable documentation endpoints
    app = FastAPI(
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan
    )
else:
    # Local environment: enable documentation endpoints
    app = FastAPI(lifespan=lifespan)

# Configure CORS middleware (must be done before app startup)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    max_age=600  # Cache preflight for 10 minutes
)
# Import required modules for route handlers
from Server.routes import health_router, data_router
from Utils.logger import log_info
from Utils.puppy_exception import PuppyException
from Utils.config import ConfigValidationError

log_info("CORS middleware configured successfully")

# Register routers
app.include_router(health_router)
app.include_router(data_router)
log_info("Routes registered successfully")

# Note: All initialization logic has been moved to the lifespan context manager above










if __name__ == "__main__":
    try:
        log_info("Engine Server 正在启动...")
        
        # 配置验证在 config 模块导入时已经执行
        # 如果有配置错误，程序会在此之前退出
        log_info("配置验证完成，开始启动服务器...")
        
        # Use Hypercorn for ASGI server
        import asyncio
        import hypercorn.asyncio
        hypercorn_config = hypercorn.Config()
        hypercorn_config.bind = ["127.0.0.1:8001"]
        # Enable hot-reloading for local development
        hypercorn_config.reload = True
        
        log_info("服务器将在 http://127.0.0.1:8001 启动 (热重载已开启)")
        asyncio.run(hypercorn.asyncio.serve(app, hypercorn_config))
        
    except ConfigValidationError as cve:
        # 配置验证错误，直接退出（错误信息已在 config.py 中输出）
        exit(1)
    except PuppyException as e:
        raise
    except Exception as e:
        log_error(f"Unexpected Error in Launching Server: {str(e)}")
        raise PuppyException(6000, "Unexpected Error in Launching Server", str(e))

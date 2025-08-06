# Phase 1 Refactoring: Internal Refactor, External Compatibility

## Overview

This document describes the Phase 1 refactoring of PuppyEngine, which introduces a new internal architecture while maintaining full backward compatibility with existing APIs.

## Key Changes

### 1. New Block Architecture (Protocol-Oriented Programming)

- **BaseBlock**: Abstract base class defining the block interface
- **GenericBlock**: Concrete implementation with dynamic persistence strategies
- **BlockFactory**: Centralized block instantiation logic

### 2. Persistence Strategies

- **MemoryStrategy**: For blocks that remain in memory
- **ExternalStorageStrategy**: For blocks using external storage (PuppyStorage)
- Dynamic switching based on content size (default threshold: 1MB)

### 3. Execution Architecture

- **ExecutionPlanner**: Pure graph computation engine (extracted from WorkFlow)
  - Manages DAG state and dependencies
  - Determines parallel executable batches
  - No I/O operations

- **Env**: New execution environment for single workflow runs
  - Manages blocks and edges
  - Handles concurrent prefetching
  - Yields events during execution

- **EnvManager** (formerly WorkFlowOrchestrator): Task lifecycle management
  - Manages background execution
  - Provides streaming results
  - Maintains backward compatibility

### 4. Event-Driven Architecture

New event types (internally used, filtered for v1 API):

- `WORKFLOW_STARTED`
- `WORKFLOW_COMPLETED`
- `WORKFLOW_ERROR`
- `STREAM_STARTED`
- `STREAM_ENDED`
- `BATCH_COMPLETED`
- `PROGRESS_UPDATE`

### 5. Backward Compatibility

The v1 API remains unchanged:

- `POST /send_data` returns 202 with task_id
- `GET /get_data/{task_id}` streams SSE with block results
- Event filtering ensures only v1-compatible data is sent

## Benefits

1. **Better Separation of Concerns**: Clear boundaries between graph computation, execution, and persistence
2. **Improved Performance**: Concurrent prefetching and smart storage strategies
3. **Future-Ready**: Architecture supports v2 API with richer event streams
4. **Maintainability**: Modular design with clear responsibilities

## Migration Path

### Phase 2: Introduce V2 API

- New endpoints: `/v2/send_data`, `/v2/get_data/{task_id}`
- Full event stream with typed SSE events
- Enhanced client capabilities

### Phase 3: Deprecation

- Gradual migration from v1 to v2
- Eventually remove v1 compatibility layer

## Testing

Run the test script to verify the refactoring:

```bash
cd PuppyEngine
source venv/bin/activate
python test_phase1_refactor.py
```

The test covers:

1. Basic workflow execution
2. External storage for large blocks
3. Streaming results compatibility
4. Task status queries

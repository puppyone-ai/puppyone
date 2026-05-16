"""Product Operation Adapter package.

Translates typed product operations (write_file, mkdir, mv, rm, bulk_write,
upload, connector imports, hosted-agent writes) into
``OperationWriteIntent`` and routes them through the
``GitNativeTransactionEngine``. Callers should import ``MutOps`` from
``mut_engine.adapters.operations.ops_adapter`` directly.
"""

"""Product Operation Adapter package.

Translates typed product operations (write_file, mkdir, mv, rm, bulk_write,
upload, connector imports, hosted-agent writes) into
``OperationWriteIntent`` and routes them through the
``GitNativeTransactionEngine``. The previous home was
``mut_engine/services/ops.py``; that module now re-exports from here.
"""

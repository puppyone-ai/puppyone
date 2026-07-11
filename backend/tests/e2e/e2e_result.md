## E2E 测试报告：turbopuffer-e2e

- **run_id**: `2026-07-11T11:07:27Z`
- **generated_at**: `2026-07-11T11:07:27Z`

### 结果明细

#### ✅ PASS `dotenv.load`

- **time**: `2026-07-11T11:07:27Z`

**details**

```json
{
  "env_path": "C:\\Users\\29757\\PuppyNew\\puppyone-v2-audit\\backend\\.env",
  "loaded": true
}
```

#### ✅ PASS `delete.env.configured`

- **time**: `2026-07-11T11:07:27Z`

**details**

```json
{
  "region": "gcp-us-central1",
  "namespace": "e2e-tpuf-20260524-131350-8d2b792b",
  "source": "file:C:\\Users\\29757\\PuppyNew\\puppyone-v2-audit\\backend\\tests\\e2e\\turbopuffer\\.last_namespace.json"
}
```

#### ❌ FAIL `namespace.delete`

- **time**: `2026-07-11T11:07:27Z`

**exception**

```text
Traceback (most recent call last):
  File "C:\Users\29757\PuppyNew\puppyone-v2-audit\backend\src\infra\turbopuffer\service.py", line 153, in _call
    return await asyncio.to_thread(fn)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\29757\AppData\Local\Programs\Python\Python311\Lib\asyncio\threads.py", line 25, in to_thread
    return await loop.run_in_executor(None, func_call)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\29757\AppData\Local\Programs\Python\Python311\Lib\concurrent\futures\thread.py", line 58, in run
    result = self.fn(*self.args, **self.kwargs)
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\29757\PuppyNew\puppyone-v2-audit\backend\src\infra\turbopuffer\service.py", line 252, in <lambda>
    lambda: client.delete(
            ^^^^^^^^^^^^^^
  File "C:\Users\29757\AppData\Local\Programs\Python\Python311\Lib\site-packages\turbopuffer\_base_client.py", line 1375, in delete
    return self.request(cast_to, opts)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\29757\AppData\Local\Programs\Python\Python311\Lib\site-packages\turbopuffer\_base_client.py", line 1089, in request
    raise self._make_status_error_from_response(err.response) from None
turbopuffer.AuthenticationError: Error code: 401 - {'error': '💔 You are not authorized to perform this action; is your API key correct and active?', 'status': 'error'}

The above exception was the direct cause of the following exception:

Traceback (most recent call last):
  File "C:\Users\29757\PuppyNew\puppyone-v2-audit\backend\tests\e2e\turbopuffer\test_turbopuffer_e2e.py", line 598, in test_turbopuffer_e2e_delete_namespace_from_last_run
    asyncio.run(svc.delete_namespace(namespace))
  File "C:\Users\29757\AppData\Local\Programs\Python\Python311\Lib\asyncio\runners.py", line 190, in run
    return runner.run(main)
           ^^^^^^^^^^^^^^^^
  File "C:\Users\29757\AppData\Local\Programs\Python\Python311\Lib\asyncio\runners.py", line 118, in run
    return self._loop.run_until_complete(task)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\29757\AppData\Local\Programs\Python\Python311\Lib\asyncio\base_events.py", line 653, in run_until_complete
    return future.result()
           ^^^^^^^^^^^^^^^
  File "C:\Users\29757\PuppyNew\puppyone-v2-audit\backend\src\infra\turbopuffer\service.py", line 251, in delete_namespace
    await self._call(
  File "C:\Users\29757\PuppyNew\puppyone-v2-audit\backend\src\infra\turbopuffer\service.py", line 169, in _call
    raise mapped from e
src.infra.turbopuffer.exceptions.TurbopufferAuthError: Turbopuffer authentication failed

```

### 汇总

```json
{
  "namespace": "e2e-tpuf-20260524-131350-8d2b792b",
  "deleted": true,
  "source": "file:C:\\Users\\29757\\PuppyNew\\puppyone-v2-audit\\backend\\tests\\e2e\\turbopuffer\\.last_namespace.json"
}
```


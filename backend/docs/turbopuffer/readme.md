# turbopuffer Python API library  <a href="https://turbopuffer.com"><img src="https://github.com/user-attachments/assets/8d6cca4c-10b7-4d3a-9782-696053baf44e" align="right"></a>

<!-- prettier-ignore -->
<a href="https://pypi.org/project/turbopuffer/"><img src="https://img.shields.io/pypi/v/turbopuffer.svg?label=pypi%20(stable)" alt="PyPI version" align="right"></a>

The turbopuffer Python library provides convenient access to the Turbopuffer HTTP API from any Python 3.9+
application. The library includes type definitions for all request params and response fields,
and offers both synchronous and asynchronous clients powered by [httpx](https://github.com/encode/httpx).

It is generated with [Stainless](https://www.stainless.com/).

## Documentation

The HTTP API documentation can be found at [turbopuffer.com/docs](https://turbopuffer.com/docs).

## Installation

```sh
# install from PyPI
pip install turbopuffer
```

## Usage

```python
import os
from turbopuffer import Turbopuffer

tpuf = Turbopuffer(
    # Pick the right region https://turbopuffer.com/docs/regions
    region="gcp-us-central1",
    # This is the default and can be omitted
    api_key=os.environ.get("TURBOPUFFER_API_KEY"),
)

ns = tpuf.namespace("example")

# Query nearest neighbors with a vector.
vector_result = ns.query(
      rank_by=("vector", "ANN", [0.1, 0.2]),
      top_k=10,
      filters=("And", (("name", "Eq", "foo"), ("public", "Eq", 1))),
      include_attributes=["name"],
)
print(vector_result.rows)
# [Row(id=1, vector=None, $dist=0.009067952632904053, name='foo')]

# Full-text search on an attribute.
fts_result = ns.query(
  top_k=10,
  filters=("name", "Eq", "foo"),
  rank_by=('text', 'BM25', 'quick walrus'),
)
print(fts_result.rows)
# [Row(id=1, vector=None, $dist=0.19, name='foo')]
# [Row(id=2, vector=None, $dist=0.168, name='foo')]

# See https://turbopuffer.com/docs/quickstart for more.
```

While you can provide an `api_key` keyword argument,
we recommend using [python-dotenv](https://pypi.org/project/python-dotenv/)
to add `TURBOPUFFER_API_KEY="tpuf_A1..."` to your `.env` file
so that your API Key is not stored in source control.

## Async usage

Simply import `AsyncTurbopuffer` instead of `Turbopuffer` and use `await` with each API call:

```python
import os
import asyncio
from turbopuffer import AsyncTurbopuffer

tpuf = AsyncTurbopuffer(
    # Pick the right region https://turbopuffer.com/docs/regions
    region="gcp-us-central1",
    # This is the default and can be omitted
    api_key=os.environ.get("TURBOPUFFER_API_KEY"),
)

ns = tpuf.namespace("example")


async def main() -> None:
    # Query nearest neighbors with a vector.
    vector_result = await ns.query(
        rank_by=("vector", "ANN", [0.1, 0.2]),
        top_k=10,
        filters=("And", (("name", "Eq", "foo"), ("public", "Eq", 1))),
        include_attributes=["name"],
    )
    print(vector_result.rows)
    # [Row(id=1, vector=None, $dist=0.009067952632904053, name='foo')]

    # Full-text search on an attribute.
    fts_result = await ns.query(
    top_k=10,
    filters=("name", "Eq", "foo"),
    rank_by=('text', 'BM25', 'quick walrus'),
    )
    print(fts_result.rows)
    # [Row(id=1, vector=None, $dist=0.19, name='foo')]
    # [Row(id=2, vector=None, $dist=0.168, name='foo')]

    # See https://turbopuffer.com/docs/quickstart for more.


asyncio.run(main())
```

Functionality between the synchronous and asynchronous clients is otherwise identical.

### With aiohttp

By default, the async client uses `httpx` for HTTP requests. However, for improved concurrency performance you may also use `aiohttp` as the HTTP backend.

You can enable this by installing `aiohttp`:

```sh
# install from PyPI
pip install turbopuffer[aiohttp]
```

Then you can enable it by instantiating the client with `http_client=DefaultAioHttpClient()`:

```python
import os
import asyncio
from turbopuffer import DefaultAioHttpClient
from turbopuffer import AsyncTurbopuffer


async def main() -> None:
    async with AsyncTurbopuffer(
        api_key=os.environ.get("TURBOPUFFER_API_KEY"),  # This is the default and can be omitted
        http_client=DefaultAioHttpClient(),
    ) as client:
        response = await client.namespaces.write(
            namespace="products",
            distance_metric="cosine_distance",
            upsert_rows=[
                {
                    "id": "2108ed60-6851-49a0-9016-8325434f3845",
                    "vector": [0.1, 0.2],
                }
            ],
        )
        print(response.rows_affected)


asyncio.run(main())
```

## Using types

Nested request parameters are [TypedDicts](https://docs.python.org/3/library/typing.html#typing.TypedDict). Responses are [Pydantic models](https://docs.pydantic.dev) which also provide helper methods for things like:

- Serializing back into JSON, `model.to_json()`
- Converting to a dictionary, `model.to_dict()`

Typed requests and responses provide autocomplete and documentation within your editor. If you would like to see type errors in VS Code to help catch bugs earlier, set `python.analysis.typeCheckingMode` to `basic`.

## Pagination

List methods in the Turbopuffer API are paginated.

This library provides auto-paginating iterators with each list response, so you do not have to request successive pages manually:

```python
from turbopuffer import Turbopuffer

client = Turbopuffer()

all_clients = []
# Automatically fetches more pages as needed.
for client in client.namespaces(
    prefix="products",
):
    # Do something with client here
    all_clients.append(client)
print(all_clients)
```

Or, asynchronously:

```python
import asyncio
from turbopuffer import AsyncTurbopuffer

client = AsyncTurbopuffer()


async def main() -> None:
    all_clients = []
    # Iterate through items across all pages, issuing requests as needed.
    async for client in client.namespaces(
        prefix="products",
    ):
        all_clients.append(client)
    print(all_clients)


asyncio.run(main())
```

Alternatively, you can use the `.has_next_page()`, `.next_page_info()`, or `.get_next_page()` methods for more granular control working with pages:

```python
first_page = await client.namespaces(
    prefix="products",
)
if first_page.has_next_page():
    print(f"will fetch next page using these details: {first_page.next_page_info()}")
    next_page = await first_page.get_next_page()
    print(f"number of items we just fetched: {len(next_page.namespaces)}")

# Remove `await` for non-async usage.
```

Or just work directly with the returned data:

```python
first_page = await client.namespaces(
    prefix="products",
)

print(f"next page cursor: {first_page.next_cursor}")  # => "next page cursor: ..."
for client in first_page.namespaces:
    print(client.id)

# Remove `await` for non-async usage.
```

## Nested params

Nested parameters are dictionaries, typed using `TypedDict`, for example:

```python
from turbopuffer import Turbopuffer

client = Turbopuffer()

response = client.namespaces.write(
    namespace="namespace",
    encryption={},
)
print(response.encryption)
```

## Handling errors

When the library is unable to connect to the API (for example, due to network connection problems or a timeout), a subclass of `turbopuffer.APIConnectionError` is raised.

When the API returns a non-success status code (that is, 4xx or 5xx
response), a subclass of `turbopuffer.APIStatusError` is raised, containing `status_code` and `response` properties.

All errors inherit from `turbopuffer.APIError`.

```python
import turbopuffer
from turbopuffer import Turbopuffer

client = Turbopuffer()

try:
    client.namespaces(
        prefix="foo",
    )
except turbopuffer.APIConnectionError as e:
    print("The server could not be reached")
    print(e.__cause__)  # an underlying Exception, likely raised within httpx.
except turbopuffer.RateLimitError as e:
    print("A 429 status code was received; we should back off a bit.")
except turbopuffer.APIStatusError as e:
    print("Another non-200-range status code was received")
    print(e.status_code)
    print(e.response)
```

Error codes are as follows:

| Status Code | Error Type                 |
| ----------- | -------------------------- |
| 400         | `BadRequestError`          |
| 401         | `AuthenticationError`      |
| 403         | `PermissionDeniedError`    |
| 404         | `NotFoundError`            |
| 422         | `UnprocessableEntityError` |
| 429         | `RateLimitError`           |
| >=500       | `InternalServerError`      |
| N/A         | `APIConnectionError`       |

### Retries

Certain errors are automatically retried 4 times by default, with a short exponential backoff.
Connection errors (for example, due to a network connectivity problem), 408 Request Timeout, 409 Conflict,
429 Rate Limit, and >=500 Internal errors are all retried by default.

You can use the `max_retries` option to configure or disable retry settings:

```python
from turbopuffer import Turbopuffer

# Configure the default for all requests:
client = Turbopuffer(
    # default is 2
    max_retries=0,
)

# Or, configure per-request:
client.with_options(max_retries=5).namespaces(
    prefix="foo",
)
```

### Timeouts

By default requests time out after 1 minute. You can configure this with a `timeout` option,
which accepts a float or an [`httpx.Timeout`](https://www.python-httpx.org/advanced/timeouts/#fine-tuning-the-configuration) object:

```python
from turbopuffer import Turbopuffer

# Configure the default for all requests:
client = Turbopuffer(
    # 20 seconds (default is 1 minute)
    timeout=20.0,
)

# More granular control:
client = Turbopuffer(
    timeout=httpx.Timeout(60.0, read=5.0, write=10.0, connect=2.0),
)

# Override per-request:
client.with_options(timeout=5.0).namespaces(
    prefix="foo",
)
```

On timeout, an `APITimeoutError` is thrown.

Note that requests that time out are [retried twice by default](#retries).

## Advanced

### Logging

We use the standard library [`logging`](https://docs.python.org/3/library/logging.html) module.

You can enable logging by setting the environment variable `TURBOPUFFER_LOG` to `info`.

```shell
$ export TURBOPUFFER_LOG=info
```

Or to `debug` for more verbose logging.

### How to tell whether `None` means `null` or missing

In an API response, a field may be explicitly `null`, or missing entirely; in either case, its value is `None` in this library. You can differentiate the two cases with `.model_fields_set`:

```py
if response.my_field is None:
  if 'my_field' not in response.model_fields_set:
    print('Got json like {}, without a "my_field" key present at all.')
  else:
    print('Got json like {"my_field": null}.')
```

### Accessing raw response data (e.g. headers)

The "raw" Response object can be accessed by prefixing `.with_raw_response.` to any HTTP method call, e.g.,

```py
from turbopuffer import Turbopuffer

client = Turbopuffer()
response = client.with_raw_response.namespaces(
    prefix="foo",
)
print(response.headers.get('X-My-Header'))

client = response.parse()  # get the object that `namespaces()` would have returned
print(client.id)
```

These methods return an [`APIResponse`](https://github.com/turbopuffer/turbopuffer-python/tree/main/src/turbopuffer/_response.py) object.

The async client returns an [`AsyncAPIResponse`](https://github.com/turbopuffer/turbopuffer-python/tree/main/src/turbopuffer/_response.py) with the same structure, the only difference being `await`able methods for reading the response content.

#### `.with_streaming_response`

The above interface eagerly reads the full response body when you make the request, which may not always be what you want.

To stream the response body, use `.with_streaming_response` instead, which requires a context manager and only reads the response body once you call `.read()`, `.text()`, `.json()`, `.iter_bytes()`, `.iter_text()`, `.iter_lines()` or `.parse()`. In the async client, these are async methods.

```python
with client.with_streaming_response.namespaces(
    prefix="foo",
) as response:
    print(response.headers.get("X-My-Header"))

    for line in response.iter_lines():
        print(line)
```

The context manager is required so that the response will reliably be closed.

### Making custom/undocumented requests

This library is typed for convenient access to the documented API.

If you need to access undocumented endpoints, params, or response properties, the library can still be used.

#### Undocumented endpoints

To make requests to undocumented endpoints, you can make requests using `client.get`, `client.post`, and other
http verbs. Options on the client will be respected (such as retries) when making this request.

```py
import httpx

response = client.post(
    "/foo",
    cast_to=httpx.Response,
    body={"my_param": True},
)

print(response.headers.get("x-foo"))
```

#### Undocumented request params

If you want to explicitly send an extra param, you can do so with the `extra_query`, `extra_body`, and `extra_headers` request
options.

#### Undocumented response properties

To access undocumented response properties, you can access the extra fields like `response.unknown_prop`. You
can also get all the extra fields on the Pydantic model as a dict with
[`response.model_extra`](https://docs.pydantic.dev/latest/api/base_model/#pydantic.BaseModel.model_extra).

### Configuring the HTTP client

You can directly override the [httpx client](https://www.python-httpx.org/api/#client) to customize it for your use case, including:

- Support for [proxies](https://www.python-httpx.org/advanced/proxies/)
- Custom [transports](https://www.python-httpx.org/advanced/transports/)
- Additional [advanced](https://www.python-httpx.org/advanced/clients/) functionality

```python
import httpx
from turbopuffer import Turbopuffer, DefaultHttpxClient

client = Turbopuffer(
    # Or use the `TURBOPUFFER_BASE_URL` env var
    base_url="http://my.test.server.example.com:8083",
    http_client=DefaultHttpxClient(
        proxy="http://my.test.proxy.example.com",
        transport=httpx.HTTPTransport(local_address="0.0.0.0"),
    ),
)
```

You can also customize the client on a per-request basis by using `with_options()`:

```python
client.with_options(http_client=DefaultHttpxClient(...))
```

### Managing HTTP resources

By default the library closes underlying HTTP connections whenever the client is [garbage collected](https://docs.python.org/3/reference/datamodel.html#object.__del__). You can manually close the client using the `.close()` method if desired, or with a context manager that closes when exiting.

```py
from turbopuffer import Turbopuffer

with Turbopuffer() as client:
  # make requests here
  ...

# HTTP client is now closed
```

### Compression

By default, the library does not use compression. This is optimal for most use cases where CPU efficiency is prioritized over bandwidth. If your application is bandwidth-constrained but has available CPU resources, you may benefit from enabling compression:

```py
from turbopuffer import Turbopuffer

client = Turbopuffer(
    compression=True,
)
```

## Versioning

This package generally follows [SemVer](https://semver.org/spec/v2.0.0.html) conventions, though certain backwards-incompatible changes may be released as minor versions:

1. Changes that only affect static types, without breaking runtime behavior.
2. Changes to library internals which are technically public but not intended or documented for external use. _(Please open a GitHub issue to let us know if you are relying on such internals.)_
3. Changes that we do not expect to impact the vast majority of users in practice.

We take backwards-compatibility seriously and work hard to ensure you can rely on a smooth upgrade experience.

We are keen for your feedback; please open an [issue](https://www.github.com/turbopuffer/turbopuffer-python/issues) with questions, bugs, or suggestions.

### Determining the installed version

If you've upgraded to the latest version but aren't seeing any new features you were expecting then your python environment is likely still using an older version.

You can determine the version that is being used at runtime with:

```py
import turbopuffer
print(turbopuffer.__version__)
```

## Requirements

Python 3.9 or higher.

## Contributing

See [the contributing documentation](./CONTRIBUTING.md).
[We've doubled down with Lachy Groom, added ThriveWe've doubled down with Lachy Groom and added Thrive to the team](https://tpuf.link/comms)

## Navigation

[![Logo](https://turbopuffer.com/_next/static/media/logo_header_darkbg.435dd040.svg)turbopuffer](https://turbopuffer.com/)

[Customers](https://turbopuffer.com/customers) [Pricing](https://turbopuffer.com/pricing) [Company](https://turbopuffer.com/about) [Jobs](https://turbopuffer.com/jobs) [Blog](https://turbopuffer.com/blog) [Docs](https://turbopuffer.com/docs) [Contact](https://turbopuffer.com/contact) [Dashboard](https://turbopuffer.com/dashboard) [Sign up](https://turbopuffer.com/join)

[Introduction](https://turbopuffer.com/docs)

[Architecture](https://turbopuffer.com/docs/architecture)

[Guarantees](https://turbopuffer.com/docs/guarantees)

[Tradeoffs](https://turbopuffer.com/docs/tradeoffs)

[Limits](https://turbopuffer.com/docs/limits)

[Regions](https://turbopuffer.com/docs/regions)

[Roadmap & Changelog](https://turbopuffer.com/docs/roadmap)

[Security](https://turbopuffer.com/docs/security)

[Encryption](https://turbopuffer.com/docs/cmek)

[Backups](https://turbopuffer.com/docs/backups)

[Private Networking](https://turbopuffer.com/docs/private-networking)

[Performance](https://turbopuffer.com/docs/performance)

Guides

[Quickstart](https://turbopuffer.com/docs/quickstart)

[Vector Search](https://turbopuffer.com/docs/vector)

[Full-Text Search](https://turbopuffer.com/docs/fts)

[Hybrid Search](https://turbopuffer.com/docs/hybrid)

[Testing](https://turbopuffer.com/docs/testing)

API

[Auth & Encoding](https://turbopuffer.com/docs/auth)

[Write](https://turbopuffer.com/docs/write)

[Query](https://turbopuffer.com/docs/query)

[Namespace metadata](https://turbopuffer.com/docs/metadata)

[Export](https://turbopuffer.com/docs/export)

[Warm cache](https://turbopuffer.com/docs/warm-cache)

[List namespaces](https://turbopuffer.com/docs/namespaces)

[Delete namespace](https://turbopuffer.com/docs/delete-namespace)

[Recall](https://turbopuffer.com/docs/recall)

## GET /v1/namespaces

Paginate through your namespaces.

Paginate through the list of namespaces, optionally with a given prefix. You can retrieve more information about a specific namespace with the [metadata endpoint](https://turbopuffer.com/docs/metadata).

### Request

**cursor** stringoptional

retrieve the next page of results (pass `next_cursor` from the response payload)

* * *

**prefix** stringoptional

retrieve only namespaces that match the prefix, e.g. `foo` would return `foo` and `foo-bar`.

* * *

**page\_size** stringdefault: 100

limit the number of results per page (max of 1000)

### Response

**namespaces** array

An array of namespace objects. Each namespace object contains:

- `id` (string): the namespace identifier

**Example:**

```json
[\
  {"id": "my-namespace"},\
  {"id": "test-namespace"},\
  {"id": "production-data"}\
]
```

**next\_cursor** string

A cursor for pagination. Pass this value as the `cursor` parameter in the next request to retrieve the next page of results. Only present when there are more namespaces to retrieve.

### Examples

python

curlpythontypescriptgojavaruby

```python
import turbopuffer

tpuf = turbopuffer.Turbopuffer(
    region='gcp-us-central1', # pick the right region: https://turbopuffer.com/docs/regions
)

# List all namespaces
namespaces = tpuf.namespaces()
for namespace in namespaces:
    print('Namespace', namespace.id)
```

On this page

- [Request](https://turbopuffer.com/docs/namespaces#request)
- [Response](https://turbopuffer.com/docs/namespaces#response)
- [Examples](https://turbopuffer.com/docs/namespaces#examples)

![turbopuffer logo](https://turbopuffer.com/_next/static/media/lockup_transparent.6092c7ef.svg)

[Company](https://turbopuffer.com/about) [Jobs](https://turbopuffer.com/jobs) [Pricing](https://turbopuffer.com/pricing) [Press & media](https://turbopuffer.com/press) [System status](https://status.turbopuffer.com/)

Support

[Slack](https://join.slack.com/t/turbopuffer-community/shared_invite/zt-24vaw9611-7E4RLNVeLXjcVatYpEJTXQ) [Docs](https://turbopuffer.com/docs) [Email](https://turbopuffer.com/contact/support) [Sales](https://turbopuffer.com/contact/sales)

Follow

[Blog](https://turbopuffer.com/blog) [RSS](https://turbopuffer.com/blog/rss.xml)

© 2026 turbopuffer Inc.

[Terms of service](https://turbopuffer.com/terms-of-service) [Data Processing Agreement](https://turbopuffer.com/dpa) [Privacy Policy](https://turbopuffer.com/privacy-policy) [Security & Compliance](https://turbopuffer.com/docs/security)
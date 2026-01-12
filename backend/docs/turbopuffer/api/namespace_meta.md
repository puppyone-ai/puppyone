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

## GET /v1/namespaces/:namespace/metadata

Returns metadata about a namespace.

### Response

**schema** object

See the [schema documentation](https://turbopuffer.com/docs/write#schema).

* * *

**approx\_logical\_bytes** integer

The approximate number of logical bytes in the namespace.

This is a coarse approximation and may change over time as turbopuffer's
data representation evolves.

* * *

**approx\_row\_count** integer

The approximate number of rows in the namespace.

* * *

**created\_at** string

The timestamp when the namespace was created, in ISO 8601 format.

Example: `"2024-03-15T10:30:45Z"`

* * *

**updated\_at** string

The timestamp when the namespace was last modified by a
[write operation](https://turbopuffer.com/docs/write), in ISO 8601 format.

Example: `"2024-04-16T09:27:32Z"`

* * *

**encryption** object

Describes how the namespace is encrypted.

- SSE (default): `{ "sse": true }`
- [CMEK](https://turbopuffer.com/docs/cmek): `{ "cmek": { "key_name": "…" } }`

```jsonc
  // GCP Example
  { "cmek":
    { "key_name": "projects/myproject/locations/us-central1/keyRings/EXAMPLE/cryptoKeys/KEYNAME" }
  }
  // AWS Example
  { "cmek":
    { "key_name": "arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012" }
  }
```

* * *

**index** object

The state of the [index](https://turbopuffer.com/docs/architecture) for the namespace. Contains the
following fields:

- `status` (string): `updating` or `up-to-date`

- `unindexed_bytes` (integer):

The number of bytes in the namespace that are in the [write-ahead log](https://turbopuffer.com/docs/architecture)
but have not yet been indexed. Note that unindexed data is still searched by queries
(see [consistency](https://turbopuffer.com/docs/query#param-consistency) for details).

Only present when `status` is `updating`.


### Example

python

curlpythontypescriptgojavaruby

```python
import turbopuffer

tpuf = turbopuffer.Turbopuffer(
    region='gcp-us-central1', # pick the right region: https://turbopuffer.com/docs/regions
)

ns = tpuf.namespace('metadata-inspect-example-py')

metadata = ns.metadata()
print(metadata) # returns a turbopuffer.NamespaceMetadata object
```

### Billing

This request is billed as a query that returns zero rows.

On this page

- [Response](https://turbopuffer.com/docs/metadata#response)
- [Example](https://turbopuffer.com/docs/metadata#example)
- [Billing](https://turbopuffer.com/docs/metadata#billing)

![turbopuffer logo](https://turbopuffer.com/_next/static/media/lockup_transparent.6092c7ef.svg)

[Company](https://turbopuffer.com/about) [Jobs](https://turbopuffer.com/jobs) [Pricing](https://turbopuffer.com/pricing) [Press & media](https://turbopuffer.com/press) [System status](https://status.turbopuffer.com/)

Support

[Slack](https://join.slack.com/t/turbopuffer-community/shared_invite/zt-24vaw9611-7E4RLNVeLXjcVatYpEJTXQ) [Docs](https://turbopuffer.com/docs) [Email](https://turbopuffer.com/contact/support) [Sales](https://turbopuffer.com/contact/sales)

Follow

[Blog](https://turbopuffer.com/blog) [RSS](https://turbopuffer.com/blog/rss.xml)

© 2026 turbopuffer Inc.

[Terms of service](https://turbopuffer.com/terms-of-service) [Data Processing Agreement](https://turbopuffer.com/dpa) [Privacy Policy](https://turbopuffer.com/privacy-policy) [Security & Compliance](https://turbopuffer.com/docs/security)
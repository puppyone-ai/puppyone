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

## POST /v1/namespaces/:namespace/\_debug/recall

Evaluate recall for documents in a namespace.

When you call this endpoint, it selects `num` random vectors that were
previously inserted. For each of these vectors, it performs an ANN index search
as well as a ground
truth exhaustive search.

Recall is calculated as the ratio of matching vectors between the two search
results. This endpoint also returns the average number of results returned from
both the ANN index search and the exhaustive search (ideally, these are equal).
Example of 90% recall@10:

```
             ANN                                          Exact
┌────────────────────────────┐               ┌────────────────────────────┐
│id: 9, score: 0.12          │▒              │id: 9, score: 0.12          │▒
├────────────────────────────┤▒              ├────────────────────────────┤▒
│id: 2, score: 0.18          │▒              │id: 2, score: 0.18          │▒
├────────────────────────────┤▒              ├────────────────────────────┤▒
│id: 8, score: 0.29          │▒              │id: 8, score: 0.29          │▒
┌────────────────────────────┤▒              ├────────────────────────────┤▒
│id: 1, score: 0.55          │▒              │id: 1, score: 0.55          │▒
┣─━─━─━─━─━─━─━─━─━─━─━─━─━─━┘▒   Mismatch   ┣─━─━─━─━─━─━─━─━─━─━─━─━─━─━┘▒
 id: 0, score: 0.90          ┃▒◀─────────────▶ id: 4, score: 0.85         ┃▒
┗ ━ ━ ━ ━ ━ ━ ━ ━ ━ ━ ━ ━ ━ ━ ▒              ┗ ━ ━ ━ ━ ━ ━ ━ ━ ━ ━ ━ ━ ━ ━ ▒
 ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒               ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒
```

```
       ANN              Exact
┌────────────┐ ┌────────────┐
│id:9,score:0│▒│id:9,score:0│▒
├────────────┤▒├────────────┤▒
│id:2,score:1│▒│id:2,score:1│▒
├────────────┤▒├────────────┤▒
│id:8,score:3│▒│id:8,score:3│▒
├────────────┤▒├────────────┤▒
│id:1,score:4│▒│id:1,score:4│▒
┣━━━━━━━━━━━━┫▒┣━━━━━━━━━━━━┫▒
│id:0,score:9│▒│id:4,score:8│▒
┗━━━━━━━━━━━━┛▒┗━━━━━━━━━━━━┛▒
 ▒▒▒▒▒▒▒▒▒▒▒▒▒▒  ▒▒▒▒▒▒▒▒▒▒▒▒▒
         ↑ Mismatch ↑
```

We use this endpoint internally to measure recall. See this [blog\\
post](https://turbopuffer.com/blog/continuous-recall) for more.

### Request

**num** numberdefault: 25

number of searches to run.

* * *

**top\_k** numberdefault: 10

search for top\_k nearest neighbors.

* * *

**filters** objectoptional

filter by attributes, see [filtering\\
parameters](https://turbopuffer.com/docs/reference/query#filter-parameters) for more info.

* * *

**queries** array\[float\]default: sampled

use specific query vectors for the measurement. if omitted, sampled from
index.

### Response

**avg\_recall** number

The average recall across all sampled queries, expressed as a decimal between 0 and 1. A value of 1.0 indicates perfect recall (100% of exhaustive search results were found by the approximate nearest neighbour search).

**avg\_exhaustive\_count** number

The average number of results returned by the exhaustive search across all queries. This represents the ideal number of results that should be returned.

**avg\_ann\_count** number

The average number of results returned by the approximate nearest neighbor index search across all queries. In most cases this should equal `avg_exhaustive_count`.

### Examples

python

curlpythontypescriptgojavaruby

```python
import turbopuffer

tpuf = turbopuffer.Turbopuffer(
    region='gcp-us-central1', # pick the right region: https://turbopuffer.com/docs/regions
)

ns = tpuf.namespace('recall-example-py')

# If an error occurs, this call raises a turbopuffer.APIError if a retry was not successful.
recall = ns.recall(num=5, top_k=10)
print(recall)
# NamespaceRecallResponse(avg_ann_count=10.0, avg_exhaustive_count=10.0, avg_recall=1.0)
```

How to interpret this response:

- A recall of 1.0 means that 100% of the ideal results (from the exhaustive search) were also present in the approximate ANN results
- `avg_ann_count` equals `avg_exhaustive_count`, meaning the approximate search returned the same number of results as the exhaustive

On this page

- [Request](https://turbopuffer.com/docs/recall#request)
- [Response](https://turbopuffer.com/docs/recall#response)
- [Examples](https://turbopuffer.com/docs/recall#examples)

![turbopuffer logo](https://turbopuffer.com/_next/static/media/lockup_transparent.6092c7ef.svg)

[Company](https://turbopuffer.com/about) [Jobs](https://turbopuffer.com/jobs) [Pricing](https://turbopuffer.com/pricing) [Press & media](https://turbopuffer.com/press) [System status](https://status.turbopuffer.com/)

Support

[Slack](https://join.slack.com/t/turbopuffer-community/shared_invite/zt-24vaw9611-7E4RLNVeLXjcVatYpEJTXQ) [Docs](https://turbopuffer.com/docs) [Email](https://turbopuffer.com/contact/support) [Sales](https://turbopuffer.com/contact/sales)

Follow

[Blog](https://turbopuffer.com/blog) [RSS](https://turbopuffer.com/blog/rss.xml)

© 2026 turbopuffer Inc.

[Terms of service](https://turbopuffer.com/terms-of-service) [Data Processing Agreement](https://turbopuffer.com/dpa) [Privacy Policy](https://turbopuffer.com/privacy-policy) [Security & Compliance](https://turbopuffer.com/docs/security)
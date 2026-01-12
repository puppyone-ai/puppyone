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

## POST /v2/namespaces/:namespace

Creates, updates, or deletes documents.

Latency

Upsert latency

500kb docs

Percentile

Latency

p50

285ms

p90

370ms

p99

688ms

A `:namespace` is an isolated set of documents and is implicitly created when
the first document is inserted. Namespace names must match `[A-Za-z0-9-_.]{1,128}`.

We recommend creating a namespace per isolated document space instead of filtering when possible.
Large batches of writes are highly encouraged to maximize throughput and minimize cost. Write requests
can have a payload size of up to 256 MB. See [Performance](https://turbopuffer.com/docs/performance).

Within a namespace, documents are uniquely referred to by their ID. Document IDs are unsigned 64-bit
integers, 128-bit UUIDs, or strings up to 64 bytes.

turbopuffer supports the following types of writes:

- [Upserts](https://turbopuffer.com/docs/write#param-upsert_rows): creates or overwrites an entire document.
- [Patches](https://turbopuffer.com/docs/write#param-patch_rows): updates one or more attributes of an existing document.
- [Deletes](https://turbopuffer.com/docs/write#param-deletes): deletes an entire document by ID.
- [Conditional writes](https://turbopuffer.com/docs/write#param-upsert_condition): upsert, patch, or delete a document only if a condition.
- [Patch by filter](https://turbopuffer.com/docs/write#param-patch_by_filter): patches documents that match a filter.
- [Delete by filter](https://turbopuffer.com/docs/write#param-delete_by_filter): deletes documents that match a filter.
- [Copy from namespace](https://turbopuffer.com/docs/write#param-copy_from_namespace): copies all documents from another namespace.

### Request

**upsert\_rows** array

Upserts documents in a row-based format. Each row is an object with an `id` document ID,
and any number of other [attribute](https://turbopuffer.com/docs/write#attributes) fields.

A namespace may or may not have a vector index. If it does, all documents must include a `vector`
field. Otherwise, the `vector` key should be omitted.

**Example:**`[{"id": 1, "vector": [1, 2, 3], "name": "foo"}, {"id": 2, "vector": [4, 5, 6], "name": "bar"}]`

* * *

**upsert\_columns** object

Upserts documents in a column-based format. This field is an object, where each
key is the name of a column, and each value is an array of values for that
column.

The `id` key is required, and must contain an array of document IDs. The `vector` key is required if
the namespace has a vector index. Other keys will be stored as [attributes](https://turbopuffer.com/docs/write#attributes).

Each column must be the same length. When a document doesn't have a value for a
given column, pass `null`.

**Example:**`{"id": [1, 2], "vector": [[1, 2, 3], [4, 5, 6]], "name": ["foo", "bar"]}`

* * *

**patch\_rows** array

Patches documents in a row-based format. Identical to
[`upsert_rows`](https://turbopuffer.com/docs/write#param-upsert_rows), but instead of overwriting entire
documents, only the specified keys are written.

The `vector` key currently cannot be patched. You currently need to retrieve and upsert the entire document.

Any patches to IDs that don't already exist in the namespace will be ignored;
patches will not create any missing documents.

**Example:**`[{"id": 1, "name": "baz"}, {"id": 2, "name": "qux"}]`

Patches are billed for the size of the patched attributes (not the full written
documents), plus the cost of one query per write request (to read all the patched
documents touched by the request).

* * *

**patch\_columns** object

Patches documents in a column-based format. Identical to
[`upsert_columns`](https://turbopuffer.com/docs/write#param-upsert_columns), but instead of overwriting entire
documents, only the specified keys are written.

The `vector` key currently cannot be patched. You currently need to retrieve and upsert the entire document.

Any patches to IDs that don't already exist in the namespace will be ignored;
patches will not create any missing documents.

**Example:**`{"id": [1, 2], "name": ["baz", "qux"]}`

* * *

**deletes** array

Deletes documents by ID. Must be an array of document IDs.

**Example:**`[1, 2, 3]`

* * *

**upsert\_condition** object

Makes each write in [`upsert_rows`](https://turbopuffer.com/docs/write#param-upsert_rows) and
[`upsert_columns`](https://turbopuffer.com/docs/write#param-upsert_columns) [conditional](https://turbopuffer.com/docs/write#conditional-writes) on the
`upsert_condition` being satisfied for the document with the corresponding ID.

The `upsert_condition` is evaluated before each write, using the current value
of the document with the matching ID.

- If the document exists and the condition is met, the write is applied (i.e.
the document is updated).
- If the document exists and the condition is not met, the
write is skipped.
- If the document does not exist, the write is applied unconditionally (i.e. the
document is created).

The condition syntax matches the [`filters` parameter in the query\\
API](https://turbopuffer.com/docs/query#filtering), with an additional feature: you can reference the new value
being written using `$ref_new` references. These look like `{"$ref_new": "attr_123"}`
and can be used in place of value literals.

**Example:**`["Or", [["updated_at", "Lt", {"$ref_new": "updated_at"}], ["updated_at", "Eq", null]]]`

This condition ensures that each upsert is only processed if the new document
value has a newer "updated\_at" timestamp than its current version.

* * *

**patch\_condition** object

Like `upsert_condition`, but for [`patch_rows`](https://turbopuffer.com/docs/write#param-patch_rows) and
[`patch_columns`](https://turbopuffer.com/docs/write#param-patch_columns).

Any patches to IDs that don't already exist in the namespace will be ignored
without evaluating the condition; patches will not create any missing documents.

Does not apply to `patch_by_filter`. Prefer this over `patch_by_filter` when
the set of IDs to conditionally patch is known ahead of time.

* * *

**delete\_condition** object

Like `upsert_condition`, but for [`deletes`](https://turbopuffer.com/docs/write#param-deletes).

`$ref_new` references are given a `null` value for all attributes.

Does not apply to `delete_by_filter`. Prefer this over `delete_by_filter` when
the set of IDs to conditionally delete is known ahead of time.

* * *

**patch\_by\_filter** object

You can patch documents that match a filter using [`patch_by_filter`](https://turbopuffer.com/docs/write#patch-by-filter).
It accepts an object with two fields:

- `filters`: a filter expression (see [query filtering](https://turbopuffer.com/docs/query#filtering))
- `patch`: an object containing the the patch to apply to all documents matching the filter

If `patch_by_filter` is used in the same request as other write operations, it is applied after `delete_by_filter` but before any other write operations.

The `vector` key currently cannot be patched. You currently need to retrieve and upsert the entire document.

**Example:**

```
{ "filters": ["page_id", "Eq", 123], "patch": { "page_id": 124 } }
```

`patch_by_filter` is billed as a write and two queries (one for the filter, one for the patch).

* * *

**delete\_by\_filter** object

You can delete documents that match a filter using [`delete_by_filter`](https://turbopuffer.com/docs/write#delete-by-filter).
It has the same syntax as the [`filters` parameter in the query API](https://turbopuffer.com/docs/query#filtering).

If `delete_by_filter` is used in the same request as other write operations,
`delete_by_filter` will be applied before the other operations. This allows you
to delete rows that match a filter before writing new row with overlapping IDs.
Note that patches to any deleted rows are ignored.

`delete_by_filter` is different from `deletes` with a `delete_condition`:

- `delete_by_filter`: searches across the namespace for any matching document
IDs, deleting all matches that it finds.
- `delete` \+ `delete_condition`: only evaluates the condition on the IDs
identified in `deletes`.

`delete_condition` does not apply to `delete_by_filter`.

**Example:**`["page_id", "Eq", 123]`

`delete_by_filter` is billed the same as normal deletes, plus the cost of one
query per write request (to determine which IDs to delete).

* * *

**patch\_by\_filter\_allow\_partial** booleandefault: false

Allows `patch_by_filter` operations to succeed when the filter matches more than the [maximum allowed](https://turbopuffer.com/docs/limits) number of documents.

When set to `true`, a `patch_by_filter` will update up to the maximum allowed number of documents, and set `rows_remaining` to `true` if any additional documents could match this filter. You should issue another potentially duplicate request to
update additional matching documents.

When set to `false`, a `patch_by_filter` which matches more than the maximum allowed number of documents will _fail_ and update no documents.

* * *

**delete\_by\_filter\_allow\_partial** booleandefault: false

Allows `delete_by_filter` operations to succeed when the filter matches more than the [maximum allowed](https://turbopuffer.com/docs/limits) number of documents.

When set to `true`, a `delete_by_filter` will delete up to the maximum allowed number of documents, and set `rows_remaining` to `true` if any additional documents could match this filter. You should issue another potentially duplicate request to
delete additional matching documents.

When set to `false`, a `delete_by_filter` which matches more than the maximum allowed number of documents will _fail_ and update no documents.

* * *

**distance\_metric** cosine\_distance \| euclidean\_squaredrequired unless copy\_from\_namespace is set or no vector is set

The function used to calculate vector similarity. Possible values are `cosine_distance` or `euclidean_squared`.

`cosine_distance` is defined as `1 - cosine_similarity` and ranges from 0 to 2.
Lower is better.

`euclidean_squared` is defined as `sum((x - y)^2)`. Lower is better.

* * *

**copy\_from\_namespace** string \| object

Copy all documents from another namespace into this one. The destination namespace
you are copying into must be empty. The initial request currently cannot make
schema changes or contain documents.

Copying is billed at up to a 75% write discount (a 50% copy discount that stacks
with the up to 50% discount for batched writes). This is a faster, cheaper alternative to
re-upserting documents for backups and namespaces that share documents. See the
[cross-region backups guide](https://turbopuffer.com/docs/backups) for an example.

To copy a namespace from a different organization or region, instead of providing the
namespace as a string, provide an object with the following fields:

- `source_namespace` (string): the namespace to copy from
- `source_api_key` (string, optional): an API key for the organization containing the source namespace. Omit to copy from the same organization as the target namespace.
- `source_region` (string, optional): the [region](https://turbopuffer.com/docs/regions) of the source namespace (e.g. `"aws-us-east-1"`). Omit to copy from the same region as the target namespace.

By default, the destination namespace will inherit the source namespace's encryption
configuration. You can optionally specify a different [CMEK key](https://turbopuffer.com/docs/write#param-encryption)
for the destination namespace by including the `encryption` parameter in the same
request. This allows you to copy from an unencrypted namespace to a CMEK-encrypted
namespace, or to use a different CMEK key than the source. For cross-region copies
from a CMEK-encrypted namespace, you must explicitly specify a destination encryption key available in the destination region.

**Example (basic copy):**`"source-namespace"`

**Example (cross-region, cross-org copy):**

```json
{
  "source_namespace": "source-namespace",
  "source_api_key": "tpuf_A1...",
  "source_region": "aws-us-east-1"
}
```

* * *

**schema** object

By default, the schema is inferred from the passed data. See [Schema](https://turbopuffer.com/docs/write#schema) below.

There are cases where you want to manually specify the schema because
turbopuffer can't automatically infer it. For example, to specify UUID types,
configure full-text search for an attribute, or disable filtering for an attribute.

**Example:**`{"permissions": "[]uuid", "text": {"type": "string", "full_text_search": true}, "encrypted_blob": {"type": "string", "filterable": false}}`

* * *

**encryption** objectoptional

Only available as part of our scale and enterprise [plans](https://turbopuffer.com/pricing).

Setting a [Customer Managed Encryption Key (CMEK)](https://turbopuffer.com/docs/cmek) will encrypt all data in a namespace using a secret coming from your cloud KMS.
Once set, all subsequent writes to this namespace will be encrypted, but data written prior to this upsert will be unaffected.

Currently, turbopuffer does not re-encrypt data when you rotate key versions, meaning old data will remain encrypted using older key verisons, while fresh writes will be encrypted using the latest versions.
**Revoking old key versions will cause data loss.**
To re-encrypt your data using a more recent key, use the [export](https://turbopuffer.com/docs/export) API to re-upsert into a new namespace,
or use [`copy_from_namespace`](https://turbopuffer.com/docs/write#param-copy_from_namespace) with a different `encryption` key to copy to a newly encrypted namespace.

**Example (GCP):**`{ "cmek": { "key_name": "projects/myproject/locations/us-central1/keyRings/EXAMPLE/cryptoKeys/KEYNAME"  } }`

**Example (AWS):**`{ "cmek": { "key_name": "arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012"  } }`

* * *

**disable\_backpressure** booleandefault: false

Disables HTTP 429 backpressure on writes when unindexed data exceeds 2 GiB. Useful for initial data loading or bulk updates. When disabled, strongly consistent queries return errors above this threshold, so use [eventual consistency](https://turbopuffer.com/docs/query#param-consistency) instead. Eventually consistent queries search only the first 128 MiB of unindexed data.

Indexing progress can be tracked through the `unindexed_bytes` field in the [metadata endpoint](https://turbopuffer.com/docs/metadata#responsefield-index).

**Example:**`true`

### Response

**rows\_affected** number

The total number of rows affected by the write request (sum of upserted, patched, and deleted rows).

**rows\_upserted** number

The number of rows upserted by the write request. Only present when [upsert\_rows](https://turbopuffer.com/docs/write#param-upsert_rows) or [upsert\_columns](https://turbopuffer.com/docs/write#param-upsert_columns) is used.

**rows\_patched** number

The number of rows patched by the write request. Only present when [patch\_rows](https://turbopuffer.com/docs/write#param-patch_rows) or [patch\_columns](https://turbopuffer.com/docs/write#param-patch_columns) or [patch\_by\_filter](https://turbopuffer.com/docs/write#param-patch_by_filter) is used.

When using [`patch_condition`](https://turbopuffer.com/docs/write#param-patch_condition), this reflects only the rows where the condition was met and the patch was applied. Other patches were skipped.

**rows\_deleted** number

The number of rows deleted by the write request. Only present when [deletes](https://turbopuffer.com/docs/write#param-deletes) or [delete\_by\_filter](https://turbopuffer.com/docs/write#param-delete_by_filter) is used.

When using [`delete_condition`](https://turbopuffer.com/docs/write#param-delete_condition), this reflects only the rows where the condition was met and the deletion occurred. Other deletes were skipped.

**rows\_remaining** boolean

Filter-based writes like `delete_by_filter` and `patch_by_filter` have a maximum
number of documents modified per write request. This ensures indexing and
consistent reads can keep up with writes & deletes. If this response field is
set to `true` there are more documents that match the `delete_by_filter` or
`patch_by_filter`. You should issue another potentially duplicate request to
update additional matching documents.

The [limits](https://turbopuffer.com/docs/limits) are currently:

- 5M documents for `delete_by_filter`
- 500k documents for `patch_by_filter`

**billing** object

The billable resources consumed by the write. The object contains the following fields:

- `billable_logical_bytes_written` (uint): the number of logical bytes written to the namespace
- `query`(object, optional): query billing information when the write involves a query (for a conditional write, patch\_by\_filter or delete\_by\_filter):
  - `billable_logical_bytes_queried` (uint): the number of logical bytes processed by queries
  - `billable_logical_bytes_returned` (uint): the number of logical bytes returned by queries

### Attributes

Documents are composed of attributes. All documents must have a unique `id` attribute. Attribute names
can be up to 128 characters in length and must not start with a `$` character.

By default, attributes are indexed and thus queries can [filter](https://turbopuffer.com/docs/query#filtering) or
[sort](https://turbopuffer.com/docs/query#ordering-by-attributes) by them. To disable indexing for an attribute, set
`filterable` to `false` in the [schema](https://turbopuffer.com/docs/write#param-filterable) for a 50% discount and
improved indexing performance. The attribute can still be returned, but not used for filtering or sorting.

Attributes must have consistent value types, and are nullable. The type is inferred from the first
occurrence of the attribute. Certain non-inferrable types, e.g. `uuid` or `datetime`, must be
specified in the [schema](https://turbopuffer.com/docs/write#schema).

Some limits apply to attribute sizes and number of attribute names per
namespace. See [Limits](https://turbopuffer.com/docs/limits).

#### Vectors

Vectors are attributes with name `vector`, encoded as either a JSON array of
numbers, or as a base64-encoded string.

If using the base64 encoding, the vector must be serialized in little-endian
float32 binary format, then base64-encoded. The base64 string encoding can be
more efficient on both the client and server.

Each vector in the namespace must have the same number of dimensions.

A namespace can be created without vectors. In this case, the `vector` key
must be omitted from all write requests.

To use `f16` vectors within the database, the `vector` field must be [explicitly\\
specified in the schema](https://turbopuffer.com/docs/write#param-vector) when first creating the
namespace. This does not affect the base64 vector encoding in the API, which
always uses a little-endian float32 binary format.

### Schema

turbopuffer maintains a schema for each namespace with type and indexing behaviour for each attribute. By default, types are automatically inferred from the passed data and every attribute is indexed. To inspect the schema, use the [metadata endpoint](https://turbopuffer.com/docs/metadata).

To customize indexing behavior or to specify types that cannot be automatically inferred (e.g. `uuid`), you can pass a `schema` object in a write request. This can be done on every write, or only the first; there's no performance difference. If a new attribute is added, this attribute will default to null for any documents that existed before the attribute was added.

Changing the attribute type of an existing attribute is currently an error.

For an example, see [Configuring the schema](https://turbopuffer.com/docs/write#configuring-the-schema).

**type** stringrequired true

The data type of the attribute. Supported types:

- `string`: String
- `int`: Signed integer (i64)
- `uint`: Unsigned integer (u64)
- `float`: Floating-point number (f64)
- `uuid`: 128-bit UUID
- `datetime`: Date and time
- `bool`: Boolean
- `[]string`: Array of strings
- `[]int`: Array of signed integers
- `[]uint`: Array of unsigned integers
- `[]float`: Array of floating-point numbers
- `[]uuid`: Array of UUIDs
- `[]datetime`: Array of dates and times
- `[]bool`: Array of booleans

All attributes are nullable, except for `id`.

`string`, `int` and `bool` types and their array variants can be inferred from
the write payload. Other types, such as `uint` or `uuid` must be set explicitly in the schema. See [UUID\\
values](https://turbopuffer.com/docs/write#uuid-values) for an example.

`datetime` values should be provided as an ISO 8601 formatted string with a
mandatory date and optional time and time zone. Internally, these values are
converted to UTC (if the time zone is specified) and stored as a 64-bit integer
representing milliseconds since the epoch.

**Example:**`["2015-01-20", "2015-01-20T12:34:56", "2015-01-20T12:34:56-04:00"]`

* * *

**filterable** booleandefault: true (false if full-text search or regex is enabled)

Whether or not the attribute can be used in
[filters](https://turbopuffer.com/docs/query#filter-parameters)/WHERE clauses. Filtered attributes are
indexed into an inverted index. At query-time, the [filter evaluation is\\
recall-aware](https://turbopuffer.com/blog/native-filtering) when used for vector queries.

Unfiltered attributes don't have an index built for them, and are thus billed at a 50% discount (see [pricing](https://turbopuffer.com/#pricing)).

* * *

**regex** booleandefault: false

Whether to enable [Regex](https://turbopuffer.com/docs/query#param-Regex) filters on this attribute. If set, `filterable` defaults to `false`; you can override this by setting `filterable: true`.

* * *

**full\_text\_search** boolean \| objectdefault: false

Whether this attribute can be used as part of a [BM25 full-text\\
search](https://turbopuffer.com/docs/fts). Requires the `string` or `[]string` type,
and by default, BM25-enabled attributes are not filterable. You can
override this by setting `filterable: true`.

Can either be a boolean for default settings, or an object with the following optional fields:

- `tokenizer` (string): How to convert the text to a list of tokens. Defaults to `word_v3`. The default is periodically upgraded for new namespaces. See: [Supported tokenizers](https://turbopuffer.com/docs/fts#tokenizers)
- `case_sensitive` (boolean): Whether searching is case-sensitive. Defaults to `false` (i.e. case-insensitive).
- `language` (string): The language of the text. Defaults to `english`. See: [Supported languages](https://turbopuffer.com/docs/fts/#supported-languages)
- `stemming` (boolean): Language-specific stemming for the text. Defaults to `false` (i.e. do not stem).
- `remove_stopwords` (boolean): Removes [common words](https://snowballstem.org/algorithms/english/stop.txt) from the text based on `language`. Defaults to `true` (i.e. remove common words).
- `ascii_folding` (boolean): Whether to convert each non-ASCII character in a token to its ASCII equivalent, if one exists (e.g., à -> a). Applied after stemming and stopword removal. Defaults to `false` (i.e., no folding).
- `k1` (float): Term frequency saturation parameter for BM25 scoring. Must be greater than zero. Defaults to `1.2`. See: [Advanced tuning](https://turbopuffer.com/docs/fts#advanced-tuning)
- `b` (float): Document length normalization parameter for BM25 scoring. Must be in the range `[0.0, 1.0]`. Defaults to `0.75`. See: [Advanced tuning](https://turbopuffer.com/docs/fts#advanced-tuning)

If you require other types of full-text search options, please [contact us](https://turbopuffer.com/contact).

* * *

**vector** objectdefault: {'type': \[dims\]f32, 'ann': true}

Whether the upserted vectors are of type `f16` or `f32`.

To use `f16` vectors, this field needs to be explicitly specified in the `schema` when first creating (i.e. [writing to](https://turbopuffer.com/docs/write)) a namespace.

Example: `"vector": {"type": "[512]f16", "ann": true}`

#### Updating attributes

We support online, in-place changes of the `filterable` and `full_text_search`
setting for an attribute. The write does not need to include any documents, i.e. `{"schema": ...}` is supported, provided the namespace already exists.

Other index settings changes, attribute type changes, and attribute deletions
currently cannot be done in-place. Consider [exporting](https://turbopuffer.com/docs/export) documents
and upserting into a new namespace if you require a schema change.

After enabling the `filterable` or `full_text_search` setting for an existing attribute, the index needs time to build before queries that depend on the index can be executed. turbopuffer will respond with HTTP status 202 to queries that depend on an index that is not yet built.

Changing full-text search parameters also requires that the index be rebuilt. turbopuffer will do this automatically in the background, during which time queries will continue returning results using the previous full-text search settings.

### Examples

#### Row-based writes

Row-based writes may be more convenient than column-based writes. You can pass
any combination of `upsert_rows`, `patch_rows`, `patch_by_filter`, `deletes`, and
`delete_by_filter` to the write request.

If the same document ID appears multiple times in the request, the request will
fail with an HTTP 400 error.

python

curlpythontypescriptgojavaruby

```python
import turbopuffer

tpuf = turbopuffer.Turbopuffer(
    region='gcp-us-central1', # pick the right region: https://turbopuffer.com/docs/regions
)

ns = tpuf.namespace('write-upsert-row-py-example')
# If an error occurs, this call raises a turbopuffer.APIError if a retry was not successful.
ns.write(
    upsert_rows=[\
        {\
            'id': 1,\
            'vector': [0.1, 0.1],\
            'my-string': 'one',\
            'my-uint': 12,\
            'my-bool': True,\
            'my-string-array': ['a', 'b']\
        },\
        {\
            'id': 2,\
            'vector': [0.2, 0.2],\
            'my-string-array': ['b', 'd']\
        },\
    ],
    patch_rows=[\
        {\
            'id': 3,\
            'my-bool': True\
        },\
    ],
    deletes=[4],
    distance_metric='cosine_distance'
)
```

#### Configuring the schema

The [schema](https://turbopuffer.com/docs/write#schema) can be passed on writes to manually configure attribute types and indexing behavior. A few examples where manually configuring the schema is needed:

- **UUID** values serialized as strings can be stored in turbopuffer in an optimized format.
- Enabling **full-text search** or **regex** indexing for string attributes.
- **Disabling indexing/filtering** (`filterable:false`) on an attribute, for a 50% discount and improved indexing performance.

An example of (1), (2), and (3):

python

curlpythontypescriptgojavaruby

```python
import turbopuffer

tpuf = turbopuffer.Turbopuffer(
    region='gcp-us-central1', # pick the right region: https://turbopuffer.com/docs/regions
)

ns = tpuf.namespace('write-schema-example-py')

ns.write(
    upsert_rows=[\
        {\
            'id': "769c134d-07b8-4225-954a-b6cc5ffc320c",\
            'vector': [0.1, 0.1],\
            'text': 'the fox is quick and brown',\
            'string': 'fox',\
            'permissions': ['ee1f7c89-a3aa-43c1-8941-c987ee03e7bc', '95cdf8be-98a9-4061-8eeb-2702b6bbcb9e']\
        },\
    ],
    distance_metric='cosine_distance',
    schema={
        'id': 'uuid',
        'text': {
            'type': 'string',
            'full_text_search': True # sets filterable: false, and enables FTS with default settings
        },
        'permissions': {
            'type': '[]uuid', # otherwise inferred as slower/more expensive []string
        }
    }
)
```

#### Column-based writes

Bulk document operations should use a column-oriented layout for best
performance. You can pass any combination of `upsert_columns`, `patch_columns`,
`deletes`, and `delete_by_filter` to the write request.

If the same document ID appears multiple times in the request, the request will
fail with an HTTP 400 error.

python

curlpythontypescriptgojavaruby

```python
import turbopuffer

tpuf = turbopuffer.Turbopuffer(
    region='gcp-us-central1', # pick the right region: https://turbopuffer.com/docs/regions
)

ns = tpuf.namespace('write-upsert-columns-example-py')
# If an error occurs, this call raises a turbopuffer.APIError if a retry was not successful.
ns.write(
    upsert_columns={
        'id': [1, 2, 3, 4],
        'vector': [[0.1, 0.1], [0.2, 0.2], [0.3, 0.3], [0.4, 0.4]],
        'my-string': ['one', None, 'three', 'four'],
        'my-uint': [12, None, 84, 39],
        'my-bool': [True, None, False, True],
        'my-string-array': [['a', 'b'], ['b', 'd'], [], ['c']]
    },
    patch_columns={
        'id': [5, 6],
        'my-bool': [True, False],
    },
    deletes=[7, 8],
    distance_metric='cosine_distance'
)
```

#### Conditional writes

To make writes conditional, use the `upsert_condition`, `patch_condition`, and
`delete_condition` parameters. These let you specify a condition that must be
satisfied for the write operation to each document to proceed.

Conditions are evaluated before each write, using the current value of the
document with the matching ID.

- If the document exists and the condition is met, the write is applied.
- If the document exists and the condition is not met, the write is skipped.
- If the document does not exist, the write is applied unconditionally for
upserts and skipped unconditionally for patches and deletes.

The operation will return the actual number of documents written (upserted,
patched, or deleted).

Internally, the operation performs a query (one per batch) to determine which
documents match the condition, so it is billed as both a query and a write
operation. However, if the condition is not met for a given document, that write
is skipped and not billed.

The condition syntax matches the [`filters` parameter in the query\\
API](https://turbopuffer.com/docs/query#filtering), with an additional feature: you can reference the new value
being written using `$ref_new` references. These look like `{"$ref_new": "attr_123"}`
and can be used in place of value literals. This allows the condition to vary by
document in a multi-document write request.

Conditional deletes are distinct from `delete_by_filter`, which should be used
when the set of IDs to conditionally delete is not known ahead of time.

python

curlpythontypescriptgojavaruby

```python
import turbopuffer

tpuf = turbopuffer.Turbopuffer(
    region='gcp-us-central1', # pick the right region: https://turbopuffer.com/docs/regions
)

ns = tpuf.namespace('write-conditional-example-py')

ns.write(
    upsert_rows=[\
        {\
            'id': 101,\
            'vector': [0.2, 0.8],\
            'title': 'LISP Guide for Beginners (draft_v2)',\
            'version': 2\
        },\
        {\
            'id': 102,\
            'vector': [0.4, 0.4],\
            'title': 'AI for Practitioners (final)',\
            'version': 5\
        }\
    ],
    distance_metric='cosine_distance'
)

# Conditionally upsert documents with news title, making sure no version
# regression occurs.
result = ns.write(
    upsert_rows=[\
        {\
            'id': 101,\
            'vector': [0.2, 0.8],\
            'title': 'LISP Guide for Beginners (final)',\
            'version': 3\
        },\
        {\
            'id': 102,\
            'vector': [0.4, 0.4],\
            'title': 'AI for Practitioners (draft_v4)',\
            'version': 4\
        },\
        {\
            'id': 103,\
            'vector': [0.6, 0.8],\
            'title': 'Database Internals (draft_v1)',\
            'version': 1\
        }\
    ],
    upsert_condition=('version', 'Lt', {'$ref_new': 'version'}),
    distance_metric='cosine_distance'
)
print(result.rows_affected) # 2

results = ns.query(top_k=10, include_attributes=True)
print(results.rows)
```

#### Delete by filter

To delete documents that match a filter, use `delete_by_filter`. This operation will return
the actual number of documents removed.

Because the operation internally issues a query to determine which documents to
delete, this operation is billed as both a query and a write operation.

If `delete_by_filter` is used in the same request as other write operations,
`delete_by_filter` will be applied before the other operations. This allows you
to delete rows that match a filter before writing new row with overlapping IDs.
Note that patches to any deleted rows are ignored.

`delete_by_filter` has the same syntax as the [`filters` parameter in the query API](https://turbopuffer.com/docs/query#filtering).

python

curlpythontypescriptgojavaruby

```python
import turbopuffer

tpuf = turbopuffer.Turbopuffer(
    region="gcp-us-central1",  # pick the right region: https://turbopuffer.com/docs/regions
)

ns = tpuf.namespace("write-delete-by-filter-example-py")

ns.write(
    upsert_rows=[\
        {\
            "id": 101,\
            "vector": [0.2, 0.8],\
            "title": "LISP Guide for Beginners",\
            "views": 10,\
        },\
        {\
            "id": 102,\
            "vector": [0.4, 0.4],\
            "title": "AI for Practitioners",\
            "views": 2500,\
        },\
    ],
    distance_metric="cosine_distance",
)

# Delete posts with titles that include the word "guide"
# and have 1000 or less views
result = ns.write(
    delete_by_filter=("And", [("title", "IGlob", "*guide*"), ("views", "Lte", 1000)])
)
print(result.rows_affected)  # 1

results = ns.query(rank_by=("id", "asc"), top_k=10)
print(len(results.rows))  # 1
```

#### Patch by filter

To patch a dynamically determined set of documents, use `patch_by_filter`. This operation will return the actual number of documents updated. When [`rows_remaining`](https://turbopuffer.com/docs/write#param-rows_remaing) is set to true in the response, there may be more documents matching your filter that can be patched, issue a follow up request to patch those documents.

Because this operation uses a query to determine which rows need to be patched, it will be billed as a query & a patch operation (1 write, 2 queries total).

If `patch_by_filter` is used in the same request as other write operations, it is applied after `delete_by_filter` but before any other write operations. `patch_by_filter` will not apply to any rows which were deleted.

python

curlpythontypescriptgojavaruby

```python
import turbopuffer

tpuf = turbopuffer.Turbopuffer(
    region="gcp-us-central1",  # pick the right region: https://turbopuffer.com/docs/regions
)

ns = tpuf.namespace("write-patch-by-filter-example-py")

ns.write(
    upsert_rows=[\
        {\
            "id": 101,\
            "vector": [0.2, 0.8],\
            "title": "LISP Guide for Beginners",\
            "views": 10,\
            "status": "published",\
        },\
        {\
            "id": 102,\
            "vector": [0.4, 0.4],\
            "title": "AI for Practitioners",\
            "views": 2500,\
            "status": "published",\
        },\
        {\
            "id": 103,\
            "vector": [0.6, 0.3],\
            "title": "Rust Basics",\
            "views": 50,\
            "status": "published",\
        },\
    ],
    distance_metric="cosine_distance",
)

# Archive posts that are published and have 100 or fewer views
result = ns.write(
    patch_by_filter={
        "filters": ("And", [("status", "Eq", "published"), ("views", "Lte", 100)]),
        "patch": {"status": "archived"},
    }
)
print(result.rows_affected)  # 2

results = ns.query(rank_by=("id", "asc"), include_attributes=["status"], top_k=10)
for row in results.rows:
    print(f"ID {row['id']}: {row['status']}")  # IDs 101 and 103 are now archived
```

On this page

- [Request](https://turbopuffer.com/docs/write#request)
- [Response](https://turbopuffer.com/docs/write#response)
- [Attributes](https://turbopuffer.com/docs/write#attributes)
- [Vectors](https://turbopuffer.com/docs/write#vectors)
- [Schema](https://turbopuffer.com/docs/write#schema)
- [Updating attributes](https://turbopuffer.com/docs/write#updating-attributes)
- [Examples](https://turbopuffer.com/docs/write#examples)
- [Row-based writes](https://turbopuffer.com/docs/write#row-based-writes)
- [Configuring the schema](https://turbopuffer.com/docs/write#configuring-the-schema)
- [Column-based writes](https://turbopuffer.com/docs/write#column-based-writes)
- [Conditional writes](https://turbopuffer.com/docs/write#conditional-writes)
- [Delete by filter](https://turbopuffer.com/docs/write#delete-by-filter)
- [Patch by filter](https://turbopuffer.com/docs/write#patch-by-filter)

![turbopuffer logo](https://turbopuffer.com/_next/static/media/lockup_transparent.6092c7ef.svg)

[Company](https://turbopuffer.com/about) [Jobs](https://turbopuffer.com/jobs) [Pricing](https://turbopuffer.com/pricing) [Press & media](https://turbopuffer.com/press) [System status](https://status.turbopuffer.com/)

Support

[Slack](https://join.slack.com/t/turbopuffer-community/shared_invite/zt-24vaw9611-7E4RLNVeLXjcVatYpEJTXQ) [Docs](https://turbopuffer.com/docs) [Email](https://turbopuffer.com/contact/support) [Sales](https://turbopuffer.com/contact/sales)

Follow

[Blog](https://turbopuffer.com/blog) [RSS](https://turbopuffer.com/blog/rss.xml)

© 2026 turbopuffer Inc.

[Terms of service](https://turbopuffer.com/terms-of-service) [Data Processing Agreement](https://turbopuffer.com/dpa) [Privacy Policy](https://turbopuffer.com/privacy-policy) [Security & Compliance](https://turbopuffer.com/docs/security)
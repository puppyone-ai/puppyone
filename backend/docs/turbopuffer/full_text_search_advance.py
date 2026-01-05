import turbopuffer

tpuf = turbopuffer.Turbopuffer(
    region='gcp-us-central1', # pick the right region: https://turbopuffer.com/docs/regions
)

ns = tpuf.namespace(f'fts-advanced-example-py')

# Write some documents with a rich set of attributes.
ns.write(
    upsert_rows=[
        {
            'id': 1,
            'title': 'Getting Started with Python',
            'content': 'Learn Python basics including variables, functions, and classes',
            'tags': ['python', 'programming', 'beginner'],
            'language': 'en',
            'publish_date': 1709251200
        },
        {
            'id': 2,
            'title': 'Advanced TypeScript Tips',
            'content': 'Discover advanced TypeScript features and type system tricks',
            'tags': ['typescript', 'javascript', 'advanced'],
            'language': 'en',
            'publish_date': 1709337600
        },
        {
            'id': 3,
            'title': 'Python vs JavaScript',
            'content': 'Compare Python and JavaScript for web development',
            'tags': ['python', 'javascript', 'comparison'],
            'language': 'en',
            'publish_date': 1709424000
        }
    ],
    schema={
        'title': {
            'type': 'string',
            'full_text_search': {
                # See all FTS indexing options at
                # https://turbopuffer.com/docs/write#param-full_text_search
                'language': 'english',
                'stemming': True,
                'remove_stopwords': True,
                'case_sensitive': False
            }
        },
        'content': {
            'type': 'string',
            'full_text_search': {
                'language': 'english',
                'stemming': True,
                'remove_stopwords': True
            }
        },
        'tags': {
            'type': '[]string',
            'full_text_search': {
                'stemming': False,
                'remove_stopwords': False,
                'case_sensitive': True
            }
        }
    }
)

# Advanced FTS search.
# In this example, hits on `title` and `tags` are weighted / boosted higher than
# hits on `content`.
result = ns.query(
    # See all FTS query options at https://turbopuffer.com/docs/query
    rank_by=('Sum', (
        ('Product', 3, ('title', 'BM25', 'python beginner')),
        ('Product', 2, ('tags', 'BM25', 'python beginner')),
        ('content', 'BM25', 'python beginner')
    )),
    filters=('And', (
        ('publish_date', 'Gte', 1709251200),
        ('language', 'Eq', 'en'),
    )),
    top_k=10,
    include_attributes=['title', 'content', 'tags']
)
print(result.rows)

# To combine with vector search, see:
# https://turbopuffer.com/docs/hybrid-search

import turbopuffer

tpuf = turbopuffer.Turbopuffer(
    region='gcp-us-central1', # pick the right region: https://turbopuffer.com/docs/regions
)

ns = tpuf.namespace('delete-namespace-example-py')
# If an error occurs, this call raises a turbopuffer.APIError if a retry was not successful.
ns.delete_all()

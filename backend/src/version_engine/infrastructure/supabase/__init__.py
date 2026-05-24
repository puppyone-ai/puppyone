"""Supabase/S3 backend adapters for the Version Engine."""


def safe_data(resp) -> dict | list | None:
    """Safely extract .data from a Supabase response.

    Some supabase-py versions return None instead of ApiResponse(data=None)
    when maybe_single() finds no row. This helper handles all variants.
    """
    if resp is None or not hasattr(resp, "data"):
        return None
    return resp.data

"""
JSON serialization utilities for the Engine Server
"""

def json_serializer(obj):
    """
    Custom JSON serializer for handling objects that default json encoder cannot process.
    
    Handles:
    - datetime and date objects -> ISO format string
    - objects with isoformat() method -> calls that method
    - pandas.Timestamp objects -> ISO format string
    - any other non-serializable objects -> string representation
    
    Args:
        obj: The object to serialize
        
    Returns:
        A JSON-serializable version of the object
    """
    from datetime import datetime, date
    import pandas as pd
    
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if hasattr(obj, 'isoformat'):
        return obj.isoformat()
    if pd and hasattr(pd, 'Timestamp') and isinstance(obj, pd.Timestamp):
        return obj.isoformat()
    # Handle other types that might not be JSON serializable
    return str(obj) 
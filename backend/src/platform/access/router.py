"""Access service API.

The implementation currently lives in ``src.connectors.manager``. This facade
keeps Access as a first-class platform resource while the lower-level connector
implementation continues to migrate.
"""

from src.connectors.manager.router import router

__all__ = ["router"]


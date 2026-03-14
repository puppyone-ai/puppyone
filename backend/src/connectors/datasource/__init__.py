"""
Data Source Providers — One provider per external system.

Each provider lives in its own directory and implements BaseConnector,
declaring its capabilities via ConnectorSpec.
"""

from src.connectors.datasource._base import (
    BaseConnector,
    ConnectorSpec,
    Capability,
    AuthRequirement,
    TriggerMode,
    Credentials,
    FetchResult,
    ConfigField,
)
from src.connectors.datasource.gmail.connector import GmailConnector
from src.connectors.datasource.github.connector import GithubConnector
from src.connectors.datasource.google_sheets.connector import GoogleSheetsConnector
from src.connectors.datasource.google_calendar.connector import GoogleCalendarConnector
from src.connectors.datasource.google_docs.connector import GoogleDocsConnector
from src.connectors.datasource.google_drive.connector import GoogleDriveConnector
from src.connectors.datasource.url.connector import UrlConnector
from src.connectors.filesystem.connector import OpenClawConnector
from src.connectors.datasource.google_search_console.connector import GoogleSearchConsoleConnector

CONNECTOR_CLASSES: list[type[BaseConnector]] = [
    GmailConnector,
    GithubConnector,
    GoogleSheetsConnector,
    GoogleCalendarConnector,
    GoogleDocsConnector,
    GoogleDriveConnector,
    UrlConnector,
    OpenClawConnector,
    GoogleSearchConsoleConnector,
]

__all__ = [
    "BaseConnector",
    "ConnectorSpec",
    "Capability",
    "AuthRequirement",
    "TriggerMode",
    "Credentials",
    "FetchResult",
    "ConfigField",
    "CONNECTOR_CLASSES",
    "GmailConnector",
    "GithubConnector",
    "GoogleSheetsConnector",
    "GoogleCalendarConnector",
    "GoogleDocsConnector",
    "GoogleDriveConnector",
    "UrlConnector",
    "OpenClawConnector",
    "GoogleSearchConsoleConnector",
]

"""
Sync Connectors — One connector per external system.

Each connector lives in its own directory and implements BaseConnector,
declaring its capabilities via ConnectorSpec.
"""

from src.sync.connectors._base import (
    BaseConnector,
    ConnectorSpec,
    Capability,
    AuthRequirement,
    TriggerMode,
    Credentials,
    FetchResult,
    ConfigField,
)
from src.sync.connectors.gmail.connector import GmailConnector
from src.sync.connectors.github.connector import GithubConnector
from src.sync.connectors.notion.connector import NotionConnector
from src.sync.connectors.google_sheets.connector import GoogleSheetsConnector
from src.sync.connectors.google_calendar.connector import GoogleCalendarConnector
from src.sync.connectors.google_docs.connector import GoogleDocsConnector
from src.sync.connectors.google_drive.connector import GoogleDriveConnector
from src.sync.connectors.airtable.connector import AirtableConnector
from src.sync.connectors.linear.connector import LinearConnector
from src.sync.connectors.url.connector import UrlConnector
from src.sync.connectors.openclaw.connector import OpenClawConnector
from src.sync.connectors.hackernews.connector import HackerNewsConnector
from src.sync.connectors.posthog.connector import PosthogConnector
from src.sync.connectors.google_search_console.connector import GoogleSearchConsoleConnector
from src.sync.connectors.script.connector import ScriptConnector

CONNECTOR_CLASSES: list[type[BaseConnector]] = [
    GmailConnector,
    GithubConnector,
    NotionConnector,
    GoogleSheetsConnector,
    GoogleCalendarConnector,
    GoogleDocsConnector,
    GoogleDriveConnector,
    AirtableConnector,
    LinearConnector,
    UrlConnector,
    OpenClawConnector,
    HackerNewsConnector,
    PosthogConnector,
    GoogleSearchConsoleConnector,
    ScriptConnector,
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
    "NotionConnector",
    "GoogleSheetsConnector",
    "GoogleCalendarConnector",
    "GoogleDocsConnector",
    "GoogleDriveConnector",
    "AirtableConnector",
    "LinearConnector",
    "UrlConnector",
    "OpenClawConnector",
    "HackerNewsConnector",
    "PosthogConnector",
    "GoogleSearchConsoleConnector",
    "ScriptConnector",
]

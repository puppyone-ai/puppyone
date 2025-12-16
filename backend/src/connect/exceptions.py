"""Connect module exceptions."""


class ConnectException(Exception):
    """Base exception for connect module."""
    pass


class AuthenticationError(ConnectException):
    """Raised when authentication is required or failed."""

    def __init__(self, message: str, provider: str = None, requires_auth: bool = True):
        super().__init__(message)
        self.provider = provider
        self.requires_auth = requires_auth


class UnsupportedURLError(ConnectException):
    """Raised when URL is not supported."""
    pass


class DataFetchError(ConnectException):
    """Raised when data fetching fails."""
    pass


class DataParseError(ConnectException):
    """Raised when data parsing fails."""
    pass
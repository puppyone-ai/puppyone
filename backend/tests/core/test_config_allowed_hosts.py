from src.config import Settings


def test_allowed_hosts_accepts_single_string() -> None:
    settings = Settings(
        _env_file=None,
        APP_ENV="production",
        DEBUG=False,
        ALLOWED_HOSTS="https://frontend.example.com",
    )

    assert settings.ALLOWED_HOSTS == ["https://frontend.example.com"]


def test_allowed_hosts_accepts_comma_separated_string() -> None:
    settings = Settings(
        _env_file=None,
        APP_ENV="production",
        DEBUG=False,
        ALLOWED_HOSTS="https://a.example.com, https://b.example.com/",
    )

    assert settings.ALLOWED_HOSTS == [
        "https://a.example.com",
        "https://b.example.com",
    ]


def test_allowed_hosts_default_for_development_without_debug() -> None:
    settings = Settings(
        _env_file=None,
        APP_ENV="development",
        DEBUG=False,
        ALLOWED_HOSTS=None,
    )

    assert settings.ALLOWED_HOSTS == [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]


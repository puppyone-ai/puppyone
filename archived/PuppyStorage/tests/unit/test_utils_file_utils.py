import urllib.parse
import pytest


@pytest.mark.unit
def test_build_content_disposition_header_ascii():
    from utils.file_utils import build_content_disposition_header

    h = build_content_disposition_header("file.txt")
    assert h == "attachment; filename=file.txt"


@pytest.mark.unit
def test_build_content_disposition_header_unicode():
    from utils.file_utils import build_content_disposition_header

    h = build_content_disposition_header("中文文档.pdf")
    assert h.startswith("attachment; filename*=")
    # Ensure percent-encoding present
    assert "%E4%B8%AD" in h


@pytest.mark.unit
def test_extract_filename_from_key():
    from utils.file_utils import extract_filename_from_key

    assert extract_filename_from_key("u1/b1/v1/a.txt") == "a.txt"
    assert extract_filename_from_key("a.txt") == "a.txt"


@pytest.mark.unit
def test_validate_filename():
    from utils.file_utils import validate_filename

    assert validate_filename("ok.txt") is True
    assert validate_filename("") is False
    assert validate_filename("bad<.txt") is False
    assert validate_filename("CON.txt") is False  # reserved base name



import os


def test_tmp_storage_dir(tmp_storage_dir):
    sample = tmp_storage_dir / "sample.txt"
    sample.write_text("ok")
    assert sample.exists()


def test_test_settings_defaults(test_settings):
    # Should default to local/test mode for safe runs
    assert test_settings["DEPLOYMENT_TYPE"] == "local"




import pytest
from storage.base import StorageAdapter


@pytest.mark.unit
def test_storage_adapter_has_copy_resource_method():
    """Verify StorageAdapter defines copy_resource abstract method"""
    assert hasattr(StorageAdapter, 'copy_resource')
    assert 'copy_resource' in StorageAdapter.__abstractmethods__


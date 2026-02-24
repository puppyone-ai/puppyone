"""
OCR Provider Module

Pluggable OCR service abstraction layer.
Supports multiple OCR providers: MineRU, Reducto, etc.
"""

from src.upload.file.ocr.base import OCRProvider, ParsedDocument
from src.upload.file.ocr.factory import OCRProviderFactory, get_ocr_provider

__all__ = [
    "OCRProvider",
    "ParsedDocument",
    "OCRProviderFactory",
    "get_ocr_provider",
]


"""
Routes module for Engine Server

This module contains all route definitions organized by functionality.
"""

from .health_routes import health_router
from .data_routes import data_router

__all__ = ['health_router', 'data_router'] 
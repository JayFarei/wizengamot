"""
Pytest configuration and fixtures for backend tests.
"""

import pytest
import asyncio


@pytest.fixture(scope="session")
def event_loop():
    """Create an event loop for the test session."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


# Enable asyncio mode for all tests
def pytest_configure(config):
    """Configure pytest for async tests."""
    config.addinivalue_line("markers", "asyncio: mark test as async")

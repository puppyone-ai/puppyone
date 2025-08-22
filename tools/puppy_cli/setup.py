from setuptools import setup, find_packages

setup(
    name="puppy_cli",
    version="0.1.0",
    description="PuppyAgent CLI: push chat to storage and get resource_key",
    author="PuppyAgent Team",
    author_email="info@puppyagent.com",
    packages=find_packages(),
    install_requires=[
        "requests>=2.31.0",
    ],
    entry_points={
        "console_scripts": [
            "puppy=puppy_cli.main:main",
        ]
    },
    python_requires=">=3.8",
)

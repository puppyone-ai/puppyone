from setuptools import setup, find_packages

setup(
    name="puppy_model",
    version="0.1.0",
    description="统一模型接口，支持多种模型提供商",
    author="PuppyAgent Team",
    author_email="info@puppyagent.com",
    packages=find_packages(),
    install_requires=[
        "requests>=2.25.0",
    ],
    extras_require={
        "openai": ["openai>=1.0.0"],
        "huggingface": ["transformers>=4.0.0", "torch>=1.0.0"],
        "all": [
            "openai>=1.0.0",
            "transformers>=4.0.0", 
            "torch>=1.0.0",
        ]
    },
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Intended Audience :: Developers",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
    ],
    python_requires=">=3.8",
) 
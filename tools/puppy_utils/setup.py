from setuptools import setup, find_packages

setup(
    name="puppy_utils",
    version="0.1.0",
    description="PuppyAgent 核心工具包，提供日志记录、配置管理和异常处理等通用功能",
    long_description=open("README.md", "r", encoding="utf-8").read(),
    long_description_content_type="text/markdown",
    author="PuppyAgent Team", 
    author_email="info@puppyagent.com",
    url="https://github.com/puppyagent/puppy-utils",
    
    # 明确指定包结构
    packages=['puppy_utils', 'puppy_utils.core'],
    package_dir={'puppy_utils': '.'},  # 告诉 setup 包在当前目录
    
    # 包含非 Python 文件
    include_package_data=True,
    package_data={
        '': ['*.md', '*.txt', '*.yml', '*.yaml'],
    },
    
    # 依赖包
    install_requires=[
        "python-dotenv>=0.19.0",
    ],
    
    # 可选依赖
    extras_require={
        "axiom": ["axiom-py>=0.2.0"],
        "dev": [
            "pytest>=6.0",
            "pytest-asyncio",
            "black",
            "flake8",
        ],
    },
    
    # Python 版本要求
    python_requires=">=3.8",
    
    # 分类信息
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Topic :: Software Development :: Libraries :: Python Modules",
        "Topic :: System :: Logging",
        "Topic :: Utilities",
    ],
    
    # 关键词
    keywords="logging, config, utilities, puppyagent",
    
    # 项目链接
    project_urls={
        "Bug Reports": "https://github.com/puppyagent/puppy-utils/issues",
        "Source": "https://github.com/puppyagent/puppy-utils",
        "Documentation": "https://docs.puppyagent.com",
    },
) 
from setuptools import setup, find_packages

with open("requirements.txt", "r") as f:
    requirements = [line.strip() for line in f if line.strip() and not line.startswith("#")]

setup(
    name="steno-poc",
    version="0.1.0",
    packages=find_packages(where="src"),
    package_dir={"": "src"},
    python_requires=">=3.8",
    install_requires=requirements,
    entry_points={
        'console_scripts': [
            'steno=main:cli',
        ],
    },
    author="Your Name",
    description="A proof of concept for meeting transcription service",
    long_description=open("README.md").read(),
    long_description_content_type="text/markdown",
)
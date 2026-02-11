# Contributing to StenoAI

Thank you for your interest in contributing to StenoAI! This guide will help you get started.

## Getting Started

### Prerequisites

- macOS (required for development and testing)
- Python 3.8+
- Node.js 18+
- Git

### Local Development Setup

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/your-username/stenoai.git
   cd stenoai
   ```

2. **Set up Python environment**
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   pip install -e .
   ```

3. **Install system dependencies**
   ```bash
   # Install Ollama
   brew install ollama
   ollama serve &
   ollama pull llama3.2:3b
   
   # Install ffmpeg
   brew install ffmpeg
   ```

4. **Set up Electron app**
   ```bash
   cd app
   npm install
   npm start
   ```

5. **Test the setup**
   ```bash
   # Test CLI
   python simple_recorder.py --help
   
   # Test app launch
   cd app && npm start
   ```

## Development Workflow

### Making Changes

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Follow existing code style and patterns
   - Test your changes locally
   - Update documentation if needed

3. **Test your changes**
   ```bash
   # Test Python code
   python simple_recorder.py --help
   python -c "import src.audio_recorder, src.transcriber, src.summarizer"
   
   # Test Electron app
   cd app && npm start
   ```

4. **Commit and push**
   ```bash
   git add .
   git commit -m "Add your descriptive commit message"
   git push origin feature/your-feature-name
   ```

5. **Create a Pull Request**
   - Use the PR template to describe your changes
   - Focus on clear description and testing details
   - Be responsive to review feedback

### Code Style

**Python:**
- Follow PEP 8 guidelines
- Use type hints where appropriate
- Write docstrings for functions and classes
- Use `ruff` for linting: `ruff check .`

**JavaScript:**
- Use semicolons
- Use const/let instead of var
- Follow existing patterns in the codebase

### Testing

Before submitting a PR, please ensure:

- [ ] CLI functionality works: `python simple_recorder.py --help`
- [ ] Electron app starts: `cd app && npm start`
- [ ] No breaking changes to existing functionality

## Versioning

This project uses manual semantic versioning:

- Maintainers handle version bumps and releases
- Contributors focus on code quality, not versioning
- Releases are created manually using `npm version` commands

## Types of Contributions

### Bug Reports

When filing a bug report, please include:
- macOS version
- Steps to reproduce
- Expected vs actual behavior
- Error messages or logs
- Screenshots if applicable

### Feature Requests

For feature requests, please:
- Describe the problem you're trying to solve
- Explain your proposed solution
- Consider if this fits the project's scope and vision

### Code Contributions

We welcome contributions for:
- Bug fixes
- Performance improvements
- New features (please discuss in an issue first)
- Documentation improvements
- Test coverage improvements

### Documentation

Help improve our documentation:
- Fix typos or unclear instructions
- Add examples or clarifications
- Update outdated information

## Project Structure

```
stenoai/
├── app/                  # Electron desktop app
│   ├── main.js          # Main process
│   ├── index.html       # Renderer process
│   └── package.json     # App dependencies
├── src/                  # Python backend
│   ├── audio_recorder.py    # Audio recording
│   ├── transcriber.py       # Whisper integration
│   ├── summarizer.py        # Ollama/LLM processing
│   └── models.py            # Data models
├── simple_recorder.py    # CLI interface
├── requirements.txt      # Python dependencies
└── CLAUDE.md            # Development instructions
```

## Getting Help

- Check existing [issues](https://github.com/ruzin/stenoai/issues)
- Create a new issue for bugs or feature requests
- Join discussions in the repository

## Contributor License Agreement

By contributing to StenoAI, you agree to our [Contributor License Agreement (CLA)](CLA.md).

**What this means:**
- You retain ownership of your contributions
- You grant us broad, irrevocable rights to use, modify, and relicense your contributions
- This allows us to offer commercial licenses while keeping the project free for personal use

**How it works:**
- When you submit your first pull request, CLA Assistant will prompt you to sign
- Simply comment "I have read the CLA Document and I hereby sign the CLA" on the PR
- This is a one-time process - future contributions are automatically covered

The project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

## Recognition

Contributors will be recognized in our releases and README. Thank you for helping make StenoAI better!
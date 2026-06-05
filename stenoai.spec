# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec file for StenoAI Python backend.

This bundles the Python backend into a standalone executable that can be
distributed with the Electron app, eliminating the need for users to have
Python installed.

Includes:
- Parakeet TDT v3 (via parakeet-mlx) for transcription (~50MB code, ~600MB model downloaded on first use)
- Bundled Ollama binary for summarization (~220MB)
- MLX runtime for Apple Silicon inference

No external dependencies required - users only need to download LLM + ASR models.

Usage:
    pip install pyinstaller
    pyinstaller stenoai.spec

The bundled executable will be in dist/stenoai/
"""

import sys
from PyInstaller.utils.hooks import collect_data_files, collect_submodules, collect_dynamic_libs

# Collect all hidden imports
hiddenimports = [
    # Parakeet MLX (ASR)
    'parakeet_mlx',
    'parakeet_mlx.audio',
    'parakeet_mlx.tokenizer',
    'parakeet_mlx.attention',
    'parakeet_mlx.cache',

    # MLX runtime
    'mlx',
    'mlx.core',
    'mlx.nn',
    'mlx.utils',

    # whisper.cpp bindings — still used by the post-stop batch pipeline.
    # Will be dropped once transcriber.py is rewritten to use Parakeet
    # for batch transcription too.
    'pywhispercpp',
    'pywhispercpp.model',
    'pywhispercpp.constants',

    # HuggingFace hub (parakeet-mlx pulls weights through this)
    'huggingface_hub',

    # ONNX Runtime — runs the bundled Silero VAD model directly. We avoid
    # the silero-vad pip package because it imports torch at module load.
    'onnxruntime',
    'onnxruntime.capi',

    # Audio processing
    'sounddevice',
    'soundfile',

    # Ollama client
    'ollama',
    'httpx',

    # Data handling
    'numpy',
    'numpy.core',
    'pydantic',
    'pydantic.fields',
    'pydantic_core',

    # CLI
    'click',

    # Date handling
    'dateutil',
    'dateutil.parser',

    # Standard library modules that might be missed
    'json',
    'pathlib',
    'logging',
    'threading',
    'queue',
    'wave',
    'struct',
    'tempfile',
    'shutil',
    'subprocess',
    'platform',
    'multiprocessing',
]

# Collect submodules — parakeet-mlx + mlx + huggingface_hub all have
# late-bound imports that PyInstaller's static analysis misses, and a partial
# bundle silently breaks at runtime ("module not found" deep inside model
# load). collect_submodules is the safe sledgehammer.
hiddenimports += collect_submodules('pydantic')
hiddenimports += collect_submodules('numpy')
hiddenimports += collect_submodules('parakeet_mlx')
hiddenimports += collect_submodules('mlx')
hiddenimports += collect_submodules('huggingface_hub')
hiddenimports += collect_submodules('onnxruntime')

# Collect data files
datas = []

# Include the src module
datas += [('src', 'src')]

# Include the scripts dir so the spike command can run from the bundle.
# Kept tiny on purpose — the diagnostic spike-parakeet entrypoint reaches
# in here when the user runs `dist/stenoai/stenoai spike-parakeet`.
datas += [('scripts', 'scripts')]

# Collect data files (tokenizers, configs) from parakeet-mlx + mlx.
# parakeet-mlx ships tokenizer JSON resources that get loaded by path.
for pkg in ('parakeet_mlx', 'mlx', 'huggingface_hub', 'pywhispercpp', 'onnxruntime'):
    try:
        datas += collect_data_files(pkg)
    except Exception:
        pass

# Collect dynamic libraries — MLX ships compiled Metal kernels (.metallib)
# and a libmlx dylib. Without collect_dynamic_libs the bundle imports MLX
# but bombs the first time it touches a Metal op. pywhispercpp ships
# libwhisper.dylib via the same mechanism.
binaries = []
for pkg in ('mlx', 'parakeet_mlx', 'pywhispercpp', 'onnxruntime'):
    try:
        binaries += collect_dynamic_libs(pkg)
    except Exception:
        pass

# Bundle Ollama binary and libraries
import os
# SPECPATH is provided by PyInstaller and points to the spec file directory
ollama_bin_dir = os.path.join(SPECPATH, 'bin')
if os.path.exists(ollama_bin_dir):
    for filename in os.listdir(ollama_bin_dir):
        filepath = os.path.join(ollama_bin_dir, filename)
        if os.path.isfile(filepath):
            if filename == 'ffmpeg':
                # Put ffmpeg in root of bundle for easy PATH access
                binaries.append((filepath, '.'))
            else:
                # Put Ollama files in 'ollama' subdirectory
                binaries.append((filepath, 'ollama'))

block_cipher = None

a = Analysis(
    ['simple_recorder.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Exclude PyTorch and related heavy packages (not needed with whisper.cpp)
        'torch',
        'torchvision',
        'torchaudio',
        'tensorflow',
        'keras',
        'transformers',
        # Exclude other unnecessary packages
        'matplotlib',
        'PIL',
        'tkinter',
        'PyQt5',
        'PyQt6',
        'PySide2',
        'PySide6',
        'IPython',
        'jupyter',
        'notebook',
        'sphinx',
        'pytest',
        # `unittest` is kept in the bundle now — parakeet-mlx (via librosa /
        # scipy) lazy-imports it during from_pretrained; excluding it makes
        # model loading fail with "No module named 'unittest'".
        # openai-whisper (PyTorch) is excluded — we use parakeet for live and
        # whisper.cpp (via pywhispercpp) for batch, neither needs the
        # PyTorch-based reference implementation.
        'whisper',
        'tiktoken',
        'tiktoken_ext',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='stenoai',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,  # Keep console for CLI usage
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='stenoai',
)

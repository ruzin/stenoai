# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec file for StenoAI Python backend.

This bundles the Python backend into a standalone executable that can be
distributed with the Electron app, eliminating the need for users to have
Python installed.

Uses whisper.cpp (via pywhispercpp) instead of PyTorch-based whisper,
resulting in a much smaller bundle (~150MB vs ~1GB).

Usage:
    pip install pyinstaller
    pyinstaller stenoai.spec

The bundled executable will be in dist/stenoai/
"""

import sys
from PyInstaller.utils.hooks import collect_data_files, collect_submodules, collect_dynamic_libs

# Collect all hidden imports
hiddenimports = [
    # whisper.cpp bindings
    'pywhispercpp',
    'pywhispercpp.model',
    'pywhispercpp.constants',

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

# Collect submodules
hiddenimports += collect_submodules('pydantic')
hiddenimports += collect_submodules('numpy')

# Collect data files
datas = []

# Include the src module
datas += [('src', 'src')]

# Collect any data files from pywhispercpp
try:
    datas += collect_data_files('pywhispercpp')
except Exception:
    pass

# Collect dynamic libraries (whisper.cpp native libs)
binaries = []
try:
    binaries += collect_dynamic_libs('pywhispercpp')
except Exception:
    pass

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
        'unittest',
        # Exclude openai-whisper (using whisper.cpp instead)
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

# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec file for StenoAI Python backend.

This bundles the Python backend into a standalone executable that can be
distributed with the Electron app, eliminating the need for users to have
Python installed.

Includes:
- Parakeet TDT v3 for transcription. On Apple Silicon via parakeet-mlx
  (MLX runtime). On Windows / Linux via onnx-asr (ONNX Runtime, CPU).
  Both ship ~50 MB of bundled code; the ~600 MB (MLX fp16) or ~670 MB
  (ONNX int8) weights download on first use.
- whisper.cpp (pywhispercpp) as the user-selectable engine for languages
  Parakeet can't speak (Chinese, Japanese, Korean, Arabic, Hindi, …) and
  for the legacy post-stop batch pipeline.
- Bundled Ollama binary for summarization (~220MB).

No external dependencies required - users only need to download LLM + ASR models.

Usage:
    pip install pyinstaller
    pyinstaller stenoai.spec

The bundled executable will be in dist/stenoai/
"""

import sys
from PyInstaller.utils.hooks import collect_data_files, collect_submodules, collect_dynamic_libs

# Apple Silicon uses parakeet-mlx for ASR; Windows / Linux use onnx-asr via
# ONNX Runtime. The two backends live in src/_parakeet_{mlx,onnx}.py and
# src/parakeet.py dispatches between them at import time. We skip MLX hidden
# imports off-darwin so PyInstaller doesn't blow up trying to find a module
# that isn't installed.
_IS_DARWIN = sys.platform == "darwin"
_IS_WINDOWS = sys.platform == "win32"

# UPX is a binary packer that compresses executables. It's safe on macOS but
# routinely flagged as suspicious by Windows Defender + corporate AVs because
# malware abuses it for the same compression benefits. Leaving it on would
# get the unsigned alpha installer quarantined on download for many users.
# Disable UPX on Windows; the bundle is a few MB larger but actually
# installs. macOS keeps UPX so the DMG stays close to its current size.
_USE_UPX = not _IS_WINDOWS

# Collect all hidden imports
hiddenimports = [
    # whisper.cpp bindings — still used by the post-stop batch pipeline AND
    # as the user-selectable engine for non-European languages (Chinese,
    # Japanese, Korean, Arabic, Hindi, …) that Parakeet can't speak.
    'pywhispercpp',
    'pywhispercpp.model',
    'pywhispercpp.constants',

    # HuggingFace hub (both ASR backends pull weights through this)
    'huggingface_hub',

    # ONNX Runtime — runs the bundled Silero VAD model directly on every
    # platform; runs the Parakeet weights too on Windows / Linux via onnx-asr.
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

if _IS_DARWIN:
    # Parakeet MLX (ASR) + MLX runtime — Apple Silicon only
    hiddenimports += [
        'parakeet_mlx',
        'parakeet_mlx.audio',
        'parakeet_mlx.tokenizer',
        'parakeet_mlx.attention',
        'parakeet_mlx.cache',
        'mlx',
        'mlx.core',
        'mlx.nn',
        'mlx.utils',
    ]
else:
    # onnx-asr (ASR via ONNX Runtime) — Windows / Linux. The package is laid
    # out so the top-level `onnx_asr` import pulls everything user-facing;
    # collect_submodules below catches the lazily-imported model adapters.
    hiddenimports += [
        'onnx_asr',
    ]

# Collect submodules — parakeet-mlx + mlx + huggingface_hub all have
# late-bound imports that PyInstaller's static analysis misses, and a partial
# bundle silently breaks at runtime ("module not found" deep inside model
# load). collect_submodules is the safe sledgehammer.
hiddenimports += collect_submodules('pydantic')
hiddenimports += collect_submodules('numpy')
hiddenimports += collect_submodules('huggingface_hub')
hiddenimports += collect_submodules('onnxruntime')

if _IS_DARWIN:
    hiddenimports += collect_submodules('parakeet_mlx')
    hiddenimports += collect_submodules('mlx')
else:
    hiddenimports += collect_submodules('onnx_asr')

# Collect data files
datas = []

# Include the src module
datas += [('src', 'src')]

# Include the scripts dir so the spike command can run from the bundle.
# Kept tiny on purpose — the diagnostic spike-parakeet entrypoint reaches
# in here when the user runs `dist/stenoai/stenoai spike-parakeet`.
datas += [('scripts', 'scripts')]

# Collect data files (tokenizers, configs). parakeet-mlx ships tokenizer
# JSON resources that get loaded by path; onnx-asr ships built-in model
# alias configs the same way.
_DATA_PKGS = ['huggingface_hub', 'pywhispercpp', 'onnxruntime']
if _IS_DARWIN:
    _DATA_PKGS += ['parakeet_mlx', 'mlx']
else:
    _DATA_PKGS += ['onnx_asr']
for pkg in _DATA_PKGS:
    try:
        datas += collect_data_files(pkg)
    except Exception:
        pass

# Collect dynamic libraries — MLX ships compiled Metal kernels (.metallib)
# and a libmlx dylib. Without collect_dynamic_libs the bundle imports MLX
# but bombs the first time it touches a Metal op. pywhispercpp ships
# libwhisper.dylib via the same mechanism. onnxruntime ships its native
# session DLLs on Windows; PyInstaller's hidden-import / collect-all
# gotcha for onnxruntime is well-documented (microsoft/onnxruntime#25193)
# so we always run collect_dynamic_libs on it.
binaries = []
_DYLIB_PKGS = ['pywhispercpp', 'onnxruntime']
if _IS_DARWIN:
    _DYLIB_PKGS += ['mlx', 'parakeet_mlx']
for pkg in _DYLIB_PKGS:
    try:
        binaries += collect_dynamic_libs(pkg)
    except Exception:
        pass

# Bundle Ollama binary and libraries.
# Walk bin/ recursively — Ollama for Windows ships GPU libs under lib/ollama/
# that must be preserved relative to ollama.exe.
import os
ollama_bin_dir = os.path.join(SPECPATH, 'bin')
if os.path.exists(ollama_bin_dir):
    for root, _dirs, files in os.walk(ollama_bin_dir):
        for filename in files:
            filepath = os.path.join(root, filename)
            rel = os.path.relpath(filepath, ollama_bin_dir)
            rel_dir = os.path.dirname(rel)
            base = os.path.basename(filename).lower()
            if base in ('ffmpeg', 'ffmpeg.exe'):
                # Put ffmpeg at the root of the bundle for easy PATH access
                binaries.append((filepath, '.'))
            else:
                # Everything else lives under ollama/ (preserving subdirs like lib/ollama/)
                dest = 'ollama' if not rel_dir else os.path.join('ollama', rel_dir)
                binaries.append((filepath, dest))

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
    upx=_USE_UPX,
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
    upx=_USE_UPX,
    upx_exclude=[],
    name='stenoai',
)

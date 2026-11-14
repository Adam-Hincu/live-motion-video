#!/usr/bin/env bash
# Installs the local word-level speech alignment model (torchaudio MMS forced aligner, CPU).
# Model weights are cached in models/ (git-ignored).
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m venv .venv-align
.venv-align/bin/pip install --quiet --upgrade pip
.venv-align/bin/pip install --quiet torch torchaudio --index-url https://download.pytorch.org/whl/cpu
.venv-align/bin/pip install --quiet soundfile
mkdir -p models
TORCH_HOME="$PWD/models" .venv-align/bin/python -c "import torchaudio; torchaudio.pipelines.MMS_FA.get_model(); print('alignment model ready')"

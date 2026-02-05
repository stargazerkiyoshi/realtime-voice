#!/usr/bin/env bash
set -euo pipefail

export PORT="3000"
export ASR_PROVIDER="volc"
export TTS_PROVIDER="volc"

export VOLC_APP_KEY="5644268780"
export VOLC_ACCESS_KEY="iYjwgO299GYLBCi4-PiowsV00lUhPVOM"
export VOLC_ASR_RESOURCE_ID="volc.seedasr.sauc.duration"
export VOLC_TTS_RESOURCE_ID="seed-tts-1.0"
export VOLC_ASR_URL="wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async"
export VOLC_TTS_URL="wss://openspeech.bytedance.com/api/v3/tts/bidirection"
export VOLC_VOICE_TYPE="zh_female_tianmeitaozi_mars_bigtts"
export VOLC_SAMPLE_RATE="24000"
export VOLC_TTS_MODEL="seed-tts-1.1"

export OPENAI_API_KEY="9e85f8d6-3396-49c0-bfaa-2dcec62e858c"
export OPENAI_MODEL="doubao-1-5-pro-32k-250115"
export OPENAI_BASE_URL="https://ark.cn-beijing.volces.com/api/v3"

pnpm dev

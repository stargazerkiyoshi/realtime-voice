#!/usr/bin/env bash
# Example env setup for local dev. Copy to start.local.sh and fill secrets.
set -euo pipefail


export PORT="3000"
export DEBUG_VOICE="1"
export LOG_TO_FILE="1"
export LOG_FILE="logs/voice.log"
export ASR_PROVIDER="volc"
export TTS_PROVIDER="volc"

# Fire up with your own keys/resources.
export VOLC_APP_KEY="__REPLACE_ME__"
export VOLC_ACCESS_KEY="__REPLACE_ME__"
export VOLC_ASR_RESOURCE_ID="volc.seedasr.sauc.duration"
export VOLC_TTS_RESOURCE_ID="seed-tts-1.0"
export VOLC_ASR_URL="wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async"
export VOLC_TTS_URL="wss://openspeech.bytedance.com/api/v3/tts/bidirection"
export VOLC_VOICE_TYPE="zh_female_tianmeitaozi_mars_bigtts"
export VOLC_SAMPLE_RATE="24000"
export VOLC_TTS_MODEL="seed-tts-1.1"

export OPENAI_API_KEY="__REPLACE_ME__"
export OPENAI_MODEL="doubao-1-5-pro-32k-250115"
export OPENAI_BASE_URL="https://ark.cn-beijing.volces.com/api/v3"

pnpm dev

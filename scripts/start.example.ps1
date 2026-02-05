$ErrorActionPreference = "Stop"

$env:PORT = "3000"
$env:DEBUG_VOICE = "1"
$env:LOG_TO_FILE = "1"
$env:LOG_FILE = "logs/voice.log"
$env:ASR_PROVIDER = "volc"
$env:TTS_PROVIDER = "volc"

$env:VOLC_APP_KEY = "your_app_key"
$env:VOLC_ACCESS_KEY = "your_access_key"
$env:VOLC_ASR_RESOURCE_ID = "volc.speech.bigmodel"
$env:VOLC_TTS_RESOURCE_ID = "seed-tts-1.0"
$env:VOLC_ASR_URL = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async"
$env:VOLC_TTS_URL = "wss://openspeech.bytedance.com/api/v3/tts/bidirection"
$env:VOLC_VOICE_TYPE = "BV700_V2_streaming"
$env:VOLC_SAMPLE_RATE = "24000"
$env:VOLC_TTS_MODEL = "seed-tts-1.1"

$env:OPENAI_API_KEY = "your_openai_api_key"
$env:OPENAI_MODEL = "gpt-4.1-mini"
$env:OPENAI_BASE_URL = ""

pnpm dev

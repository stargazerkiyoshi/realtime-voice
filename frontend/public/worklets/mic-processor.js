class MicProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options?.processorOptions || {};
    this.targetRate = opts.targetSampleRate || 16000;
    this.inBuffer = [];
    this.inCount = 0;
    this.minInputSamples = Math.max(1, opts.minInputSamples || 480); // ~10ms @48k
    this.outFrame = Math.max(1, opts.outFrameSamples || 160); // 10ms @16k
  }

  process(inputs) {
    if (!inputs || inputs.length === 0 || inputs[0].length === 0) return true;
    const ch = inputs[0][0];
    this.inBuffer.push(ch);
    this.inCount += ch.length;

    if (this.inCount < this.minInputSamples) return true;

    // 拼接累积的输入
    const acc = new Float32Array(this.inCount);
    let offset = 0;
    for (const buf of this.inBuffer) {
      acc.set(buf, offset);
      offset += buf.length;
    }
    this.inBuffer = [];
    this.inCount = 0;

    // 固定输出 outFrame 长度，按均值重采样；不足时补零（防止极短输入导致 outLen 为空）
    const inRate = sampleRate; // AudioWorkletProcessor global
    const outLen = this.outFrame;
    const out = new Int16Array(outLen);
    for (let i = 0; i < outLen; i += 1) {
      const start = Math.floor((i * inRate) / this.targetRate);
      const end = Math.floor(((i + 1) * inRate) / this.targetRate);
      let sum = 0;
      let count = 0;
      for (let j = start; j < end && j < acc.length; j += 1) {
        sum += acc[j];
        count += 1;
      }
      const v = count > 0 ? sum / count : 0;
      const clipped = Math.max(-1, Math.min(1, v));
      out[i] = clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff;
    }

    // RMS 用于 UI 展示
    let rmsSum = 0;
    for (let i = 0; i < acc.length; i += 1) rmsSum += acc[i] * acc[i];
    const rms = Math.sqrt(rmsSum / acc.length);

    this.port.postMessage({ type: 'pcm', buffer: out.buffer, rms }, [out.buffer]);
    return true;
  }
}

registerProcessor('mic-processor', MicProcessor);

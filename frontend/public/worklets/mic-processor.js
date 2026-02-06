class MicProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options?.processorOptions || {};
    this.targetRate = opts.targetSampleRate || 16000;
    this.inputRate = opts.inputSampleRate || sampleRate;
    this.inBuffer = [];
    this.inCount = 0;
    const frameMs = Math.max(1, opts.frameMs || 10);
    const defaultIn = Math.round((this.inputRate * frameMs) / 1000);
    const defaultOut = Math.round((this.targetRate * frameMs) / 1000);
    this.minInputSamples = Math.max(1, opts.minInputSamples || defaultIn);
    this.outFrame = Math.max(1, opts.outFrameSamples || defaultOut);
  }

  process(inputs) {
    if (!inputs || inputs.length === 0 || inputs[0].length === 0) return true;
    const ch = inputs[0][0];
    if (!ch || ch.length === 0) return true;
    // Copy input buffer because Web Audio reuses the underlying memory.
    const copy = ch.slice();
    this.inBuffer.push(copy);
    this.inCount += copy.length;

    if (this.inCount < this.minInputSamples) return true;

    // 拼接累积的输入
    let acc = new Float32Array(this.inCount);
    let offset = 0;
    for (const buf of this.inBuffer) {
      acc.set(buf, offset);
      offset += buf.length;
    }
    this.inBuffer = [];
    this.inCount = 0;

    const expectedIn = this.minInputSamples;
    if (acc.length > expectedIn) {
      const remain = acc.slice(expectedIn);
      this.inBuffer.push(remain);
      this.inCount = remain.length;
      acc = acc.slice(0, expectedIn);
    }

    // 固定输出 outFrame 长度，按均值重采样；不足时补零（防止极短输入导致 outLen 为空）
    const inRate = this.inputRate || sampleRate; // AudioWorkletProcessor global
    const outLen = this.outFrame;
    const out = new Int16Array(outLen);
    if (Math.abs(inRate - this.targetRate) < 1e-3) {
      for (let i = 0; i < outLen; i += 1) {
        const v = acc[i] ?? 0;
        const clipped = Math.max(-1, Math.min(1, v));
        out[i] = clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff;
      }
    } else {
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

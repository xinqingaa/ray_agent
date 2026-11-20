const WAV_RATE = 16_000
export const VOICE_LIMIT_SECONDS = 120

/** 把 Web Audio 的单声道采样转换成 ASR 接受的 16 kHz 16 位 PCM WAV。 */
export function voiceWav(chunks: Float32Array[], sampleRate: number): Blob {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const sampleCount = Math.min(VOICE_LIMIT_SECONDS * WAV_RATE, Math.floor(length * WAV_RATE / sampleRate))
  if (sampleCount === 0) throw new Error('录音为空，请重新录制。')
  const input = new Float32Array(length)
  let offset = 0
  for (const chunk of chunks) {
    input.set(chunk, offset)
    offset += chunk.length
  }
  const wav = new DataView(new ArrayBuffer(44 + sampleCount * 2))
  const ascii = (at: number, text: string) => [...text].forEach((char, index) => wav.setUint8(at + index, char.charCodeAt(0)))
  ascii(0, 'RIFF')
  wav.setUint32(4, 36 + sampleCount * 2, true)
  ascii(8, 'WAVEfmt ')
  wav.setUint32(16, 16, true)
  wav.setUint16(20, 1, true)
  wav.setUint16(22, 1, true)
  wav.setUint32(24, WAV_RATE, true)
  wav.setUint32(28, WAV_RATE * 2, true)
  wav.setUint16(32, 2, true)
  wav.setUint16(34, 16, true)
  ascii(36, 'data')
  wav.setUint32(40, sampleCount * 2, true)

  const stride = sampleRate / WAV_RATE
  for (let i = 0; i < sampleCount; i++) {
    const from = i * stride
    const begin = Math.floor(from)
    const end = Math.min(length, Math.max(begin + 1, Math.floor((i + 1) * stride)))
    let sum = 0
    for (let k = begin; k < end; k++) sum += input[k]
    const sample = Math.max(-1, Math.min(1, sum / (end - begin)))
    wav.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true)
  }
  return new Blob([wav.buffer], {type: 'audio/wav'})
}

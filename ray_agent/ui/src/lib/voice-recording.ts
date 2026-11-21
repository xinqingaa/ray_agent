const WAV_RATE = 16_000
export const VOICE_LIMIT_SECONDS = 120

export type VoiceRecording = {finish: () => Blob}

/** 麦克风与 Web Audio 的生命周期。调用方负责选择转写方式及音频的后续去向。 */
export async function openVoiceRecording({signal, onMeter, onLimit}: {
  signal: AbortSignal
  onMeter: (elapsed: number, level: number) => void
  onLimit: () => void
}): Promise<VoiceRecording> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前窗口无法使用麦克风，请在桌面应用中打开。')
  signal.throwIfAborted()
  // 从触发录音的点击直接创建 AudioContext，保留 WebView 的用户操作授权。
  const context = new AudioContext()
  const sampleRate = context.sampleRate
  const maxFrames = sampleRate * VOICE_LIMIT_SECONDS
  const chunks: Float32Array[] = []
  let frames = 0
  let lastMeter = 0
  let stream: MediaStream | null = null
  let source: MediaStreamAudioSourceNode | null = null
  let processor: ScriptProcessorNode | null = null
  const release = () => {
    signal.removeEventListener('abort', release)
    if (processor) {
      processor.onaudioprocess = null
      processor.disconnect()
      processor = null
    }
    source?.disconnect()
    source = null
    stream?.getTracks().forEach(track => track.stop())
    stream = null
    if (context.state !== 'closed') void context.close().catch(() => {})
  }

  signal.addEventListener('abort', release, {once: true})
  try {
    await context.resume()
    signal.throwIfAborted()
    stream = await navigator.mediaDevices.getUserMedia({audio: {channelCount: 1}})
    // 系统权限对话框无法通过 AbortSignal 撤销。迟到的媒体轨道仍在这里释放。
    signal.throwIfAborted()
    source = context.createMediaStreamSource(stream)
    processor = context.createScriptProcessor(4096, 1, 1)
    processor.onaudioprocess = event => {
      const samples = event.inputBuffer.getChannelData(0).slice(0, maxFrames - frames)
      chunks.push(samples)
      frames += samples.length
      const elapsed = frames / sampleRate
      if (elapsed - lastMeter > 0.08) {
        lastMeter = elapsed
        const energy = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / Math.max(1, samples.length))
        onMeter(elapsed, Math.min(1, energy * 8))
      }
      if (frames >= maxFrames) onLimit()
    }
    source.connect(processor)
    processor.connect(context.destination)
  } catch (error) {
    release()
    throw error
  }

  return {finish: () => {
    release()
    return voiceWav(chunks, sampleRate)
  }}
}

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

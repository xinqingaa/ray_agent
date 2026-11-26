import {useEffect, useRef, useState} from 'react'
import {useRouter} from '@/lib/navigation'
import {toast} from 'sonner'
import {DATA_CLEARED, draftClearedBy, INDEPENDENT_SCOPE, readDraft, writeDraft, type ClearedData} from '@/lib/drafts'
import {useStartTask, type StartOptions} from '@/hooks/use-start-task'
import {ChatInput, type ChatInputRef} from '@/components/chat-input'
import {isPresetStarterPrompt, PresetCapsule, PresetPicker, PresetStarters, usePresets} from '@/components/preset-picker'
import {TaskLayout} from '@/components/task-layout'
import type {FileInfo} from '@/lib/api/types'

export function HomePage() {
  const router = useRouter()
  const input = useRef<ChatInputRef>(null)
  const presets = usePresets()
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(() => readDraft(INDEPENDENT_SCOPE).activePresetId ?? null)
  const [composerText, setComposerText] = useState(() => readDraft(INDEPENDENT_SCOPE).text)
  const composerTextRef = useRef(composerText)
  const selectedPreset = presets.find(item => item.id === selectedPresetId) ?? null
  useEffect(() => {
    if (selectedPresetId && presets.length > 0 && !selectedPreset) setSelectedPresetId(null)
  }, [presets, selectedPreset, selectedPresetId])
  useEffect(() => {
    const onCleared = (event: Event) => {
      const data = (event as CustomEvent<ClearedData>).detail
      if (!data || !draftClearedBy(data, INDEPENDENT_SCOPE)) return
      setSelectedPresetId(null)
      composerTextRef.current = ''
      setComposerText('')
    }
    window.addEventListener(DATA_CLEARED, onCleared)
    return () => window.removeEventListener(DATA_CLEARED, onCleared)
  }, [])
  const syncText = (text: string) => {
    composerTextRef.current = text
    setComposerText(text)
  }
  const selectPreset = (nextId: string | null) => {
    if (nextId !== selectedPresetId && isPresetStarterPrompt(composerTextRef.current, presets)) {
      syncText('')
      input.current?.setInputText('')
    }
    setSelectedPresetId(nextId)
    const draft = readDraft(INDEPENDENT_SCOPE)
    writeDraft(INDEPENDENT_SCOPE, {
      activePresetId: nextId,
      ...(!draft.sessionId && !draft.submission ? {creationId: undefined} : {}),
    })
  }
  const {sending, start} = useStartTask(INDEPENDENT_SCOPE, null, id => router.push(`/sessions/${id}`))
  const handleStart = (message: string, files: FileInfo[], options?: StartOptions) =>
    start(message, files, {...options, activePresetId: selectedPreset?.id ?? null})

  return (
    <TaskLayout attach={sending ? undefined : files => input.current?.addFiles(files)}>
      <main className="task-home" aria-labelledby="independent-home-title">
        <div className="task-home-content">
          <header className="task-home-heading">
            <h1 id="independent-home-title">想完成什么？</h1>
            <p>独立对话不读写任何工作区的文件和记忆。</p>
          </header>
          <ChatInput ref={input} autoFocus
            draftScope={INDEPENDENT_SCOPE}
            onInputValueChange={syncText}
            onSend={handleStart}
            disabled={sending}
            placeholder={selectedPreset?.placeholder ?? '描述目标，或拖入材料'}
            topBanner={selectedPreset ? <PresetCapsule preset={selectedPreset} disabled={sending} onClear={() => selectPreset(null)}/> : undefined}
            presets={presets}
            activePresetId={selectedPreset?.id ?? null}
            onSelectPreset={id => selectPreset(id)}
            commandHost={{
              hasSession: false,
              hasRuns: false,
              runStatus: 'idle',
              waitingApproval: false,
              waitingReply: false,
              submitting: sending,
              compacting: false,
              actions: {compact: () => toast.message('还没有可压缩的上下文')},
            }}
          />
          {selectedPreset && (
            <PresetStarters
              preset={selectedPreset}
              activePrompt={composerText}
              disabled={sending}
              onPick={prompt => {
                const next = composerTextRef.current.trim() === prompt.trim() ? '' : prompt
                syncText(next)
                input.current?.setInputText(next)
              }}
            />
          )}
          <PresetPicker
            presets={presets}
            selectedId={selectedPreset?.id ?? null}
            disabled={sending}
            onSelect={selectPreset}
          />
        </div>
      </main>
    </TaskLayout>
  )
}

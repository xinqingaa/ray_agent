'use client'

import {useEffect, useMemo, useState} from 'react'
import {toast} from 'sonner'
import {configApi} from '@/lib/api/config'
import {sessionApi} from '@/lib/api/session'
import {ApiError} from '@/lib/api/fetch'
import type {ModelCatalog} from '@/lib/api/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {cn} from '@/lib/utils'

export type ModelSelection = {model: string; reasoning: string}

export function ModelPicker({
  sessionId,
  savedModel,
  savedReasoning,
  runModel,
  runReasoning,
  onSelection,
}: {
  sessionId?: string | null
  savedModel?: string | null
  savedReasoning?: string | null
  runModel?: string | null
  runReasoning?: string | null
  onSelection: (selection: ModelSelection | null) => void
}) {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const [picked, setPicked] = useState<ModelSelection | null>(null)
  const [scope, setScope] = useState(sessionId)
  if (scope !== sessionId) {
    setScope(sessionId)
    setPicked(null)
  }
  useEffect(() => {
    let cancelled = false
    configApi.getModels()
      .then((data) => { if (!cancelled) setCatalog(data.provider && data.models.length ? data : null) })
      .catch(() => { if (!cancelled) setCatalog(null) })
    return () => { cancelled = true }
  }, [])

  const fallback = catalog?.default_model ? {
    model: savedModel || catalog.default_model,
    reasoning: savedReasoning || catalog.models.find((item) => item.id === (savedModel || catalog.default_model))?.default_choice || 'high',
  } : null
  const selection = picked ?? fallback
  const committed = useMemo(
    () => picked ?? (savedModel && savedReasoning ? {model: savedModel, reasoning: savedReasoning} : null),
    [picked, savedModel, savedReasoning],
  )
  useEffect(() => { onSelection(committed) }, [onSelection, committed])

  if (!catalog || !selection) return null
  const current = catalog.models.find((item) => item.id === selection.model) ?? catalog.models[0]
  const label = `${selection.model} · ${selection.reasoning}`
  const pending = Boolean(runModel && (runModel !== selection.model || (runReasoning || '') !== selection.reasoning))

  async function choose(next: ModelSelection) {
    const previous = picked
    setPicked(next)
    if (!sessionId) return
    try {
      await sessionApi.setModel(sessionId, next)
    } catch (error) {
      setPicked(previous)
      toast.error(error instanceof ApiError ? error.msg : '模型没有切换')
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={pending ? `${label}，下次运行使用` : label}
          className={cn(
            'inline-flex h-7 max-w-[11.5rem] items-center rounded-md px-1.5 font-mono text-xs text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <span className="truncate">{label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-56">
        <DropdownMenuRadioGroup value={selection.model} onValueChange={(id) => {
          const next = catalog.models.find((item) => item.id === id)
          if (!next) return
          const reasoning = next.choices.includes(selection.reasoning) ? selection.reasoning : next.default_choice
          void choose({model: id, reasoning})
        }}>
          {catalog.models.map((item) => (
            <DropdownMenuRadioItem key={item.id} value={item.id} className="font-mono text-xs">
              {item.id}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator/>
        <DropdownMenuRadioGroup value={selection.reasoning} onValueChange={(reasoning) => {
          void choose({model: selection.model, reasoning})
        }}>
          {current.choices.map((choice) => (
            <DropdownMenuRadioItem key={choice} value={choice} className="font-mono text-xs">
              {choice}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

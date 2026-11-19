import {createContext} from 'react'

/** A workspace paper can ask where to put files selected from the composer. */
export const TaskFilePicker = createContext<((files: File[]) => void) | null>(null)

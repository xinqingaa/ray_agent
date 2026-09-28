import type {Metadata} from 'next'
import {SettingsView} from '@/components/settings/settings-view'

export const metadata: Metadata = {
  title: '设置 · RayAgent',
}

export default function SettingsPage() {
  return <SettingsView/>
}

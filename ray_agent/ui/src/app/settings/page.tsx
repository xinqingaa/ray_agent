import type {Metadata} from 'next'
import {SettingsPageView} from '@/components/settings/settings-dialog'

export const metadata: Metadata = {
  title: '设置 · RayAgent',
}

export default function SettingsPage() {
  return <SettingsPageView/>
}

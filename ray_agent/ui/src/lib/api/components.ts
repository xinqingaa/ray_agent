import type {components} from '../../../../contracts/generated/openapi'
import {get, post} from './fetch'

export type ComponentView = components['schemas']['ComponentView']
export type ComponentOperation = components['schemas']['OperationView']
export const componentsApi = {
  list: () => get<ComponentView[]>('/components'),
  install: (id: string, requestId: string) => post<ComponentOperation>(`/components/${id}/install`, {request_id: requestId}),
  cancel: (id: string) => post<ComponentOperation>(`/operations/${id}/cancel`, {}),
  retry: (id: string) => post<ComponentOperation>(`/operations/${id}/retry`, {}),
}

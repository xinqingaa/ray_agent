import {get, post} from './fetch'
import type {components} from '../../../../contracts/generated/openapi'

type Schemas = components['schemas']
export type EvaluationOverview = Schemas['EvaluationOverview']
export type EvaluationBatch = Schemas['EvaluationBatch']
export type EvaluationStart = Schemas['EvaluationStart']
export type EvaluationResult = Schemas['EvaluationResult']
export type EvaluationArtifact = Schemas['EvaluationArtifact']
export type EvaluationCaseId = Schemas['EvaluationCase']['id']

export const evaluationApi = {
  overview: () => get<EvaluationOverview>('/evaluation'),
  batch: (id: string) => get<EvaluationBatch>(`/evaluation/${id}`),
  start: (request: EvaluationStart) => post<EvaluationBatch>('/evaluation', request),
  cancel: (id: string) => post<EvaluationBatch>(`/evaluation/${id}/cancel`, {}),
}

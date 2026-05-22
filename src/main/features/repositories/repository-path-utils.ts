import type { RepositoryBackend } from '../../../shared/app-types'
import { createNativeBackend, isPathInsideRoot } from '../../backends/repository-backend'

export function isPathInsideRepository(
  repositoryPath: string,
  candidatePath: string,
  backend: RepositoryBackend = createNativeBackend()
): boolean {
  return isPathInsideRoot(backend, repositoryPath, candidatePath)
}

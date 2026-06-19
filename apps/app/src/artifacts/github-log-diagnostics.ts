export type UploadArtifactLogSummary = {
  hasUploadArtifactStep: boolean
  hasEmptyUpload: boolean
  messages: string[]
}

export type JobLogDownloadFailure = {
  status: number | null
  message: string | null
}

export function summarizeUploadArtifactLog(logText: string): UploadArtifactLogSummary {
  const messages = logText.split(/\r?\n/).map(cleanLogLine).filter(Boolean).filter(isRelevantUploadLine).slice(0, 8)

  return {
    hasUploadArtifactStep: messages.some(isUploadArtifactStepLine),
    hasEmptyUpload: messages.some(isEmptyUploadLine),
    messages,
  }
}

export function explainJobLogDownloadFailure(failure: JobLogDownloadFailure) {
  if (failure.status === 410) return 'GitHub job logs have expired.'
  if (failure.status === 404) return 'GitHub job logs were not found.'
  if (failure.status === 403) return 'GitHub denied access to the job logs.'
  if (failure.status) return `GitHub returned ${failure.status} while downloading job logs.`
  if (failure.message) return failure.message
  return 'GitHub did not return job logs.'
}

function isRelevantUploadLine(line: string) {
  const lower = line.toLowerCase()
  return (
    lower.includes('upload-artifact') ||
    lower.includes('no files were found') ||
    lower.includes('no artifacts will be uploaded') ||
    lower.includes('0 files uploaded') ||
    lower.includes('there will be 0 files')
  )
}

function isUploadArtifactStepLine(line: string) {
  return line.toLowerCase().includes('upload-artifact')
}

function isEmptyUploadLine(line: string) {
  const lower = line.toLowerCase()
  return (
    lower.includes('no files were found') ||
    lower.includes('no artifacts will be uploaded') ||
    lower.includes('0 files uploaded') ||
    lower.includes('there will be 0 files')
  )
}

function cleanLogLine(line: string) {
  const trimmed = line.trim()
  const [firstToken, ...rest] = trimmed.split(' ')
  if (firstToken && rest.length > 0 && looksLikeGithubLogTimestamp(firstToken)) return rest.join(' ').trim()
  return trimmed
}

function looksLikeGithubLogTimestamp(value: string) {
  return value.length >= 20 && value.includes('T') && value.endsWith('Z') && value[4] === '-' && value[7] === '-'
}

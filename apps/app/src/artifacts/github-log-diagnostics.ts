export type UploadArtifactLogSummary = {
  hasUploadArtifactStep: boolean
  hasEmptyUpload: boolean
  messages: string[]
}

export function summarizeUploadArtifactLog(logText: string): UploadArtifactLogSummary {
  const messages = logText.split(/\r?\n/).map(cleanLogLine).filter(Boolean).filter(isRelevantUploadLine).slice(0, 8)

  return {
    hasUploadArtifactStep: messages.some(isUploadArtifactStepLine),
    hasEmptyUpload: messages.some(isEmptyUploadLine),
    messages,
  }
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

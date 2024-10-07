import React from 'react'
import {PathParams} from './load-artifact.server'

interface ArtifactLayoutProps {
  params: PathParams
  children: React.ReactNode
}

export function ArtifactLayout({params, children}: ArtifactLayoutProps) {
  return (
    <div className="bg-gray-950 text-amber-200/80 p-6 font-mono min-h-screen">
      <h1 className="text-3xl font-bold mb-6 border-b-2 border-amber-300/50 pb-2">
        🗿 artifact: {params.artifactName}
      </h1>
      {children}
    </div>
  )
}

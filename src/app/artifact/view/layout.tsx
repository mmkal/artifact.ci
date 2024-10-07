export default function ArtifactLayout({children}: {children: React.ReactNode}) {
  return (
    <div className="bg-slate-950 text-amber-200/80 p-6 font-mono min-h-screen flex flex-col">
      <main className="flex-grow">{children}</main>
    </div>
  )
}

import {ClientLayout} from './layout.client'
import {ArtifactLoader} from './loader'

export default async function ArtifactPage() {
  return (
    <ClientLayout>
      <ArtifactLoader />
    </ClientLayout>
  )
}

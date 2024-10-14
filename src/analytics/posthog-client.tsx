'use client'
import {usePathname, useSearchParams} from 'next/navigation'
import posthog from 'posthog-js'
import {PostHogProvider as PostHogProviderBase} from 'posthog-js/react'
import {useEffect} from 'react'

export function PostHogPageview(): null {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  useEffect(posthogInit, [])
  // Track pageviews manually https://github.com/PostHog/posthog-js/issues/1461
  useEffect(() => {
    if (pathname) {
      const url = [window.origin + pathname, searchParams?.toString()].filter(Boolean).join('?')
      posthog.capture('$pageview', {$current_url: url})
    }
  }, [pathname, searchParams])

  return null
}

export function posthogInit() {
  if (process.env.NODE_ENV === 'development') return
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    session_recording: {
      maskAllInputs: false,
      maskInputOptions: {password: true},
    },
    loaded: ph => {
      if (process.env.NODE_ENV === 'development') ph.debug()
    },
  })
}

export function PostHogProvider({children}: {children: React.ReactNode}) {
  return <PostHogProviderBase client={posthog}>{children}</PostHogProviderBase>
}

export {default as posthog} from 'posthog-js'
